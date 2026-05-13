"use client";

import { useRef, useState } from "react";
import type { Analysis } from "@/lib/schema";
import type { Profile } from "@/lib/stats";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; analysis: Analysis; profile: Profile };

export default function Page() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [showProfile, setShowProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onAnalyze() {
    if (input.trim().length < 20) {
      setState({ kind: "error", message: "Paste at least a few rows of CSV or a paragraph of notes." });
      return;
    }
    setState({ kind: "loading" });
    setShowProfile(false);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: data.error ?? `Request failed (${res.status})` });
        return;
      }
      setState({ kind: "ok", analysis: data.analysis, profile: data.profile });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Network error" });
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setInput(text);
    setState({ kind: "idle" });
  }

  async function onTrySample() {
    const res = await fetch("/sample.csv");
    const text = await res.text();
    setInput(text);
    setState({ kind: "idle" });
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Tiny Insight Dashboard</h1>
        <p className="mt-2 text-neutral-600">
          Paste messy business data or notes. Get 3 insights, 2 risks, and 1 action.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a CSV, or notes like 'Q1 revenue 1.2M, down 8% YoY; churn 4.1%; two enterprise deals slipped'..."
          className="w-full resize-y rounded-t-xl bg-transparent p-4 font-mono text-sm leading-relaxed text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
          rows={10}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
            >
              Upload CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={onFile}
            />
            <button
              type="button"
              onClick={onTrySample}
              className="text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
            >
              Try sample data
            </button>
            {input.length > 0 && (
              <span className="text-neutral-400">·  {input.length.toLocaleString()} chars</span>
            )}
          </div>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={state.kind === "loading"}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.kind === "loading" ? (
              <span>
                Analyzing<span className="dot-loader" />
              </span>
            ) : (
              "Analyze"
            )}
          </button>
        </div>
      </section>

      <section className="mt-8">
        {state.kind === "idle" && (
          <p className="text-sm text-neutral-400">Results will appear here.</p>
        )}

        {state.kind === "error" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong className="font-semibold">Something went wrong. </strong>
            {state.message}
          </div>
        )}

        {state.kind === "ok" && (
          <div className="space-y-8">
            <Block label="Insights" tone="neutral">
              <ol className="space-y-4">
                {state.analysis.insights.map((it, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium text-white">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium text-neutral-900">{it.title}</p>
                      <p className="mt-0.5 text-sm text-neutral-600">{it.evidence}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Block>

            <Block label="Risks" tone="warn">
              <ul className="space-y-4">
                {state.analysis.risks.map((it, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 shrink-0 text-amber-600">⚠</span>
                    <div>
                      <p className="font-medium text-neutral-900">{it.title}</p>
                      <p className="mt-0.5 text-sm text-neutral-600">{it.why}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Block>

            <Block label="Recommended action" tone="accent">
              <div className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-emerald-600">→</span>
                <div>
                  <p className="font-medium text-neutral-900">{state.analysis.action.title}</p>
                  <p className="mt-0.5 text-sm text-neutral-600">{state.analysis.action.rationale}</p>
                </div>
              </div>
            </Block>

            <details
              className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm"
              open={showProfile}
              onToggle={(e) => setShowProfile((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer select-none text-neutral-600 hover:text-neutral-900">
                Show extracted stats (the deterministic floor)
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 text-xs text-neutral-700">
                {JSON.stringify(state.profile, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </section>

      <footer className="mt-16 text-xs text-neutral-400">
        Hybrid analysis: deterministic profile → Claude shapes it into judgment-grade prose. See README for details.
      </footer>
    </main>
  );
}

function Block({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "neutral" | "warn" | "accent";
  children: React.ReactNode;
}) {
  const accent =
    tone === "warn"
      ? "border-amber-200 bg-amber-50/40"
      : tone === "accent"
      ? "border-emerald-200 bg-emerald-50/40"
      : "border-neutral-200 bg-white";
  return (
    <div className={`rounded-xl border ${accent} px-5 py-4`}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</h2>
      {children}
    </div>
  );
}
