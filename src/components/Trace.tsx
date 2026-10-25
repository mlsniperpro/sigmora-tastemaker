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
    <li className="relative pl-7">
      <span
        className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-meta font-bold ${
          s.status === "done" ? "bg-accent text-accent-ink" : "bg-miss text-bg"
        }`}
        aria-hidden
      >
        {index + 1}
      </span>
      <button type="button" className="w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-body font-medium text-ink">{s.title}</span>
          <span className="shrink-0 font-mono text-meta text-muted">{s.ms} ms</span>
        </div>
        <p className="mt-0.5 text-meta leading-snug text-muted">{s.status === "error" ? `Skipped: ${s.detail}` : s.detail}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {surfaces.map((e) => (
            <span key={e} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-meta text-violet">
              {e}
            </span>
          ))}
          {s.model && <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-meta text-accent">LLM · {s.model}</span>}
          {s.calls.length > 0 && (
            <span className="px-1 py-0.5 text-meta text-muted">
              {s.calls.length} call{s.calls.length > 1 ? "s" : ""} · {open ? "hide" : "show"} parameters
            </span>
          )}
        </div>
      </button>
      {open && s.calls.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {s.calls.map((c, i) => (
            <li key={i} className="rounded border border-line bg-bg/50 p-1.5 font-mono text-meta leading-relaxed text-muted">
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

/** "25 Oct, 08:22 UTC": when a served run originally finished. */
function finishedAt(iso: string): string {
  const d = new Date(iso);
  const hhmm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return `${hhmm} UTC on ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

export function Trace({
  steps,
  running,
  pending,
  served,
  onRerun,
  rerunLive = true,
  collapsed,
  setCollapsed,
  names = new Map<string, string>(),
}: {
  steps: TraceStep[];
  running: boolean;
  /** Title of the step in progress. */
  pending: readonly string[];
  /** When the run is an earlier one: where it came from and when it originally ran. */
  served?: Served & { at: string };
  /** Offered on a recorded run: run the preset again now. */
  onRerun?: () => void;
  /** The re-run calls live Qloo (false when this deployment can only simulate, so it isn't called "live"). */
  rerunLive?: boolean;
  /** Steps hidden (the owner keeps this, so the toggle bar's jump link can open the trace). */
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  names?: ReadonlyMap<string, string>;
}) {
  const calls = steps.reduce((n, s) => n + s.calls.length, 0);
  const surfaces = new Set(steps.flatMap((s) => s.calls.map((c) => surfaceOf(c.key))));
  return (
    <section id="agent-trace" tabIndex={-1} aria-label="Agent trace" className="scroll-mt-16 rounded-2xl border border-line bg-panel p-4 outline-none">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 className="text-sm font-semibold tracking-wide text-ink">Agent trace</h2>
        <span className="font-mono text-meta text-muted">
          {calls} Qloo calls · {surfaces.size} Qloo surfaces
        </span>
        <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} className="text-meta text-violet hover:underline">
          {collapsed ? "Show steps" : "Hide steps"}
        </button>
      </header>
      {served && (
        <div role="status" className="mb-3 space-y-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-meta leading-snug text-muted">
          {onRerun && (
            <button type="button" onClick={onRerun} className="rounded-full bg-accent px-3 py-1 text-meta font-semibold text-accent-ink">
              {rerunLive ? "Re-run live" : "Re-run"}
            </button>
          )}
          <p>
            <strong className="font-semibold text-ink">Instant:</strong> this exact run finished at {finishedAt(served.at)}
            {served.from === "recording" ? ", a recorded live run of this preset" : ""}
            {served.reason ? `, shown because ${served.reason}` : ""}. Its own timings and sources are shown.
          </p>
        </div>
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
              <li key={`${String(i)}-${title}`} className="relative pl-7 text-meta text-muted">
                <span className="absolute left-0 top-0 h-5 w-5 animate-pulse rounded-full bg-accent/40" aria-hidden />
                {title}…
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
