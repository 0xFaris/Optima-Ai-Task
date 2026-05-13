import type { Analysis, Confidence, Insight, Recommendation, Risk } from "./schema";
import type { Profile } from "./stats";
import { extractSignals, type BusinessSignal, type SignalKind } from "./signals";

// Deterministic analyzer — runs the signal extractor and shapes the strongest
// signals into a complete 3-insights / 2-risks / 1-recommendation result.
// This is what the tool can say with zero LLM cost.
export function deterministicAnalysis(profile: Profile, rawInput = ""): Analysis {
  if (profile.kind === "empty") return emptyAnalysis();

  const signals = extractSignals(rawInput, profile);

  // Several signal kinds can be either an insight or a risk depending on
  // direction. The split below keeps the deterministic fallback consistent
  // with the UI's "insight vs risk" labels.
  const RISK_KINDS: SignalKind[] = [
    "decline",
    "churn",
    "missing_data",
    "support_degradation",
    "delay_or_slippage",
    "cash_or_runway",
    "dependency",
    "customer_concentration",
    "category_concentration",
    "outlier_row",
    "anomaly",
    "negative_sentiment",
    "data_sparse",
  ];

  // Risks claim the top two risk-flavored signals first; insights then fill
  // from the *remaining* pool so we never surface the same finding in both
  // sections with the same wording.
  const riskPool = signals.filter((s) => RISK_KINDS.includes(s.kind));
  const risks = pickRisks(riskPool, profile);
  const claimed = new Set(risks.map((r) => r.title));
  const insightPool = signals.filter((s) => !claimed.has(s.title));

  return {
    summary: buildSummary(profile, signals),
    insights: pickInsights(insightPool, profile),
    risks,
    recommendation: buildRecommendation(signals),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────────

function pickInsights(signals: BusinessSignal[], profile: Profile): [Insight, Insight, Insight] {
  const out: Insight[] = [];
  const seenKinds = new Set<SignalKind>();
  for (const s of signals) {
    if (out.length >= 3) break;
    if (seenKinds.has(s.kind)) continue;
    seenKinds.add(s.kind);
    out.push(signalToInsight(s));
  }
  while (out.length < 3) {
    out.push(structuralInsight(profile, out.length));
  }
  return [out[0], out[1], out[2]];
}

function pickRisks(signals: BusinessSignal[], profile: Profile): [Risk, Risk] {
  const out: Risk[] = [];
  const seenKinds = new Set<SignalKind>();
  for (const s of signals) {
    if (out.length >= 2) break;
    if (seenKinds.has(s.kind)) continue;
    seenKinds.add(s.kind);
    out.push(signalToRisk(s));
  }
  while (out.length < 2) {
    out.push(structuralRisk(profile, out.length));
  }
  return [out[0], out[1]];
}

function buildRecommendation(signals: BusinessSignal[]): Recommendation {
  const top = signals[0];
  if (!top) {
    return {
      action: "Collect more structured data before acting on this snapshot",
      reasoning: "No strong business signals surfaced from the input — recommendations would be guesses.",
      priority: "Low",
    };
  }
  const tpl = recTemplates[top.kind] ?? defaultRec;
  return tpl(top);
}

const recTemplates: Partial<Record<SignalKind, (s: BusinessSignal) => Recommendation>> = {
  decline: (s) => ({
    action: `Investigate the ${s.metric ?? "decline"} this week and identify the single largest driver`,
    reasoning: `${s.evidence} A sustained drop compounds — root-cause first, plan second.`,
    priority: s.severity as Confidence,
  }),
  churn: (s) => ({
    action: `Open a 7-day retention review focused on the ${s.metric ?? "churn"} cohort`,
    reasoning: `Churn at ${s.metric ?? "elevated levels"} is far cheaper to fix early. ${s.evidence}`,
    priority: s.severity as Confidence,
  }),
  cash_or_runway: () => ({
    action: `Refresh the 13-week cash forecast and pull AR > 30 days into a recovery list this week`,
    reasoning: `Liquidity questions deserve a checked answer, not a verbal estimate.`,
    priority: "High",
  }),
  customer_concentration: (s) => ({
    action: `Build a contingency plan for the top customer dependency before next quarter`,
    reasoning: `${s.evidence} A single account moving the whole number is a structural exposure.`,
    priority: s.severity as Confidence,
  }),
  category_concentration: (s) => ({
    action: `Diversify the dominant segment exposure on a 90-day plan`,
    reasoning: `${s.evidence} Concentration above ~35% leaves the topline tied to one input.`,
    priority: s.severity as Confidence,
  }),
  delay_or_slippage: (s) => ({
    action: `Re-baseline the slipping items this week with a named owner and a forcing date`,
    reasoning: `${s.evidence} Slipping pipeline tends to slip again unless a fresh commit is set.`,
    priority: s.severity as Confidence,
  }),
  support_degradation: (s) => ({
    action: `Triage open support escalations and publish a 48-hour fix-rate target`,
    reasoning: `${s.evidence} Service degradation visibly precedes churn — staunch the bleeding first.`,
    priority: s.severity as Confidence,
  }),
  dependency: (s) => ({
    action: `Identify a second source for the dependency cited and time-box a 30-day pilot`,
    reasoning: `${s.evidence} Single-source dependencies are the cheapest risk to retire early.`,
    priority: "High",
  }),
  missing_data: (s) => ({
    action: `Fix the upstream capture for ${labelFromTitle(s.title)} this week before re-running analysis`,
    reasoning: `${s.evidence} Missing data silently warps every downstream metric.`,
    priority: s.severity as Confidence,
  }),
  outlier_row: (s) => ({
    action: `Investigate the outlier row(s) flagged before treating averages as representative`,
    reasoning: `${s.evidence} Outliers can either be the story or contaminate it — find out which.`,
    priority: "Medium",
  }),
  growth: (s) => ({
    action: `Double down on the channel driving the ${s.metric ?? "growth"} and protect it from distraction`,
    reasoning: `${s.evidence} Concentrate effort where the data already says yes.`,
    priority: "Medium",
  }),
};

function defaultRec(s: BusinessSignal): Recommendation {
  return {
    action: `Validate the strongest signal in the input before taking action`,
    reasoning: `${s.evidence} A single grounded check beats a broad plan when signal is thin.`,
    priority: "Low",
  };
}

function buildSummary(profile: Profile, signals: BusinessSignal[]): string {
  const shape =
    profile.kind === "csv"
      ? `${profile.rowCount} rows × ${profile.columnCount} columns`
      : profile.kind === "text"
      ? `${profile.lineCount} line${profile.lineCount === 1 ? "" : "s"} · ${profile.numbers.length} numeric mention${profile.numbers.length === 1 ? "" : "s"}`
      : "no data";
  if (signals.length === 0) {
    return `${shape}. No business signals strong enough to flag — try richer input.`;
  }
  const headline = signals[0];
  const second = signals[1];
  const secondFragment = second ? ` Secondary: ${second.title.toLowerCase()}.` : "";
  return `${shape}. Headline: ${headline.title}.${secondFragment}`.slice(0, 320);
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal → output mapping
// ─────────────────────────────────────────────────────────────────────────────

function signalToInsight(s: BusinessSignal): Insight {
  return {
    title: s.title,
    evidence: s.evidence,
    impact: impactCopy(s),
    confidence: s.confidence as Confidence,
  };
}

function signalToRisk(s: BusinessSignal): Risk {
  return {
    title: s.title,
    severity: s.severity as Confidence,
    reason: s.evidence,
    confidence: s.confidence as Confidence,
  };
}

function impactCopy(s: BusinessSignal): string {
  switch (s.kind) {
    case "decline":
      return `If sustained, compounds against the topline; root-cause matters more than the magnitude.`;
    case "growth":
      return `Worth protecting and pressure-testing — confirm it's not a comp-period artifact.`;
    case "churn":
      return `Churn flows directly through to recurring revenue — early-stage fix is the cheap one.`;
    case "customer_concentration":
      return `Concentrated revenue means a single account's behavior moves the entire reporting line.`;
    case "category_concentration":
      return `Dominant category exposure narrows resilience to demand shifts in that segment.`;
    case "cash_or_runway":
      return `Cash signals dictate scenario planning and should override most other prioritization.`;
    case "missing_data":
      return `Every metric computed on this column is implicitly biased until capture is fixed.`;
    case "outlier_row":
      return `Outliers either are the story or distort the averages — handle before reporting.`;
    case "support_degradation":
      return `Service degradation typically leads churn by 1–2 reporting cycles.`;
    case "delay_or_slippage":
      return `Slippage usually compounds — a fresh commit date is worth more than a status update.`;
    case "dependency":
      return `Single-source dependencies are the cheapest exposure to retire early.`;
    case "retention_pressure":
      return `Retention conversations are leading indicators — worth a dedicated review window.`;
    case "data_sparse":
      return `Small samples produce unstable estimates; treat conclusions as directional only.`;
    case "negative_sentiment":
      return `Qualitative tone is a soft signal but worth pairing with a quantitative check.`;
    case "positive_sentiment":
      return `Positive tone alone isn't predictive — confirm with a numeric metric.`;
    default:
      return `Worth a closer look — directional only without more data.`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallbacks for sparse input
// ─────────────────────────────────────────────────────────────────────────────

function structuralInsight(profile: Profile, slot: number): Insight {
  if (profile.kind === "csv") {
    const cols = profile.columns.map((c) => c.name).slice(0, 6).join(", ");
    return {
      title: `Data shape: ${profile.rowCount} rows × ${profile.columnCount} columns`,
      evidence: `Columns: ${cols || "(none parsed)"}.`,
      impact: `Structural-only insight — sample is too small or too clean for a business pattern to surface deterministically.`,
      confidence: "Low",
    };
  }
  if (profile.kind === "text") {
    return {
      title: `Sparse signal in notes: ${profile.numbers.length} numeric mention${profile.numbers.length === 1 ? "" : "s"}`,
      evidence: `${profile.lineCount} lines / ${profile.charCount} chars; insufficient anchors for a strong claim.`,
      impact: `Free-text without numeric anchors limits how confidently any insight can be stated.`,
      confidence: "Low",
    };
  }
  return {
    title: `No data ingested (slot ${slot + 1})`,
    evidence: "Input was empty after normalization.",
    impact: "Nothing to act on until data is provided.",
    confidence: "Low",
  };
}

function structuralRisk(profile: Profile, slot: number): Risk {
  if (profile.kind === "csv" && profile.rowCount < 10) {
    return {
      title: "Sample size limits inference",
      severity: "Medium",
      reason: `${profile.rowCount} rows is below the threshold where averages or trends are statistically meaningful.`,
      confidence: "High",
    };
  }
  return {
    title: slot === 0 ? "No structural risk surfaced from this snapshot" : "Insufficient data for a second risk",
    severity: "Low",
    reason: "Either the input is genuinely low-risk or the deterministic pass lacks the context to spot one — pair with an API key for LLM judgment.",
    confidence: "Low",
  };
}

function emptyAnalysis(): Analysis {
  return {
    summary: "No input — paste a CSV or business notes to analyze.",
    insights: [
      { title: "No data provided", evidence: "Input was empty after trimming.", impact: "Nothing to analyze.", confidence: "Low" },
      { title: "No data provided", evidence: "Input was empty after trimming.", impact: "Nothing to analyze.", confidence: "Low" },
      { title: "No data provided", evidence: "Input was empty after trimming.", impact: "Nothing to analyze.", confidence: "Low" },
    ],
    risks: [
      { title: "No input", severity: "Low", reason: "Nothing to analyze.", confidence: "Low" },
      { title: "No input", severity: "Low", reason: "Nothing to analyze.", confidence: "Low" },
    ],
    recommendation: { action: "Paste a CSV or notes", reasoning: "Need data to produce insights.", priority: "Low" },
  };
}

function labelFromTitle(title: string): string {
  // Extract a column name out of titles like "47% of revenue is missing".
  const m = title.match(/of ([\w\s_]+) is missing/i);
  return m ? m[1].trim() : "the affected column";
}
