import type { Analysis } from "./schema";
import type { Profile, ColumnProfile } from "./stats";

export function deterministicAnalysis(profile: Profile): Analysis {
  if (profile.kind === "csv") return csvAnalysis(profile);
  if (profile.kind === "text") return textAnalysis(profile);
  return emptyAnalysis();
}

type CsvProfile = Extract<Profile, { kind: "csv" }>;
type TextProfile = Extract<Profile, { kind: "text" }>;

function csvAnalysis(p: CsvProfile): Analysis {
  const insights: Analysis["insights"] = [];
  const risks: Analysis["risks"] = [];

  const conc = topConcentratedCategory(p);
  const numericCol = p.columns.find((c) => c.detectedType === "number" && c.numeric);
  const missingCol = [...p.columns]
    .filter((c) => c.missingPct > 0)
    .sort((a, b) => b.missingPct - a.missingPct)[0];

  if (p.trend) {
    const dir = p.trend.deltaPct >= 0 ? "up" : "down";
    insights.push({
      title: `${p.trend.column} trended ${dir} ${Math.abs(p.trend.deltaPct).toFixed(1)}% over the period`,
      evidence: `First-half avg ${fmt(p.trend.firstBucketAvg)} → last-half avg ${fmt(p.trend.lastBucketAvg)}.`,
    });
  }

  if (conc && conc.share >= 0.25) {
    insights.push({
      title: `${conc.value} accounts for ${pct(conc.share)} of ${conc.column}`,
      evidence: `${conc.count} of ${p.rowCount} rows.`,
    });
  }

  if (numericCol && numericCol.numeric) {
    const { min, max, mean, median } = numericCol.numeric;
    const skew = Math.abs(mean - median) / Math.max(1, Math.abs(mean));
    insights.push({
      title: `${numericCol.name} ranges ${fmt(min)}–${fmt(max)} (mean ${fmt(mean)})`,
      evidence:
        skew > 0.25
          ? `Mean ${fmt(mean)} vs median ${fmt(median)} — distribution is skewed; outliers present.`
          : `Mean ≈ median (${fmt(mean)}/${fmt(median)}) — distribution is roughly even.`,
    });
  }

  while (insights.length < 3) {
    insights.push({
      title: `${p.rowCount} rows × ${p.columnCount} columns ingested`,
      evidence: `Columns: ${p.columns.map((c) => c.name).join(", ") || "(none)"}.`,
    });
  }
  insights.length = 3;

  if (conc && conc.share >= 0.4) {
    risks.push({
      title: `Concentration risk in ${conc.column}`,
      why: `${pct(conc.share)} of rows are "${conc.value}" — a single failure point.`,
    });
  }
  if (p.trend && p.trend.deltaPct < -10) {
    risks.push({
      title: `${p.trend.column} declined ${Math.abs(p.trend.deltaPct).toFixed(1)}% over the period`,
      why: `Sustained downward trend in the primary numeric column.`,
    });
  }
  if (missingCol && missingCol.missingPct > 15 && risks.length < 2) {
    risks.push({
      title: `${missingCol.missingPct}% of ${missingCol.name} is missing`,
      why: `Downstream analyses using ${missingCol.name} silently drop a meaningful share of rows.`,
    });
  }
  while (risks.length < 2) {
    risks.push({
      title: "No structural risk surfaced from the profile alone",
      why: "Sample may be too clean or too small for the deterministic pass to flag one. Try the LLM half with an API key.",
    });
  }
  risks.length = 2;

  let action: Analysis["action"];
  if (p.trend && p.trend.deltaPct < -10) {
    action = {
      title: `Investigate the ${Math.abs(p.trend.deltaPct).toFixed(1)}% drop in ${p.trend.column} this week`,
      rationale: `${p.trend.column} fell from ${fmt(p.trend.firstBucketAvg)} to ${fmt(p.trend.lastBucketAvg)}. Find the driver before the next period.`,
    };
  } else if (conc && conc.share >= 0.4) {
    action = {
      title: `Build a contingency for ${conc.value} in ${conc.column}`,
      rationale: `${pct(conc.share)} concentration means a single shift moves the whole number.`,
    };
  } else if (missingCol && missingCol.missingPct > 15) {
    action = {
      title: `Fix collection for ${missingCol.name} this week`,
      rationale: `${missingCol.missingPct}% missingness undermines anything you compute on this column.`,
    };
  } else {
    action = {
      title: "Re-run with more data or add an API key for richer analysis",
      rationale: "Deterministic profile is thin; LLM judgment is needed for non-obvious signal.",
    };
  }

  return { insights, risks, action };
}

function textAnalysis(p: TextProfile): Analysis {
  const insights: Analysis["insights"] = [];
  const risks: Analysis["risks"] = [];

  // Rank numeric mentions by unit-normalized magnitude.
  const sorted = [...p.numbers].sort(
    (a, b) => Math.abs(magnitude(b)) - Math.abs(magnitude(a))
  );
  const top = sorted[0];
  const percents = p.numbers.filter((n) => n.unit === "%");
  const biggestPct = percents.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];

  if (top) {
    insights.push({
      title: `Largest figure cited: ${formatNum(top)}`,
      evidence: `"…${top.context}…"`,
    });
  }
  if (biggestPct && biggestPct !== top) {
    insights.push({
      title: `Largest percentage cited: ${biggestPct.value}%`,
      evidence: `"…${biggestPct.context}…"`,
    });
  }
  const topTerms = p.topTerms.slice(0, 5).map((t) => t.term);
  if (topTerms.length > 0) {
    insights.push({
      title: `Recurring themes: ${topTerms.slice(0, 3).join(", ")}`,
      evidence: `Top terms by frequency: ${topTerms.join(", ")}.`,
    });
  }
  while (insights.length < 3) {
    insights.push({
      title: `${p.lineCount} line${p.lineCount === 1 ? "" : "s"} · ${p.charCount} chars · ${p.numbers.length} numeric mention${p.numbers.length === 1 ? "" : "s"}`,
      evidence: "Deterministic pass; LLM half disabled.",
    });
  }
  insights.length = 3;

  const negSignals = matchSentiment(
    p,
    ["down", "drop", "drops", "dropped", "decline", "declines", "declined", "slip", "slipped", "lost", "miss", "missed", "churn", "behind", "delayed", "weak"]
  );
  if (negSignals.length > 0) {
    risks.push({
      title: `Negative-direction language present (${negSignals.length} signal${negSignals.length === 1 ? "" : "s"})`,
      why: `Mentions of ${negSignals.slice(0, 3).map((s) => `"${s}"`).join(", ")} suggest movement in the wrong direction.`,
    });
  }
  if (top && Math.abs(magnitude(top)) >= 1e5) {
    risks.push({
      title: `Material figure cited without source: ${formatNum(top)}`,
      why: `Large number with no checksum in the notes — high blast-radius if wrong.`,
    });
  }
  if (biggestPct && Math.abs(biggestPct.value) >= 5 && risks.length < 2) {
    risks.push({
      title: `${biggestPct.value}% movement cited`,
      why: `A double-digit percentage swing is rarely noise — confirm the comparison window before acting.`,
    });
  }
  while (risks.length < 2) {
    risks.push({
      title: "Insufficient signal for a structural risk",
      why: "Free-text input is qualitative; deterministic pass cannot infer business risk without numeric anchors.",
    });
  }
  risks.length = 2;

  const action: Analysis["action"] =
    negSignals.length > 0 && top
      ? {
          title: `Verify the ${formatNum(top)} figure and the "${negSignals[0]}" signal before circulating`,
          rationale: "Negative direction language combined with a large unverified number is the highest-risk combination — confirm both first.",
        }
      : top
      ? {
          title: `Source-check the ${formatNum(top)} figure cited in the notes`,
          rationale: "Largest claim in the input; most likely to drive a downstream decision.",
        }
      : {
          title: "Re-paste with numeric context or enable the LLM half",
          rationale: "Without numbers or an API key the deterministic pass has nothing concrete to recommend.",
        };

  return { insights, risks, action };
}

function magnitude(n: { value: number; unit: string | null }): number {
  const u = (n.unit ?? "").toLowerCase();
  if (u === "k" || u === "thousand") return n.value * 1e3;
  if (u === "m" || u === "million") return n.value * 1e6;
  if (u === "b" || u === "bn" || u === "billion") return n.value * 1e9;
  return n.value;
}

function formatNum(n: { value: number; unit: string | null }): string {
  const unit = n.unit ? n.unit.toUpperCase() : "";
  return `${fmt(n.value)}${unit}`;
}

function emptyAnalysis(): Analysis {
  return {
    insights: [
      { title: "No data provided", evidence: "Input was empty after trimming." },
      { title: "No data provided", evidence: "Input was empty after trimming." },
      { title: "No data provided", evidence: "Input was empty after trimming." },
    ],
    risks: [
      { title: "No input", why: "Nothing to analyze." },
      { title: "No input", why: "Nothing to analyze." },
    ],
    action: { title: "Paste a CSV or notes", rationale: "Need data to produce insights." },
  };
}

function topConcentratedCategory(p: CsvProfile):
  | { column: string; value: string; count: number; share: number }
  | undefined {
  let best: { column: string; value: string; count: number; share: number } | undefined;
  for (const col of p.columns) {
    if (!col.top || col.top.length === 0 || p.rowCount === 0) continue;
    if (col.detectedType !== "category" && col.detectedType !== "text") continue;
    const top = col.top[0];
    const share = top.count / p.rowCount;
    if (!best || share > best.share) {
      best = { column: col.name, value: top.value, count: top.count, share };
    }
  }
  return best;
}

function matchSentiment(p: TextProfile, words: string[]): string[] {
  const found: string[] = [];
  for (const t of p.topTerms) {
    if (words.includes(t.term)) found.push(t.term);
  }
  return found;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

// kept for tree-shaking sanity
export type _ColumnProfileRef = ColumnProfile;
