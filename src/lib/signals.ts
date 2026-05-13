import type { Profile } from "./stats";

// A BusinessSignal is a named, business-meaningful pattern detected in the input.
// Each signal carries enough evidence for either the deterministic fallback or the
// LLM to ground a claim without inventing numbers.
export type SignalKind =
  | "growth"
  | "decline"
  | "churn"
  | "retention_pressure"
  | "customer_concentration"
  | "category_concentration"
  | "anomaly"
  | "outlier_row"
  | "missing_data"
  | "support_degradation"
  | "delay_or_slippage"
  | "cash_or_runway"
  | "dependency"
  | "negative_sentiment"
  | "positive_sentiment"
  | "data_sparse";

export type SignalSeverity = "High" | "Medium" | "Low";

export type BusinessSignal = {
  kind: SignalKind;
  title: string;
  evidence: string;       // a literal quote or computed value from the data
  metric?: string;        // e.g. "-12%", "47%", "$1.2M"
  severity: SignalSeverity;
  confidence: SignalSeverity; // reuse the same scale
  score: number;          // for ranking; higher = more important
};

// Vocabulary the analyst looks for in free text. Kept small and specific —
// noisy keyword lists produce noisy signals.
const CHURN_TERMS = ["churn", "attrition", "cancellation", "cancellations", "downgrade", "downgrades"];
const RETENTION_TERMS = ["retention", "renewal", "renewals", "nps", "csat"];
const SUPPORT_TERMS = ["support tickets", "tickets", "complaints", "escalation", "escalations", "outage", "incident", "incidents", "p1", "p0", "sev1"];
const DELAY_TERMS = ["delayed", "slipped", "slipping", "missed", "behind schedule", "pushed to", "deferred", "blocked"];
const CASH_TERMS = ["runway", "burn", "cash flow", "cashflow", "ar aging", "receivables", "payables", "overdue"];
const DEPENDENCY_TERMS = ["sole supplier", "single supplier", "single vendor", "depends on", "dependent on", "only one", "key customer", "key client", "anchor client", "anchor customer"];
const GROWTH_TERMS = ["growth", "growing", "grew", "expansion", "expanded", "up ", "increase", "increased", "record", "all-time high", "highest"];
const DECLINE_TERMS = ["down ", "decline", "declined", "drop", "dropped", "decrease", "decreased", "weak", "weakness", "slow", "slowing", "softening", "softer"];
const NEG_SENTIMENT = ["frustrated", "unhappy", "angry", "disappointed", "concerned", "worried", "risk", "issue", "problem", "bug", "broken"];
const POS_SENTIMENT = ["love", "great", "excellent", "happy", "smooth", "strong", "fast", "ahead of plan"];

type TextSignalContext = { input: string; lower: string };

export function extractSignals(rawInput: string, profile: Profile): BusinessSignal[] {
  const out: BusinessSignal[] = [];
  const ctx: TextSignalContext = { input: rawInput, lower: rawInput.toLowerCase() };

  // Free-text patterns work for both CSV (header strings) and prose.
  pushTextSignals(ctx, out);

  if (profile.kind === "csv") {
    pushCsvSignals(profile, out);
  } else if (profile.kind === "text") {
    pushProseNumberSignals(profile, ctx, out);
  }

  // Rank — most important signals first — and dedupe by (kind, title).
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      const k = `${s.kind}::${s.title.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Free-text patterns
// ─────────────────────────────────────────────────────────────────────────────

function pushTextSignals(ctx: TextSignalContext, out: BusinessSignal[]) {
  // Each helper finds at most one of its kind so the same complaint doesn't
  // surface twice from two synonyms.
  const churn = findPctNear(ctx, CHURN_TERMS);
  if (churn) {
    out.push({
      kind: "churn",
      title: `Churn signal: ${churn.match}`,
      evidence: quote(ctx.input, churn.index, churn.length),
      metric: churn.metric,
      severity: gradeChurnSeverity(churn.value),
      confidence: "High",
      score: 90 + Math.min(20, churn.value || 0),
    });
  }

  const retention = mentionsAny(ctx, RETENTION_TERMS);
  if (retention) {
    out.push({
      kind: "retention_pressure",
      title: `Retention/renewal mentioned in context`,
      evidence: quote(ctx.input, retention.index, retention.length),
      severity: "Medium",
      confidence: "Medium",
      score: 55,
    });
  }

  const support = mentionsAny(ctx, SUPPORT_TERMS);
  if (support) {
    out.push({
      kind: "support_degradation",
      title: `Support / incident pressure mentioned`,
      evidence: quote(ctx.input, support.index, support.length),
      severity: "Medium",
      confidence: "Medium",
      score: 60,
    });
  }

  const delay = mentionsAny(ctx, DELAY_TERMS);
  if (delay) {
    out.push({
      kind: "delay_or_slippage",
      title: `Delivery / pipeline slippage cited`,
      evidence: quote(ctx.input, delay.index, delay.length),
      severity: "Medium",
      confidence: "Medium",
      score: 65,
    });
  }

  const cash = mentionsAny(ctx, CASH_TERMS);
  if (cash) {
    out.push({
      kind: "cash_or_runway",
      title: `Cash / runway / receivables mentioned`,
      evidence: quote(ctx.input, cash.index, cash.length),
      severity: "High",
      confidence: "Medium",
      score: 80,
    });
  }

  const dep = mentionsAny(ctx, DEPENDENCY_TERMS);
  if (dep) {
    out.push({
      kind: "dependency",
      title: `Single-point dependency cited`,
      evidence: quote(ctx.input, dep.index, dep.length),
      severity: "High",
      confidence: "Medium",
      score: 75,
    });
  }

  // Sentiment is the lightest signal — confidence stays Low, score low.
  const negCount = countAny(ctx, NEG_SENTIMENT);
  const posCount = countAny(ctx, POS_SENTIMENT);
  if (negCount >= 2 && negCount > posCount) {
    out.push({
      kind: "negative_sentiment",
      title: `Negative tone in notes (${negCount} cues)`,
      evidence: `Negative cues outnumber positive (${negCount} vs ${posCount}).`,
      severity: "Low",
      confidence: "Low",
      score: 30 + negCount,
    });
  } else if (posCount >= 2 && posCount > negCount) {
    out.push({
      kind: "positive_sentiment",
      title: `Positive tone in notes (${posCount} cues)`,
      evidence: `Positive cues outnumber negative (${posCount} vs ${negCount}).`,
      severity: "Low",
      confidence: "Low",
      score: 20 + posCount,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV-only patterns
// ─────────────────────────────────────────────────────────────────────────────

function pushCsvSignals(p: Extract<Profile, { kind: "csv" }>, out: BusinessSignal[]) {
  // 1. Trend (already computed in stats.ts)
  if (p.trend) {
    const dir = p.trend.deltaPct >= 0 ? "growth" : "decline";
    const abs = Math.abs(p.trend.deltaPct);
    out.push({
      kind: dir,
      title: `${p.trend.column} ${dir === "growth" ? "trending up" : "trending down"} ${abs.toFixed(1)}%`,
      evidence: `${p.trend.column} moved from avg ${p.trend.firstBucketAvg} → ${p.trend.lastBucketAvg} (first vs last half).`,
      metric: `${p.trend.deltaPct >= 0 ? "+" : ""}${p.trend.deltaPct.toFixed(1)}%`,
      severity: abs >= 15 ? "High" : abs >= 5 ? "Medium" : "Low",
      confidence: "High",
      score: 70 + Math.min(25, abs),
    });
  }

  // 2. Concentration in any categorical column
  for (const col of p.columns) {
    if (!col.top || p.rowCount === 0) continue;
    if (col.detectedType !== "category" && col.detectedType !== "text") continue;
    const top = col.top[0];
    const share = top.count / p.rowCount;
    if (share < 0.25) continue;
    const kind: SignalKind =
      /customer|client|account|company/i.test(col.name) ? "customer_concentration" : "category_concentration";
    out.push({
      kind,
      title: `${kind === "customer_concentration" ? "Customer" : "Category"} concentration in ${col.name}: ${pct(share)} on "${top.value}"`,
      evidence: `${top.count} of ${p.rowCount} rows share value "${top.value}" in column ${col.name}.`,
      metric: pct(share),
      severity: share >= 0.5 ? "High" : share >= 0.35 ? "Medium" : "Low",
      confidence: "High",
      score: 60 + Math.round(share * 40),
    });
  }

  // 3. Anomalies / outliers — z-score > 2.5 on numeric columns
  for (const col of p.columns) {
    if (col.detectedType !== "number" || !col.numeric) continue;
    if (!col.values || col.values.length < 5) continue;
    const { mean, stdev } = meanStdev(col.values);
    if (stdev === 0) continue;
    const outliers = col.values
      .map((v) => ({ v, z: (v - mean) / stdev }))
      .filter((p) => Math.abs(p.z) > 2.5);
    if (outliers.length === 0) continue;
    const worst = outliers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    out.push({
      kind: "outlier_row",
      title: `Outlier in ${col.name}: ${worst.v} (${worst.z.toFixed(1)}σ from mean)`,
      evidence: `${outliers.length} value${outliers.length === 1 ? "" : "s"} sit >2.5σ from the ${col.name} mean of ${round(mean)}.`,
      metric: `${worst.z.toFixed(1)}σ`,
      severity: Math.abs(worst.z) > 4 ? "High" : "Medium",
      confidence: "Medium",
      score: 55 + Math.min(20, Math.abs(worst.z) * 4),
    });
  }

  // 4. Missing data — highest missing % across columns, only if ≥15%
  const missing = [...p.columns].filter((c) => c.missingPct >= 15).sort((a, b) => b.missingPct - a.missingPct)[0];
  if (missing) {
    out.push({
      kind: "missing_data",
      title: `${missing.missingPct}% of ${missing.name} is missing`,
      evidence: `Column ${missing.name} is empty for ${missing.missingPct}% of the ${p.rowCount} rows ingested.`,
      metric: `${missing.missingPct}%`,
      severity: missing.missingPct >= 40 ? "High" : "Medium",
      confidence: "High",
      score: 50 + missing.missingPct / 2,
    });
  }

  if (p.rowCount < 10) {
    out.push({
      kind: "data_sparse",
      title: `Small sample size: ${p.rowCount} rows`,
      evidence: `Only ${p.rowCount} usable rows after parsing — patterns below may not generalize.`,
      severity: "Medium",
      confidence: "High",
      score: 35,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prose number patterns — convert raw extracted numbers into signals
// ─────────────────────────────────────────────────────────────────────────────

function pushProseNumberSignals(
  p: Extract<Profile, { kind: "text" }>,
  ctx: TextSignalContext,
  out: BusinessSignal[]
) {
  // Already-claimed percentages (any kind:"churn"|"growth"|"decline") shouldn't
  // also become generic growth/decline signals.
  const claimedValues = new Set(
    out
      .filter((s) => s.metric && /%/.test(s.metric))
      .map((s) => s.metric!.replace(/[^0-9.]/g, ""))
  );
  for (const n of p.numbers) {
    if (n.unit !== "%" || Math.abs(n.value) < 3) continue;
    if (claimedValues.has(String(n.value))) continue;

    // Find the directional word *closest* to this number's position in the
    // full input — not anywhere in a 30-char window, which produced false
    // positives when "down" and "up" both appeared nearby.
    const idx = ctx.input.indexOf(n.context);
    if (idx < 0) continue;
    const numIdx = idx + n.context.indexOf(String(n.value));
    const direction = closestDirection(ctx.lower, numIdx);
    if (!direction) continue;

    if (direction === "down") {
      out.push({
        kind: "decline",
        title: `${n.value}% decline cited in notes`,
        evidence: `"…${n.context}…"`,
        metric: `-${n.value}%`,
        severity: n.value >= 15 ? "High" : n.value >= 7 ? "Medium" : "Low",
        confidence: "Medium",
        score: 68 + Math.min(20, Math.abs(n.value)),
      });
    } else {
      out.push({
        kind: "growth",
        title: `${n.value}% growth cited in notes`,
        evidence: `"…${n.context}…"`,
        metric: `+${n.value}%`,
        severity: "Low",
        confidence: "Medium",
        score: 50 + Math.min(15, n.value),
      });
    }
  }
}

const DOWN_WORDS = ["down", "drop", "decline", "decrease", "fell", "miss", "behind", "slow", "soft"];
const UP_WORDS = ["up ", "grew", "growth", "increase", "rose", "gain", "ahead"];

type Dir = "up" | "down";
function closestDirection(lower: string, anchor: number): Dir | null {
  let best: { dir: Dir; dist: number } | null = null;
  const consider = (word: string, dir: Dir) => {
    let from = 0;
    while (true) {
      const i = lower.indexOf(word, from);
      if (i === -1) break;
      const d = Math.abs(i - anchor);
      if (d <= 25 && (best === null || d < best.dist)) best = { dir, dist: d };
      from = i + word.length;
    }
  };
  for (const w of DOWN_WORDS) consider(w, "down");
  for (const w of UP_WORDS) consider(w, "up");
  return best ? (best as { dir: Dir; dist: number }).dir : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Hit = { index: number; length: number; match: string };

function mentionsAny(ctx: TextSignalContext, terms: string[]): Hit | null {
  for (const term of terms) {
    const i = ctx.lower.indexOf(term);
    if (i !== -1) return { index: i, length: term.length, match: ctx.input.slice(i, i + term.length) };
  }
  return null;
}

function countAny(ctx: TextSignalContext, terms: string[]): number {
  let count = 0;
  for (const term of terms) {
    let from = 0;
    while (true) {
      const i = ctx.lower.indexOf(term, from);
      if (i === -1) break;
      count++;
      from = i + term.length;
      if (count > 20) return count;
    }
  }
  return count;
}

// Find the percentage *closest* to any of the supplied terms, preferring a
// percentage that follows the term (e.g. "churn 4.1%") over one that precedes
// it. Returns the closest pair across all term occurrences.
function findPctNear(
  ctx: TextSignalContext,
  terms: string[]
): (Hit & { value: number; metric: string }) | null {
  // Collect every percentage in the input once.
  const pctRe = /(\d+(?:\.\d+)?)\s*%/g;
  const pcts: Array<{ index: number; value: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = pctRe.exec(ctx.input)) !== null) {
    pcts.push({ index: m.index, value: Number(m[1]) });
  }
  if (pcts.length === 0) return null;

  let best: { dist: number; pct: { index: number; value: number }; term: string } | null = null;
  for (const term of terms) {
    let from = 0;
    while (true) {
      const ti = ctx.lower.indexOf(term, from);
      if (ti === -1) break;
      for (const p of pcts) {
        // Bias: a percentage *after* the term within 30 chars is most likely
        // the value being described. We weight following-pcts as half the
        // measured distance, so they win ties.
        const raw = p.index - ti;
        const bias = raw >= 0 ? 0.5 : 1;
        const dist = Math.abs(raw) * bias;
        if (dist > 40) continue;
        if (!best || dist < best.dist) best = { dist, pct: p, term };
      }
      from = ti + term.length;
    }
  }
  if (!best) return null;
  const v = best.pct.value;
  return {
    index: best.pct.index,
    length: 1,
    match: `${best.term} ${v}%`,
    value: v,
    metric: `${v}%`,
  };
}

function gradeChurnSeverity(pct: number): SignalSeverity {
  if (!Number.isFinite(pct)) return "Medium";
  if (pct >= 8) return "High";
  if (pct >= 4) return "Medium";
  return "Low";
}

function quote(input: string, index: number, length: number): string {
  const start = Math.max(0, index - 5);
  const end = Math.min(input.length, index + length + 5);
  const slice = input.slice(start, end).replace(/\s+/g, " ").trim();
  return `"…${slice}…"`;
}

function meanStdev(values: number[]): { mean: number; stdev: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stdev: Math.sqrt(variance) };
}

function round(n: number, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}
