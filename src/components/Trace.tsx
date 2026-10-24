"use client";

import { useState } from "react";
import { surfaceOf } from "@/lib/agent/surfaces";
import type { Served, TraceStep } from "@/lib/agent/types";

/** Every parameter of a call, with entity ids shown alongside their names where the run knows them. */
function params(key: string, names: ReadonlyMap<string, string>): string[] {
  const qs = new URLSearchParams(key.split("?")[1] ?? "");
  return [...qs.entries()].map(([k, v]) => {
    const named = v
      .split(",")
      .map((id) => (names.has(id) ? `${id} (${names.get(id) ?? ""})` : id))
      .join(",");
    return `${k}=${named}`;
  });
}

function Step({ s, index, names }: { s: TraceStep; index: number; names: ReadonlyMap<string, string> }) {
  const [open, setOpen] = useState(false);
  const surfaces = [...new Set(s.calls.map((c) => surfaceOf(c.key)))];
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
          {surfaces.map((e) => (
            <span key={e} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-label text-violet">
              {e}
            </span>
          ))}
          {s.model && <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-label text-accent">LLM · {s.model}</span>}
          {s.calls.length > 0 && (
            <span className="px-1 py-0.5 text-label text-muted">
              {s.calls.length} call{s.calls.length > 1 ? "s" : ""} · {open ? "hide" : "show"} parameters
            </span>
          )}
        </div>
      </button>
      {open && s.calls.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {s.calls.map((c, i) => (
            <li key={i} className="rounded border border-line bg-bg/50 p-1.5 font-mono text-label leading-relaxed text-muted">
              <span className="text-ink">GET {c.path}</span> · {c.source}
              {c.cached ? " · cached" : ""} · {c.latencyMs} ms
              {c.fallbackReason ? <span className="text-fade"> · fallback: {c.fallbackReason}</span> : null}
              <div className="break-all">{params(c.key, names).join(" & ")}</div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Trace({
  steps,
  running,
  pending,
  served,
  onRerun,
  names = new Map<string, string>(),
}: {
  steps: TraceStep[];
  running: boolean;
  /** Title of the step in progress. */
  pending: readonly string[];
  /** When the run is an earlier one: where it came from and when it originally ran. */
  served?: Served & { at: string };
  /** Offered on a recorded run: run the preset live now. */
  onRerun?: () => void;
  names?: ReadonlyMap<string, string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const calls = steps.reduce((n, s) => n + s.calls.length, 0);
  const surfaces = new Set(steps.flatMap((s) => s.calls.map((c) => surfaceOf(c.key))));
  return (
    <section aria-label="Agent trace" className="rounded-2xl border border-line bg-panel p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 className="text-sm font-semibold tracking-wide text-ink">Agent trace</h2>
        <span className="font-mono text-label text-muted">
          {calls} Qloo calls · {surfaces.size} Qloo surfaces
        </span>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} className="text-label text-violet hover:underline">
          {collapsed ? "Show steps" : "Hide steps"}
        </button>
      </header>
      {served && (
        <p className="mb-2 rounded bg-panel-2 px-2 py-1 text-caption text-muted">
          Replay of a finished run from {new Date(served.at).toUTCString().slice(5, 22)} UTC,{" "}
          {served.from === "recording" ? "a recorded live run of this preset" : "served from cache"}
          {served.from === "recording" && served.reason ? ` because ${served.reason}` : ""}: timings and sources are from that run.
          {onRerun && (
            <>
              {" "}
              <button type="button" onClick={onRerun} className="text-violet underline">
                Re-run live
              </button>
            </>
          )}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {running ? `Working: ${pending.join(", ") || "starting"}` : steps.length ? `Finished ${steps.length} steps` : ""}
      </p>
      {!collapsed && (
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <Step key={s.id} s={s} index={i} names={names} />
          ))}
          {running &&
            (pending.length ? pending : ["Starting"]).map((title, i) => (
              <li key={`${String(i)}-${title}`} className="relative pl-6 text-meta text-muted">
                <span className="absolute left-0 top-1 h-4 w-4 animate-pulse rounded-full bg-accent/40" aria-hidden />
                {title}…
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
