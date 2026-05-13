import { NextResponse } from "next/server";
import { analyze } from "@/lib/analyze";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { input?: string; apiKey?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = (body.input ?? "").trim();
  if (input.length < 20) {
    return NextResponse.json(
      { error: "Need more data — paste at least a few rows or a paragraph." },
      { status: 400 }
    );
  }

  try {
    const result = await analyze(input, { apiKey: body.apiKey, model: body.model });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    console.error("[analyze] error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
