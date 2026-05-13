"use client";

import { useEffect, useRef, useState } from "react";
import type { Analysis, Confidence } from "@/lib/schema";
import type { Profile } from "@/lib/stats";
import type { AnalyzeMode } from "@/lib/analyze";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; analysis: Analysis; profile: Profile; mode: AnalyzeMode; notice?: string; modelUsed?: string };

const STORAGE = {
  apiKey: "tid_api_key",
  model: "tid_model",
  remember: "tid_remember",
};

const MODELS = [
  { id: "claude-opus-4-7", label: "Opus 4.7", hint: "strongest judgment · slower" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", hint: "balanced" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", hint: "fastest · cheapest" },
];

export default function Page() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [remember, setRemember] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    const r = localStorage.getItem(STORAGE.remember) === "1";
    setRemember(r);
    if (r) {
      setApiKey(localStorage.getItem(STORAGE.apiKey) ?? "");
      const m = localStorage.getItem(STORAGE.model);
      if (m) setModel(m);
    } else {
      const m = sessionStorage.getItem(STORAGE.model);
      if (m) setModel(m);
      const k = sessionStorage.getItem(STORAGE.apiKey);
      if (k) setApiKey(k);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (remember) {
      localStorage.setItem(STORAGE.remember, "1");
      localStorage.setItem(STORAGE.apiKey, apiKey);
      localStorage.setItem(STORAGE.model, model);
      sessionStorage.removeItem(STORAGE.apiKey);
      sessionStorage.removeItem(STORAGE.model);
    } else {
      localStorage.setItem(STORAGE.remember, "0");
      localStorage.removeItem(STORAGE.apiKey);
      localStorage.removeItem(STORAGE.model);
      sessionStorage.setItem(STORAGE.apiKey, apiKey);
      sessionStorage.setItem(STORAGE.model, model);
    }
  }, [mounted, remember, apiKey, model]);

  async function onAnalyze() {
    if (input.trim().length < 20) {
      setState({ kind: "error", message: "Paste at least a few rows of CSV or a paragraph of notes." });
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, apiKey: apiKey.trim() || undefined, model }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: data.error ?? `Request failed (${res.status})` });
        return;
      }
      setState({
        kind: "ok",
        analysis: data.analysis,
        profile: data.profile,
        mode: data.mode,
        notice: data.notice,
        modelUsed: data.modelUsed,
      });
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
    setInput(await res.text());
    setState({ kind: "idle" });
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onAnalyze();
    }
  }

  function clearInput() {
    setInput("");
    setState({ kind: "idle" });
  }

  function clearApiKey() {
    setApiKey("");
    localStorage.removeItem(STORAGE.apiKey);
    sessionStorage.removeItem(STORAGE.apiKey);
  }

  const hasKey = apiKey.trim().length > 0;
  const charCount = input.length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Tiny Insight Dashboard</h1>
          <p className="mt-2 text-sm text-neutral-600 sm:text-base">
            Paste messy business data or notes. Get 3 insights, 2 risks, 1 action.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            showSettings
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
          }`}
          aria-expanded={showSettings}
        >
          <span aria-hidden>⚙</span> Settings
          {mounted && hasKey && (
            <span className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${showSettings ? "bg-emerald-300" : "bg-emerald-500"}`} aria-label="API key configured" />
          )}
        </button>
      </header>

      {showSettings && (
        <section className="mb-6 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Configuration</p>
          </div>
          <div className="space-y-5 px-5 py-5">
            <div>
              <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-neutral-800">
                <span>Anthropic API key</span>
                {hasKey && (
                  <button
                    type="button"
                    onClick={clearApiKey}
                    className="text-xs font-normal text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </label>
              <div className="flex items-stretch gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 pr-10 font-mono text-sm tracking-tight text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-neutral-500 hover:bg-neutral-100"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
                Sent with each request; never stored on the server. Without a key, the app runs in <strong className="font-medium text-neutral-700">Stats-only</strong> mode.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-neutral-800">Model</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MODELS.map((m) => {
                  const active = model === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModel(m.id)}
                      className={`rounded-md border px-3 py-2 text-left transition ${
                        active
                          ? "border-neutral-900 bg-neutral-50"
                          : "border-neutral-200 bg-white hover:border-neutral-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-neutral-900">{m.label}</span>
                        {active && <span className="text-emerald-600">✓</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-500">{m.hint}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-400"
              />
              <span className="text-neutral-700">
                Remember in this browser
                <span className="block text-xs text-neutral-500">
                  Persist across reloads via localStorage. Uncheck to keep only for this tab.
                </span>
              </span>
            </label>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onTextareaKeyDown}
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
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={onFile} />
            <button
              type="button"
              onClick={onTrySample}
              className="text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
            >
              Try sample
            </button>
            {charCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={clearInput}
                  className="text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
                >
                  Clear
                </button>
                <span className="text-neutral-400">·  {charCount.toLocaleString()} chars</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-neutral-400 sm:inline">⌘+↵</span>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={state.kind === "loading"}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state.kind === "loading" ? (
                <span>Analyzing<span className="dot-loader" /></span>
              ) : (
                "Analyze"
              )}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8">
        {state.kind === "idle" && (
          <p className="text-sm text-neutral-400">Results will appear here.</p>
        )}

        {state.kind === "loading" && <ResultsSkeleton />}

        {state.kind === "error" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <strong className="font-semibold">Something went wrong. </strong>
            {state.message}
          </div>
        )}

        {state.kind === "ok" && (
          <Results
            analysis={state.analysis}
            profile={state.profile}
            mode={state.mode}
            notice={state.notice}
          />
        )}
      </section>

      <footer className="mt-16 text-center text-xs text-neutral-400">
        Hybrid analysis: deterministic profile → Claude shapes it into judgment-grade prose. See README for details.
      </footer>
    </main>
  );
}

function Results({
  analysis,
  profile,
  mode,
  notice,
}: {
  analysis: Analysis;
  profile: Profile;
  mode: AnalyzeMode;
  notice?: string;
}) {
  return (
    <div className="space-y-6">
      <div
        className={`rounded-xl border px-5 py-4 ${
          mode === "hybrid"
            ? "border-emerald-200 bg-emerald-50/60"
            : "border-amber-200 bg-amber-50/60"
        }`}
      >
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              mode === "hybrid" ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            {mode === "hybrid" ? "Hybrid" : "Stats-only"}
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Summary</span>
        </div>
        <p className="text-[15px] leading-snug text-neutral-900">{analysis.summary}</p>
        {notice && mode === "stats-only" && (
          <p className="mt-2 text-xs text-amber-900/80">{notice}</p>
        )}
      </div>

      <Section label="Insights" tone="neutral">
        <ol className="divide-y divide-neutral-100">
          {analysis.insights.map((it, i) => (
            <li key={i} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium text-white">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-neutral-900">{it.title}</p>
                  <Chip kind="confidence" level={it.confidence} />
                </div>
                <p className="mt-1 text-sm text-neutral-600">{it.evidence}</p>
                <p className="mt-1.5 text-sm italic text-neutral-500">{it.impact}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section label="Risks" tone="warn">
        <ul className="divide-y divide-amber-100">
          {analysis.risks.map((it, i) => (
            <li key={i} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 shrink-0 text-amber-600">⚠</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-neutral-900">{it.title}</p>
                  <div className="flex items-center gap-1.5">
                    <Chip kind="severity" level={it.severity} />
                    <Chip kind="confidence" level={it.confidence} />
                  </div>
                </div>
                <p className="mt-1 text-sm text-neutral-600">{it.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section label="Recommended action" tone="accent">
        <div className="flex gap-3">
          <span className="mt-0.5 shrink-0 text-emerald-600">→</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium text-neutral-900">{analysis.recommendation.action}</p>
              <Chip kind="priority" level={analysis.recommendation.priority} />
            </div>
            <p className="mt-1 text-sm text-neutral-600">{analysis.recommendation.reasoning}</p>
          </div>
        </div>
      </Section>

      <details className="group rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm">
        <summary className="flex cursor-pointer select-none items-center justify-between text-neutral-600 hover:text-neutral-900">
          <span>Show extracted stats (the deterministic floor)</span>
          <span className="text-neutral-400 transition group-open:rotate-180">⌄</span>
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-700">
          {JSON.stringify(profile, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Section({
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

function Chip({ kind, level }: { kind: "confidence" | "severity" | "priority"; level: Confidence }) {
  const palette: Record<typeof kind, Record<Confidence, string>> = {
    confidence: {
      High: "bg-emerald-50 text-emerald-700 border-emerald-200",
      Medium: "bg-sky-50 text-sky-700 border-sky-200",
      Low: "bg-neutral-100 text-neutral-600 border-neutral-200",
    },
    severity: {
      High: "bg-red-50 text-red-700 border-red-200",
      Medium: "bg-amber-50 text-amber-800 border-amber-200",
      Low: "bg-neutral-100 text-neutral-600 border-neutral-200",
    },
    priority: {
      High: "bg-red-50 text-red-700 border-red-200",
      Medium: "bg-amber-50 text-amber-800 border-amber-200",
      Low: "bg-neutral-100 text-neutral-600 border-neutral-200",
    },
  };
  const label = kind === "confidence" ? "Conf" : kind === "severity" ? "Sev" : "Pri";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${palette[kind][level]}`}
      title={`${kind}: ${level}`}
    >
      <span className="opacity-60">{label}</span>
      <span>{level}</span>
    </span>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 rounded-xl border border-neutral-200 bg-neutral-50" />
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-white px-5 py-4">
        <div className="h-3 w-20 rounded bg-neutral-200" />
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-6 w-6 shrink-0 rounded-full bg-neutral-200" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 rounded bg-neutral-200" />
                <div className="h-3 w-1/2 rounded bg-neutral-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 px-5 py-4">
        <div className="h-3 w-16 rounded bg-amber-200/60" />
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-4 w-4 shrink-0 rounded bg-amber-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-2/3 rounded bg-amber-200/60" />
              <div className="h-3 w-1/2 rounded bg-amber-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 px-5 py-4">
        <div className="h-3 w-24 rounded bg-emerald-200/60" />
        <div className="flex gap-3">
          <div className="h-4 w-4 shrink-0 rounded bg-emerald-200" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 rounded bg-emerald-200/60" />
            <div className="h-3 w-1/2 rounded bg-emerald-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
