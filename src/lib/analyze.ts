import Anthropic from "@anthropic-ai/sdk";
import { AnalysisSchema, type Analysis } from "./schema";
import { SYSTEM_PROMPT } from "./prompt";
import { buildProfile, type Profile } from "./stats";
import { deterministicAnalysis } from "./deterministic";
import { extractSignals, type BusinessSignal } from "./signals";
import { validateAnalysis } from "./validate";

const DEFAULT_MODEL = "claude-opus-4-7";
export const SUPPORTED_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export type AnalyzeMode = "hybrid" | "stats-only";

export type AnalyzeOptions = {
  apiKey?: string;
  model?: string;
};

export type AnalyzeResult = {
  analysis: Analysis;
  profile: Profile;
  mode: AnalyzeMode;
  modelUsed?: string;
  notice?: string;
};

export async function analyze(rawInput: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const { profile, truncatedInput } = buildProfile(rawInput);
  if (profile.kind === "empty") {
    throw new Error("Need more data — input is empty.");
  }

  const fallback = deterministicAnalysis(profile, truncatedInput);
  const apiKey = opts.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      analysis: fallback,
      profile,
      mode: "stats-only",
      notice: "No API key provided — showing the deterministic half. Open Settings to add one and enable LLM framing.",
    };
  }

  const model = opts.model?.trim() || process.env.ANALYSIS_MODEL || DEFAULT_MODEL;

  try {
    const client = new Anthropic({ apiKey });
    const signals = extractSignals(truncatedInput, profile);
    const userMessage = buildUserMessage(truncatedInput, profile, signals);

    const firstAttempt = await callModel(client, model, userMessage);
    const parsed = parseAndValidate(firstAttempt, truncatedInput);
    if (parsed.ok) return { analysis: parsed.value, profile, mode: "hybrid", modelUsed: model };

    const retry = await callModel(client, model, userMessage, {
      priorAttempt: firstAttempt,
      parseError: parsed.error,
    });
    const reparsed = parseAndValidate(retry, truncatedInput);
    if (reparsed.ok) return { analysis: reparsed.value, profile, mode: "hybrid", modelUsed: model };

    return {
      analysis: fallback,
      profile,
      mode: "stats-only",
      notice: `LLM returned invalid JSON after retry (${reparsed.error}). Showing the deterministic half.`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      analysis: fallback,
      profile,
      mode: "stats-only",
      notice: `LLM call failed (${message}). Showing the deterministic half.`,
    };
  }
}

function buildUserMessage(rawInput: string, profile: Profile, signals: BusinessSignal[]): string {
  return [
    "Raw input:",
    "```",
    rawInput,
    "```",
    "",
    "Deterministic Profile (source of truth for numeric claims):",
    "```json",
    JSON.stringify(profile, null, 2),
    "```",
    "",
    `Detected BusinessSignals (ranked by score; use as your shortlist of patterns — ${signals.length} found):`,
    "```json",
    JSON.stringify(signals, null, 2),
    "```",
    "",
    "Return ONLY the JSON object specified in the system prompt.",
  ].join("\n");
}

async function callModel(
  client: Anthropic,
  model: string,
  userMessage: string,
  retry?: { priorAttempt: string; parseError: string }
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  if (retry) {
    messages.push({ role: "assistant", content: retry.priorAttempt });
    messages.push({
      role: "user",
      content: `Your previous response failed JSON parsing with: "${retry.parseError}". Return ONLY a valid JSON object matching the schema. No prose, no markdown.`,
    });
  }

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content");
  }
  return textBlock.text;
}

// Parse → schema-validate → semantic-validate. Any failure is returned with a
// human-readable error string that we feed back to the model on retry.
function parseAndValidate(
  raw: string,
  rawInput: string
): { ok: true; value: Analysis } | { ok: false; error: string } {
  const cleaned = stripCodeFences(raw).trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
  const schema = AnalysisSchema.safeParse(obj);
  if (!schema.success) {
    return {
      ok: false,
      error: schema.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  const semantic = validateAnalysis(schema.data, rawInput);
  if (!semantic.ok) return semantic;
  return { ok: true, value: schema.data };
}

function stripCodeFences(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1] : s;
}
