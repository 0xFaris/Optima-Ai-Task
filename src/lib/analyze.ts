import Anthropic from "@anthropic-ai/sdk";
import { AnalysisSchema, type Analysis } from "./schema";
import { SYSTEM_PROMPT } from "./prompt";
import { buildProfile, type Profile } from "./stats";

const DEFAULT_MODEL = "claude-opus-4-7";

export type AnalyzeResult = { analysis: Analysis; profile: Profile };

export async function analyze(rawInput: string): Promise<AnalyzeResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const { profile, truncatedInput } = buildProfile(rawInput);
  if (profile.kind === "empty") {
    throw new Error("Need more data — input is empty.");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANALYSIS_MODEL || DEFAULT_MODEL;

  const userMessage = buildUserMessage(truncatedInput, profile);

  const firstAttempt = await callModel(client, model, userMessage);
  const parsed = tryParse(firstAttempt);
  if (parsed.ok) return { analysis: parsed.value, profile };

  const retry = await callModel(client, model, userMessage, {
    priorAttempt: firstAttempt,
    parseError: parsed.error,
  });
  const reparsed = tryParse(retry);
  if (reparsed.ok) return { analysis: reparsed.value, profile };

  throw new Error(`Model returned invalid JSON after retry: ${reparsed.error}`);
}

function buildUserMessage(rawInput: string, profile: Profile): string {
  return [
    "Raw input:",
    "```",
    rawInput,
    "```",
    "",
    "Deterministic Profile (use this as your source of truth for numeric claims):",
    "```json",
    JSON.stringify(profile, null, 2),
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

function tryParse(raw: string): { ok: true; value: Analysis } | { ok: false; error: string } {
  const cleaned = stripCodeFences(raw).trim();
  try {
    const obj = JSON.parse(cleaned);
    const result = AnalysisSchema.safeParse(obj);
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function stripCodeFences(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1] : s;
}
