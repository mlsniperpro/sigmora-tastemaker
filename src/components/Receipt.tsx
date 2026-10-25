"use client";

import { useState } from "react";
import type { Receipt, Verdict } from "@/lib/agent/types";

export const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; dot: string }> = {
  pass: { label: "Qloo-verified", cls: "text-pass border-pass/40 bg-pass/10", dot: "bg-pass" },
  miss: { label: "Low affinity", cls: "text-miss border-miss/40 bg-miss/10", dot: "bg-miss" },
  hallucination: { label: "Not found in Qloo", cls: "text-invented border-invented/40 bg-invented/10", dot: "bg-invented" },
  fading: { label: "Fading", cls: "text-fade border-fade/40 bg-fade/10", dot: "bg-fade" },
  unscored: { label: "No Qloo score", cls: "text-muted border-line bg-panel-2", dot: "bg-muted" },
};

/** Labels for verdicts the offline simulator produced: they say what the check did without claiming Qloo said it. */
export const SIMULATED_LABEL: Record<Verdict, string> = {
  pass: "Simulated pass",
  miss: "Simulated miss",
  hallucination: "Simulated: not in catalog",
  fading: "Simulated: fading",
  unscored: "Simulated: no score",
};

/** What a simulated verdict means, in words only: the simulator's numbers are placeholders, so none are printed. */
const SIMULATED_NOTE: Record<Verdict, string> = {
  pass: "Cleared the pass bar for this role in the offline simulator. With a Qloo key, this is checked against Qloo.",
  miss: "Scored below the pass bar for this role in the offline simulator. With a Qloo key, Qloo's affinity decides this.",
  hallucination: "The offline simulator's catalog has no entity by this name. With a Qloo key, this is a search of Qloo's catalog.",
  fading: "Fit the audience in the offline simulator, but its simulated trend is falling.",
  unscored: "The offline simulator gave no score for this pick.",
};

const SOURCE_LABEL = { live: "live Qloo", replay: "replayed Qloo response", simulated: "simulated (not Qloo data)" } as const;

/**
 * Whether a receipt's verdict came from the offline simulator. A receipt with no
 * source of its own (e.g. the city pick) takes the run's: `runSimulated`.
 */
export const isSimulated = (r: Pick<Receipt, "source">, runSimulated = false) => r.source === "simulated" || (r.source === undefined && runSimulated);

/** The chip label for a verdict, honest about simulated data. */
export const verdictLabel = (verdict: Verdict, simulated: boolean) => (simulated ? SIMULATED_LABEL[verdict] : VERDICT_STYLE[verdict].label);

/** The one-line note for a pick; a simulated one gets words with no placeholder numbers. */
export const receiptNote = (r: Pick<Receipt, "verdict" | "note">, simulated: boolean) => (simulated ? SIMULATED_NOTE[r.verdict] : r.note);

function TrendMark({ trend, simulated }: { trend?: number; simulated: boolean }) {
  if (trend === undefined) return null;
  const up = trend > 0.1;
  const down = trend < -0.1;
  return (
    <span className={up ? "text-pass" : down ? "text-fade" : "text-muted"} title={simulated ? "Simulated trend" : `/v2/trending velocity ${trend.toFixed(2)}`}>
      {up ? "↗ rising" : down ? "↘ cooling" : "→ steady"}
    </span>
  );
}

export function ReceiptChip({ r, runSimulated = false }: { r: Receipt; runSimulated?: boolean }) {
  const [open, setOpen] = useState(false);
  const sim = isSimulated(r, runSimulated);
  const v = VERDICT_STYLE[r.verdict];
  const strongest = [...r.drivers].sort((a, b) => b.score - a.score)[0];
  const top = strongest && strongest.score > 0 ? strongest : undefined;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border px-2.5 py-0.5 text-left text-meta leading-5 ${v.cls}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.dot}`} aria-hidden />
        <span className="font-medium">{verdictLabel(r.verdict, sim)}</span>
        {!sim && r.affinity !== undefined && <span className="font-mono">affinity {r.affinity.toFixed(2)}</span>}
        {top && r.verdict !== "hallucination" && <span className="text-ink/70">{sim ? `driven by ${top.name}` : `driven by ${top.name} (${top.score.toFixed(2)})`}</span>}
        <TrendMark trend={r.trend} simulated={sim} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-bg/60 p-2.5 text-meta text-muted">
          <p className="text-ink/90">{receiptNote(r, sim)}</p>
          {r.replaced && (
            <p>
              Replaced <span className="text-miss line-through">{r.replaced.name}</span> ({verdictLabel(r.replaced.verdict, sim).toLowerCase()}
              {!sim && r.replaced.affinity !== undefined ? `, ${r.replaced.affinity.toFixed(2)}` : ""}).
            </p>
          )}
          {r.drivers.length > 0 && (
            <p>
              Explainability: {sim ? r.drivers.map((d) => d.name).join(" · ") : r.drivers.map((d) => `${d.name} ${Math.round(d.score * 100)}%`).join(" · ")}
            </p>
          )}
          {!sim && r.threshold !== undefined && <p>Pass bar for this role: {r.threshold.toFixed(2)}</p>}
          <p>Source: {sim ? SOURCE_LABEL.simulated : r.source ? SOURCE_LABEL[r.source] : "this run's Qloo calls"}</p>
          {r.calls.map((c) => (
            <code key={c} className="block break-all font-mono text-caption text-violet">
              GET {c}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}
