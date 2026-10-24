"use client";

import type { RunResult } from "@/lib/agent/types";

function Metric({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "plain" }) {
  return (
    <div className="min-w-0">
      <div className={`font-mono text-2xl font-semibold ${tone === "good" ? "text-pass" : tone === "bad" ? "text-miss" : "text-ink"}`}>{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Scoreboard({ result }: { result: RunResult }) {
  const g = result.metrics.grounded;
  const b = result.metrics.baseline;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-panel p-4 sm:grid-cols-4">
      <Metric label="Culture Miss Rate, same model without Qloo (this run)" value={pct(b.cultureMissRate)} tone="bad" />
      <Metric label="Culture Miss Rate, with the Qloo critic" value={pct(g.cultureMissRate)} tone="good" />
      <Metric label="Invented entities caught" value={String(b.hallucinations)} tone="plain" />
      <Metric label="Picks replaced by the critic" value={String(result.grounded.receipts.filter((r) => r.replaced).length)} tone="plain" />
    </div>
  );
}
