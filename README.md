# Tiny Insight Dashboard

A small Next.js app that takes a messy business dataset (CSV) or pasted free-text notes and returns **3 insights, 2 risks, and 1 recommended action**.

The brief asked for judgment and UX over polish, so the design optimizes for two things: outputs that are actually useful, and a single paste-and-go flow.

## How it works

Two-stage **hybrid analysis**. The two stages are independently useful — that's the design, not an accident:

1. **Deterministic profiling + analysis** — `src/lib/stats.ts` parses input (CSV via `papaparse` or free text), infers column types, computes missingness, ranges, top categories, detects rough trends, and extracts numeric mentions from prose. `src/lib/deterministic.ts` then turns that profile into a *complete* 3-insights / 2-risks / 1-action result on its own (concentration, trend reversal, data-quality flags for CSV; magnitude, sentiment direction, and recurring themes for text). This is the "floor" — what the tool can say with zero LLM cost.
2. **LLM framing** — when `ANTHROPIC_API_KEY` is set, `src/lib/analyze.ts` sends the raw input **plus** the deterministic profile to Claude Opus 4.7 with a strict system prompt that forbids inventing numbers. The response is validated against a Zod schema (`src/lib/schema.ts`); a malformed response is retried once with the parse error fed back to the model.

**Graceful degradation.** If the API key is missing, the LLM call fails, or the model returns invalid JSON twice, the tool falls back to the deterministic result and surfaces a **"STATS-ONLY"** badge in the UI explaining what happened. The submission works out-of-the-box without an API key.

The UI also exposes the underlying profile under a **"Show extracted stats"** disclosure so you can verify nothing was invented.

## Run locally

Requires Node 20+ and `pnpm` (or `npm`).

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> (or whatever port Next.js picks). Click **Try sample data** then **Analyze** to see the deterministic half end-to-end immediately — no API key required.

For the full **Hybrid** mode (LLM-framed prose), add a key:

```bash
cp .env.local.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

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

I treated this as a "do the outputs hold up?" question rather than a unit-test question, since the value is in the judgment, not in any single function.

- **Three fixtures**, run end-to-end in both modes:
  - `public/sample.csv` — a messy sales CSV (mixed currency formats `$14400` vs `$18,000`, one blank `units` cell, mixed `closed-won` / `closed-lost` / `open` statuses, 4 regions, 4 reps, 3 products).
  - A pasted notes blob ("Q1 revenue 1.2M, down 8% YoY; churn 4.1%; NPS 38; two enterprise deals slipped to Q2") to confirm free-text inputs produce grounded insights.
  - A 3-row CSV edge case to confirm the deterministic + LLM passes degrade gracefully (acknowledge sparse data instead of inventing trends).
- **Cross-check**: every numeric claim in the output was reconciled against the "Show extracted stats" panel. Two early bugs surfaced:
  - The text regex was matching `1` inside `Q1` — fixed with a `(?<![A-Za-z])` lookbehind.
  - "Largest figure" was comparing `38` vs `1.2M` without unit normalization — fixed by ranking on unit-normalized magnitude (`k`/`m`/`b`).
- **Schema enforcement**: a malformed JSON response triggers one automatic retry with the parse error fed back. After two failures the tool falls back to the deterministic result rather than showing a broken state.
- **Empty / undersized input**: the API rejects inputs under 20 chars before any analysis runs.
- **Graceful degradation**: confirmed end-to-end that with no `ANTHROPIC_API_KEY`, the page still produces sensible 3/2/1 output with a clearly labeled `STATS-ONLY` badge.

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
    deterministic.ts       Stats-only fallback analyzer (3 insights / 2 risks / 1 action)
    analyze.ts             Anthropic call + zod validation + 1 retry, falls back to deterministic
public/
  sample.csv               Messy sales fixture for the "Try sample" button
```

## Submission

This repo is the deliverable. To turn it into either submission form:

- **GitHub**: `git remote add origin <url> && git push -u origin main`
- **ZIP**: `zip -r tiny-insight-dashboard.zip . -x 'node_modules/*' -x '.next/*' -x '.env.local'`
