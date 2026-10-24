"use client";

import { useState } from "react";
import type { TraceStep } from "@/lib/agent/types";

function endpointOf(key: string) {
  const [path, qs = ""] = key.split("?");
  const p = new URLSearchParams(qs);
  const type = p.get("filter.type");
  return type ? `${path} · ${type}` : path;
}

const KEY_PARAMS = [
  "filter.type",
  "query",
  "signal.demographics.age",
  "signal.demographics.gender",
  "filter.results.entities",
  "feature.explainability",
  "filter.location.query",
  "output.heatmap.boundary",
  "external.spotify.ids",
];

function Step({ s, index }: { s: TraceStep; index: number }) {
  const [open, setOpen] = useState(false);
  const endpoints = [...new Set(s.calls.map((c) => endpointOf(c.key)))];
  return (
    <li className="relative pl-6">
      <span
        className={`absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-micro font-bold ${
          s.status === "done" ? "bg-accent text-accent-ink" : "bg-miss text-bg"
        }`}
        aria-hidden
      >
        {index + 1}
      </span>
      <button type="button" className="w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-body font-medium text-ink">{s.title}</span>
          <span className="shrink-0 font-mono text-label text-muted">{s.ms} ms</span>
        </div>
        <p className="mt-0.5 text-meta leading-snug text-muted">{s.status === "error" ? `Skipped: ${s.detail}` : s.detail}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {endpoints.map((e) => (
            <span key={e} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-label text-violet">
              {e}
            </span>
          ))}
          {s.model && <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-label text-accent">LLM · {s.model}</span>}
          {s.calls.length > 0 && <span className="px-1 py-0.5 text-label text-muted">{s.calls.length} call{s.calls.length > 1 ? "s" : ""}</span>}
        </div>
      </button>
      {open && s.calls.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {s.calls.map((c, i) => {
            const qs = new URLSearchParams(c.key.split("?")[1] ?? "");
            const shown = KEY_PARAMS.filter((k) => qs.has(k)).map((k) => `${k}=${qs.get(k)}`);
            return (
              <li key={i} className="rounded border border-line bg-bg/50 p-1.5 font-mono text-label leading-relaxed text-muted">
                <span className="text-ink">GET {c.path}</span> · {c.source}
                {c.cached ? " · cached" : ""} · {c.latencyMs} ms
                {c.fallbackReason ? <span className="text-fade"> · fallback: {c.fallbackReason}</span> : null}
                {shown.length > 0 && <div className="break-all">{shown.join(" ")}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function Trace({ steps, running }: { steps: TraceStep[]; running: boolean }) {
  const calls = steps.reduce((n, s) => n + s.calls.length, 0);
  const surfaces = new Set(steps.flatMap((s) => s.calls.map((c) => endpointOf(c.key))));
  return (
    <section aria-label="Agent trace" className="rounded-2xl border border-line bg-panel p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-ink">Agent trace</h2>
        <span className="font-mono text-label text-muted">
          {calls} Qloo calls · {surfaces.size} surfaces
        </span>
      </header>
      <ol className="space-y-3 border-l border-line/0">
        {steps.map((s, i) => (
          <Step key={s.id} s={s} index={i} />
        ))}
        {running && (
          <li className="relative pl-6 text-meta text-muted">
            <span className="absolute left-0 top-1 h-4 w-4 animate-pulse rounded-full bg-accent/40" aria-hidden />
            Working…
          </li>
        )}
      </ol>
    </section>
  );
}
