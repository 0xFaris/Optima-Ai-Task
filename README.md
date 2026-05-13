# Tiny Insight Dashboard

A small Next.js app that takes messy business data (CSV) or pasted free-text notes and returns a **summary**, **3 insights**, **2 risks**, and **1 recommended action** — each carrying a confidence/severity/priority tag so you can prioritize at a glance.

The brief asks for *judgment* over polish. The design optimizes for two things: outputs that feel like they came from a smart analyst, and a single paste-and-go flow you can demo without setup.

## Reasoning flow

Three stages run in order. Each stage's output is fed forward — and each stage is also independently useful on its own:

```
   raw paste
       │
       ▼
┌───────────────────────────┐
│ 1. Profile (stats.ts)     │  normalize whitespace, parse CSV vs text,
│                           │  infer column types, missingness, ranges,
│                           │  numeric mentions in prose
└──────────────┬────────────┘
               ▼
┌───────────────────────────┐
│ 2. Signals (signals.ts)   │  ranked, named business patterns:
│                           │  growth, decline, churn, customer/category
│                           │  concentration, outliers, missing data,
│                           │  support degradation, delays, cash/runway,
│                           │  single-source dependency, sentiment
└──────────────┬────────────┘
               ▼
┌───────────────────────────────────────────────────────────┐
│ 3a. Deterministic (deterministic.ts) — always runs        │
│     turns the top signals into a complete 3/2/1 result    │
│     with confidence + severity + priority. This is the    │
│     "stats-only" floor, served with zero LLM cost.        │
├───────────────────────────────────────────────────────────┤
│ 3b. LLM framing (analyze.ts) — only if an API key is set  │
│     Claude receives raw input + Profile + Signals and     │
│     reshapes them into consultant-grade prose. Output is  │
│     schema-validated (Zod) and semantically validated     │
│     (validate.ts) for duplicates / generics / hallucinated│
│     numbers / unconnected recommendations. One retry on   │
│     failure, then graceful fallback to 3a.                │
└───────────────────────────────────────────────────────────┘
```

The key idea: stage 2 (signals) is where the *business* judgment lives. It converts numbers into named patterns ("47% concentration on Acme Corp", "+12% growth cited", "missing 31% of `units`") that downstream stages can ground claims against. Without it, the LLM has to invent the framing; with it, the LLM mostly picks and writes prose around already-found patterns.

## Output shape

```json
{
  "summary": "…",
  "insights": [
    { "title": "…", "evidence": "…", "impact": "…", "confidence": "High|Medium|Low" }
  ],
  "risks": [
    { "title": "…", "severity": "High|Medium|Low", "reason": "…", "confidence": "…" }
  ],
  "recommendation": {
    "action": "…", "reasoning": "…", "priority": "High|Medium|Low"
  }
}
```

## Validation layer (`validate.ts`)

After Zod accepts the LLM response, four extra checks run before we trust it:

1. **No near-duplicate insights or risks** (60%+ word overlap is rejected).
2. **No generic platitudes** — a small blocklist catches phrases like "may improve", "monitor closely", "focus on growth".
3. **Numeric grounding** — every cited `X%` or `$Y` is grepped against the raw input; un-grounded numbers are rejected.
4. **Recommendation must reference findings** — at least one content word (>4 chars) from an insight or risk title must appear in the recommendation prose.

If any rule fails, the parser feeds the error back to the model and asks once for a retry. After two failures the tool falls back to the deterministic result rather than showing a flawed one.

## Run locally

Requires Node 20+ and `pnpm` (or `npm`).

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. Click **Try sample** then **Analyze** to see the deterministic half end-to-end immediately — no API key required.

For the full **Hybrid** mode, paste your API key into the in-browser **Settings** panel (top right) — it's sent only with the request and never stored server-side. You can also keep it in `localStorage` via the "Remember in this browser" toggle, or use `.env.local`:

```bash
cp .env.local.example .env.local
# edit and set ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

### Environment / settings

| Setting | Source | Default | Notes |
|---|---|---|---|
| API key | Settings panel or `ANTHROPIC_API_KEY` | — | Required for hybrid mode |
| Model | Settings panel or `ANALYSIS_MODEL` | `claude-opus-4-7` | Pick Opus / Sonnet / Haiku from the picker |

## File map

```
src/
  app/
    api/analyze/route.ts   POST handler; validates input, calls analyze()
    layout.tsx             root layout
    page.tsx               UI: paste/upload, settings panel, chip-tagged results
    globals.css
  lib/
    schema.ts              Zod schema for the final 3/2/1 output
    stats.ts               CSV + text profiler (normalize, types, missing, trend)
    signals.ts             Business analysis layer — ranked BusinessSignal[]
    deterministic.ts       Signals → complete 3/2/1 result (stats-only floor)
    prompt.ts              LLM system prompt (consultant framing, anti-hallucination)
    analyze.ts             Anthropic call + parse + schema + semantic validation + retry
    validate.ts            Duplicate / generic-phrase / grounding / connection checks
public/
  sample.csv               Messy sales fixture for the "Try sample" button
```

## What I'd improve next (production-grade roadmap)

1. **Streaming responses.** A 5–10s wait for Opus feels slow even when the output is good. Streaming the summary first, then insights, then risks, then the action would make it feel ~instant.
2. **Citation overlay.** Each insight already references specific values; clicking one should scroll/highlight the matching row in the source CSV. This is the obvious UX leap for trust.
3. **Multi-snapshot diff.** "This month's CSV vs last month's" is the actual business question; today the tool only sees one snapshot. The signals layer is already a natural diff surface — same kinds, different magnitudes.

## How the improvements raise judgment quality

- **Signals layer separates "find" from "write"**, so the LLM stops inventing framing and focuses on prose. This is the single biggest quality lift.
- **Confidence + severity tags** force the model to admit when a signal is thin instead of overclaiming — and let the reader prioritize at a glance.
- **Numeric grounding check** stops the most common hallucination class (a plausible-looking percentage that isn't in the data).
- **Recommendation-must-connect-to-findings rule** kills floating advice that doesn't answer the data in front of it.
- **Anti-generic blocklist** strips out the "monitor closely / may improve" filler that makes AI output feel anonymous.
- **Deterministic fallback uses the same signal pipeline**, so the stats-only mode is genuinely useful — not a degraded placeholder.
