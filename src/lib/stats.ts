import Papa from "papaparse";

export type Profile =
  | {
      kind: "csv";
      rowCount: number;
      columnCount: number;
      truncated: boolean;
      columns: ColumnProfile[];
      headRows: Record<string, string>[];
      dateColumn?: string;
      trend?: { column: string; firstBucketAvg: number; lastBucketAvg: number; deltaPct: number };
    }
  | {
      kind: "text";
      charCount: number;
      lineCount: number;
      truncated: boolean;
      numbers: Array<{ value: number; unit: string | null; context: string }>;
      topTerms: Array<{ term: string; count: number }>;
    }
  | { kind: "empty" };

export type ColumnProfile = {
  name: string;
  detectedType: "number" | "date" | "category" | "text";
  missingPct: number;
  unique: number;
  numeric?: { min: number; max: number; mean: number; median: number };
  top?: Array<{ value: string; count: number }>;
};

const MAX_CHARS = 8000;

export function buildProfile(rawInput: string): { profile: Profile; truncatedInput: string } {
  const truncated = rawInput.length > MAX_CHARS;
  const input = truncated ? rawInput.slice(0, MAX_CHARS) : rawInput;

  if (!input.trim()) {
    return { profile: { kind: "empty" }, truncatedInput: input };
  }

  if (looksLikeCsv(input)) {
    return { profile: profileCsv(input, truncated), truncatedInput: input };
  }
  return { profile: profileText(input, truncated), truncatedInput: input };
}

function looksLikeCsv(input: string): boolean {
  const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const firstCommas = (lines[0].match(/,/g) || []).length;
  const secondCommas = (lines[1].match(/,/g) || []).length;
  if (firstCommas >= 1 && firstCommas === secondCommas) return true;
  const firstTabs = (lines[0].match(/\t/g) || []).length;
  const secondTabs = (lines[1].match(/\t/g) || []).length;
  if (firstTabs >= 1 && firstTabs === secondTabs) return true;
  return false;
}

function profileCsv(input: string, truncated: boolean): Profile {
  const parsed = Papa.parse<Record<string, string>>(input, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  const rows = parsed.data.filter((r) => r && Object.keys(r).length > 0);
  const headers = parsed.meta.fields ?? [];
  const columns: ColumnProfile[] = headers.map((name) => profileColumn(name, rows));

  const dateCol = columns.find((c) => c.detectedType === "date")?.name;
  let trend: Profile["trend"] | undefined;
  if (dateCol) {
    const numericCol = columns.find((c) => c.detectedType === "number");
    if (numericCol) {
      trend = computeTrend(rows, dateCol, numericCol.name);
    }
  }

  return {
    kind: "csv",
    rowCount: rows.length,
    columnCount: headers.length,
    truncated,
    columns,
    headRows: rows.slice(0, 5),
    dateColumn: dateCol,
    trend,
  };
}

function profileColumn(name: string, rows: Record<string, string>[]): ColumnProfile {
  const raw = rows.map((r) => (r[name] ?? "").trim());
  const nonEmpty = raw.filter((v) => v.length > 0);
  const missingPct = rows.length === 0 ? 0 : Math.round(((rows.length - nonEmpty.length) / rows.length) * 100);

  const numericValues = nonEmpty
    .map((v) => Number(v.replace(/[$,%\s]/g, "")))
    .filter((n) => Number.isFinite(n));
  const numericRatio = nonEmpty.length === 0 ? 0 : numericValues.length / nonEmpty.length;

  const dateValues = nonEmpty.filter((v) => !Number.isNaN(Date.parse(v)));
  const dateRatio = nonEmpty.length === 0 ? 0 : dateValues.length / nonEmpty.length;

  let detectedType: ColumnProfile["detectedType"] = "text";
  if (numericRatio >= 0.7) detectedType = "number";
  else if (dateRatio >= 0.7) detectedType = "date";
  else if (new Set(nonEmpty).size <= Math.max(10, nonEmpty.length * 0.5)) detectedType = "category";

  const unique = new Set(nonEmpty).size;

  const profile: ColumnProfile = { name, detectedType, missingPct, unique };

  if (detectedType === "number" && numericValues.length > 0) {
    const sorted = [...numericValues].sort((a, b) => a - b);
    profile.numeric = {
      min: round(sorted[0]),
      max: round(sorted[sorted.length - 1]),
      mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      median: round(sorted[Math.floor(sorted.length / 2)]),
    };
  }

  if (detectedType === "category" || detectedType === "text") {
    const counts = new Map<string, number>();
    for (const v of nonEmpty) counts.set(v, (counts.get(v) ?? 0) + 1);
    profile.top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  }

  return profile;
}

function computeTrend(
  rows: Record<string, string>[],
  dateCol: string,
  numCol: string
): { column: string; firstBucketAvg: number; lastBucketAvg: number; deltaPct: number } | undefined {
  const points = rows
    .map((r) => ({
      t: Date.parse(r[dateCol] ?? ""),
      v: Number((r[numCol] ?? "").replace(/[$,%\s]/g, "")),
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (points.length < 4) return undefined;
  points.sort((a, b) => a.t - b.t);
  const half = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, half);
  const lastHalf = points.slice(points.length - half);
  const firstAvg = firstHalf.reduce((s, p) => s + p.v, 0) / firstHalf.length;
  const lastAvg = lastHalf.reduce((s, p) => s + p.v, 0) / lastHalf.length;
  const delta = firstAvg === 0 ? 0 : ((lastAvg - firstAvg) / Math.abs(firstAvg)) * 100;
  return {
    column: numCol,
    firstBucketAvg: round(firstAvg),
    lastBucketAvg: round(lastAvg),
    deltaPct: round(delta),
  };
}

function profileText(input: string, truncated: boolean): Profile {
  const lines = input.split(/\r?\n/);
  const numberRegex = /(-?\$?\d[\d,]*\.?\d*)\s*(%|k|m|bn|b|million|thousand|pts|bps|days?|weeks?|months?|qtr|q[1-4])?/gi;
  const numbers: Array<{ value: number; unit: string | null; context: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = numberRegex.exec(input)) !== null) {
    const raw = match[1];
    const value = Number(raw.replace(/[$,]/g, ""));
    if (!Number.isFinite(value)) continue;
    const start = Math.max(0, match.index - 30);
    const end = Math.min(input.length, match.index + match[0].length + 30);
    numbers.push({
      value,
      unit: match[2] ? match[2].toLowerCase() : null,
      context: input.slice(start, end).replace(/\s+/g, " ").trim(),
    });
    if (numbers.length >= 30) break;
  }

  const stopwords = new Set([
    "the","a","an","and","or","but","of","to","in","for","on","at","with","is","are","was","were",
    "this","that","it","be","by","as","from","we","they","their","our","has","have","had","not",
    "no","i","you","he","she","them","its","than","so","also","more","less","up","down","new","old",
  ]);
  const tokenCounts = new Map<string, number>();
  for (const tok of input.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    if (stopwords.has(tok)) continue;
    tokenCounts.set(tok, (tokenCounts.get(tok) ?? 0) + 1);
  }
  const topTerms = [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));

  return {
    kind: "text",
    charCount: input.length,
    lineCount: lines.length,
    truncated,
    numbers,
    topTerms,
  };
}

function round(n: number, places = 2): number {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
