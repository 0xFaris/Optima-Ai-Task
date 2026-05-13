import type { Analysis } from "./schema";

// Semantic validation beyond what the Zod schema can express. Returns ok or a
// human-readable error that we feed back to the model on retry. Each rule
// targets a real failure mode we want to keep out of the demo:
//   - duplicate insights / risks (same point, two phrasings)
//   - generic platitudes ("monitor closely", "may improve")
//   - hallucinated numbers (cited but never appear in the raw input)
//   - recommendation that doesn't connect to any finding above it
export function validateAnalysis(
  a: Analysis,
  rawInput: string
): { ok: true } | { ok: false; error: string } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const titles = a.insights.map((i) => norm(i.title));
  if (hasNearDuplicates(titles)) {
    return { ok: false, error: "Two insights are near-duplicates — make each one a distinct point." };
  }
  const riskTitles = a.risks.map((r) => norm(r.title));
  if (hasNearDuplicates(riskTitles)) {
    return { ok: false, error: "The two risks are near-duplicates — they must be distinct." };
  }

  for (const it of a.insights) {
    if (isGeneric(it.title) || isGeneric(it.evidence)) {
      return { ok: false, error: `Generic phrasing in an insight ("${truncate(it.title)}"). Make it specific and grounded.` };
    }
  }
  for (const r of a.risks) {
    if (isGeneric(r.title) || isGeneric(r.reason)) {
      return { ok: false, error: `Generic phrasing in a risk ("${truncate(r.title)}"). Name the specific exposure.` };
    }
  }
  if (isGeneric(a.recommendation.action) || isGeneric(a.recommendation.reasoning)) {
    return { ok: false, error: "Recommendation is generic — make it concrete and time-bounded, tied to a specific finding." };
  }

  // Numeric grounding — every percent or currency figure cited must appear in
  // the input. We intentionally only check the most-likely-hallucinated forms
  // (X%, $Y) and let the LLM phrase qualitative claims freely.
  const inputLower = rawInput.toLowerCase().replace(/\s+/g, " ");
  for (const it of [...a.insights, ...a.risks]) {
    const cited = extractCitedNumbers(("title" in it ? it.title : "") + " " + (("evidence" in it ? it.evidence : "") + " " + (("reason" in it ? it.reason : ""))));
    for (const c of cited) {
      if (!inputLower.includes(c.needle)) {
        return { ok: false, error: `Cited "${c.literal}" but it isn't in the input. Use only numbers present in the data.` };
      }
    }
  }

  // Recommendation must echo at least one content word (>4 chars) from an
  // insight or risk title — i.e., it must reference a finding, not stand alone.
  const findings = [...a.insights.map((i) => i.title), ...a.risks.map((r) => r.title)]
    .map(norm)
    .join(" ");
  const recWords = norm(a.recommendation.action + " " + a.recommendation.reasoning)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4);
  const findingsWords = new Set(findings.split(/[^a-z0-9]+/).filter((w) => w.length > 4));
  const overlap = recWords.some((w) => findingsWords.has(w));
  if (!overlap) {
    return { ok: false, error: "Recommendation doesn't reference any insight or risk above. Tie it to a specific finding." };
  }

  return { ok: true };
}

// Two strings count as near-duplicates if 60%+ of their non-trivial words match.
function hasNearDuplicates(items: string[]): boolean {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = new Set(items[i].split(/[^a-z0-9]+/).filter((w) => w.length > 3));
      const b = new Set(items[j].split(/[^a-z0-9]+/).filter((w) => w.length > 3));
      if (a.size === 0 || b.size === 0) continue;
      const inter = [...a].filter((w) => b.has(w)).length;
      const small = Math.min(a.size, b.size);
      if (inter / small >= 0.6) return true;
    }
  }
  return false;
}

const GENERIC_PHRASES = [
  "may improve",
  "could improve",
  "should improve",
  "monitor closely",
  "keep an eye",
  "focus on growth",
  "leverage synergies",
  "drive value",
  "best practices",
  "moving forward",
  "going forward",
  "various risks",
  "some risks",
  "there are some",
  "data quality matters",
  "alignment is important",
  "consider exploring",
  "consider implementing",
  "could benefit from",
  "looks promising",
];

function isGeneric(s: string): boolean {
  const lower = s.toLowerCase();
  return GENERIC_PHRASES.some((p) => lower.includes(p));
}

function extractCitedNumbers(s: string): Array<{ literal: string; needle: string }> {
  const out: Array<{ literal: string; needle: string }> = [];
  const re = /(\$?\d[\d,]*(?:\.\d+)?\s*(?:%|k|m|bn|b|million|thousand)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const literal = m[1].trim();
    // Skip trivially common bare integers (e.g. "1", "2") — they collide too
    // easily with row counts and produce false positives.
    const bare = literal.replace(/[^0-9.]/g, "");
    if (!bare) continue;
    if (bare.length < 2 && !/[%$kmb]/i.test(literal)) continue;
    out.push({ literal, needle: literal.toLowerCase().replace(/\s+/g, "").replace(/,/g, "") });
  }
  // Dedupe
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.needle) ? false : (seen.add(c.needle), true)));
}

function truncate(s: string, n = 60): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
