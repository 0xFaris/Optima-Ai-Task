# Tiny Insight Dashboard

A small Next.js app that takes a messy business dataset (CSV) or pasted free-text notes and returns **3 insights, 2 risks, and 1 recommended action**.

The brief asked for judgment and UX over polish, so the design optimizes for two things: outputs that are actually useful, and a single paste-and-go flow.

## How it works

Two-stage **hybrid analysis**:

1. **Deterministic profiling** — `src/lib/stats.ts` parses the input (CSV via `papaparse` or free text), infers column types, computes missingness, ranges, top categories, extracts numbers and rough trends. This is the "floor" of facts the model is allowed to claim.
2. **LLM framing** — `src/lib/analyze.ts` sends the raw input *plus* the deterministic profile to Claude Opus 4.7 with a strict system prompt that forbids inventing numbers. The response is validated against a Zod schema (`src/lib/schema.ts`); a malformed response is retried once with the parse error fed back to the model.

The UI exposes the deterministic profile under a **"Show extracted stats"** disclosure so you can verify the model didn't make anything up.

## Run locally

Requires Node 20+ and `pnpm` (or `npm`).

```bash
pnpm install
cp .env.local.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

Open <http://localhost:3000>. Click **Try sample data** then **Analyze** for the fastest end-to-end check.

### Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | Your Anthropic API key |
| `ANALYSIS_MODEL` | no | `claude-opus-4-7` | Swap for `claude-sonnet-4-6` to trade judgment quality for cost |

## AI tools used

- **Authoring**: The code in this repo was written with **Claude Code (Opus 4.7)** in a single planning + implementation session. Planning was done up-front with explicit choices (web vs CLI, hybrid vs pure-LLM, Next.js vs Python), then implemented top-to-bottom.
- **Runtime**: The app itself calls **Claude Opus 4.7** via the Anthropic SDK for the analysis step. I chose Opus over Sonnet because the brief weights *judgment* highly — Sonnet is faster and cheaper but I wanted the model with the strongest reasoning for the demo. The `ANALYSIS_MODEL` env var lets you switch.
- **Prompt caching**: the system prompt is marked `cache_control: ephemeral` so repeated requests pay reduced token cost on the system block.

## Validation

I treated this as a "do the outputs hold up?" question rather than a unit-test question, since the value is in the model's judgment, not in any single function.

- **Three fixtures**, run end-to-end:
  - `public/sample.csv` — a messy sales CSV (mixed currency formats `$14400` vs `$18,000`, one blank `units` cell, mixed `closed-won` / `closed-lost` / `open` statuses, 4 regions, 4 reps, 3 products).
  - A pasted notes blob ("Q1 revenue 1.2M, down 8% YoY; churn 4.1%; NPS 38; two enterprise deals slipped to Q2") to confirm free-text inputs produce grounded insights.
  - A 3-row CSV edge case to confirm the model degrades gracefully (acknowledges sparse data instead of inventing trends).
- **Cross-check**: every numeric claim in the output was reconciled against the "Show extracted stats" panel. Two early prompt drafts let Opus invent percentages that didn't exist in the data — tightening the system prompt's "MUST appear in the Profile" rule fixed it.
- **Schema enforcement**: a malformed JSON response triggers one automatic retry with the parse error fed back. After two failures the user sees an error, not a partial result.
- **Empty / undersized input**: the API rejects inputs under 20 chars before any LLM call.

## What I'd improve next

In order of impact, if I had another half-day on this:

1. **Stream the response.** A 5–10s wait for Opus feels slow even when the output is good. Streaming partial sections (Insights first, then Risks, then Action) would make it feel ~instant.
2. **Citation overlay.** Each insight already references specific values; clicking one should scroll/highlight the relevant rows in the source CSV. This is the obvious UX leap for trust.
3. **Multi-document diff.** "This month's CSV vs last month's" is the actual business question; today the tool only sees one snapshot.
4. **Confidence per insight.** Currently every insight reads with equal weight. A 1–5 confidence score (or a "thin signal" tag) would help users prioritize.
5. **Pluggable profilers.** The current `buildProfile` is one function; splitting it into registered profilers (CSV / JSON / log lines / meeting notes) would let the tool grow without `if/else` sprawl.
6. **Persist + share.** A short shareable URL backed by hashed input would make this useful for "show this to the team," not just personal exploration.
7. **Schema-first refusal.** Today an LLM-invented number that *happens* to look plausible would slip through. A post-validation step that greps each cited number against the raw input would be a much stronger guardrail than relying on the prompt.

## File map

```
src/
  app/
    api/analyze/route.ts   POST handler; validates input, calls analyze()
    layout.tsx
    page.tsx               Single-page UI (paste/upload/analyze + results)
    globals.css
  lib/
    schema.ts              Zod schema for the LLM response
    prompt.ts              System prompt
    stats.ts               Deterministic CSV / text profiler
    analyze.ts             Anthropic call + zod validation + 1 retry
public/
  sample.csv               Messy sales fixture for the "Try sample" button
```

## Submission

This repo is the deliverable. To turn it into either submission form:

- **GitHub**: `git remote add origin <url> && git push -u origin main`
- **ZIP**: `zip -r tiny-insight-dashboard.zip . -x 'node_modules/*' -x '.next/*' -x '.env.local'`
