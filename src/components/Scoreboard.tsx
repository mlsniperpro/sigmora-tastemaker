"use client";

import { placeholderReason } from "@/lib/agent/evidence";
import type { RunResult } from "@/lib/agent/types";

function Metric({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "plain" }) {
  return (
    <div className="min-w-0">
      <div className={`font-mono text-2xl font-semibold ${tone === "good" ? "text-pass" : tone === "bad" ? "text-miss" : "text-ink"}`}>{value}</div>
      <div className="text-caption leading-tight text-muted">{label}</div>
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Scoreboard({ result }: { result: RunResult }) {
  const g = result.metrics.grounded;
  const b = result.metrics.baseline;
  const blank = placeholderReason(result);
  // Placeholder runs keep the layout but show no numbers.
  const show = (v: string) => (blank ? "—" : v);
  return (
    <div aria-label="Scoreboard" className="rounded-2xl border border-line bg-panel p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Culture Miss Rate, same model without Qloo (this run)" value={show(pct(b.cultureMissRate))} tone={blank ? "plain" : "bad"} />
        <Metric label="Culture Miss Rate, with the Qloo critic" value={show(pct(g.cultureMissRate))} tone={blank ? "plain" : "good"} />
        <Metric label="Invented entities caught" value={show(String(b.hallucinations))} tone="plain" />
        <Metric label="Picks replaced by the critic" value={show(String(result.grounded.receipts.filter((r) => r.replaced).length))} tone="plain" />
      </div>
      {blank && <p className="mt-2 text-caption leading-snug text-muted">{blank}</p>}
    </div>
  );
}
