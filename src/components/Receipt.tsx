"use client";

import { useState } from "react";
import type { Receipt, Verdict } from "@/lib/agent/types";

export const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; dot: string }> = {
  pass: { label: "Qloo-verified", cls: "text-pass border-pass/40 bg-pass/10", dot: "bg-pass" },
  miss: { label: "Low affinity", cls: "text-miss border-miss/40 bg-miss/10", dot: "bg-miss" },
  hallucination: { label: "Not a real entity", cls: "text-invented border-invented/40 bg-invented/10", dot: "bg-invented" },
  fading: { label: "Fading", cls: "text-fade border-fade/40 bg-fade/10", dot: "bg-fade" },
};

const SOURCE_LABEL = { live: "live Qloo", replay: "replayed Qloo response", simulated: "simulated (not Qloo data)" } as const;

function TrendMark({ trend }: { trend?: number }) {
  if (trend === undefined) return null;
  const up = trend > 0.1;
  const down = trend < -0.1;
  return (
    <span className={up ? "text-pass" : down ? "text-fade" : "text-muted"} title={`/v2/trending velocity ${trend.toFixed(2)}`}>
      {up ? "↗ rising" : down ? "↘ cooling" : "→ steady"}
    </span>
  );
}

export function ReceiptChip({ r }: { r: Receipt }) {
  const [open, setOpen] = useState(false);
  const v = VERDICT_STYLE[r.verdict];
  const top = r.drivers[0] && r.drivers[0].score > 0 ? r.drivers[0] : undefined;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border px-2.5 py-0.5 text-left text-caption leading-5 ${v.cls}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.dot}`} aria-hidden />
        <span className="font-medium">{v.label}</span>
        {r.affinity !== undefined && <span className="font-mono">affinity {r.affinity.toFixed(2)}</span>}
        {top && r.verdict !== "hallucination" && (
          <span className="text-ink/70">
            via {top.name} {Math.round(top.score * 100)}%
          </span>
        )}
        <TrendMark trend={r.trend} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-bg/60 p-2.5 text-caption text-muted">
          <p className="text-ink/90">{r.note}</p>
          {r.replaced && (
            <p>
              Replaced <span className="text-miss line-through">{r.replaced.name}</span> ({VERDICT_STYLE[r.replaced.verdict].label.toLowerCase()}
              {r.replaced.affinity !== undefined ? `, ${r.replaced.affinity.toFixed(2)}` : ""}).
            </p>
          )}
          {r.drivers.length > 0 && (
            <p>
              Explainability:{" "}
              {r.drivers.map((d) => `${d.name} ${Math.round(d.score * 100)}%`).join(" · ")}
            </p>
          )}
          {r.threshold !== undefined && <p>Pass bar for this role: {r.threshold.toFixed(2)}</p>}
          {r.source && <p>Source: {SOURCE_LABEL[r.source]}</p>}
          {r.calls.map((c) => (
            <code key={c} className="block break-all font-mono text-label text-violet">
              GET {c}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}
