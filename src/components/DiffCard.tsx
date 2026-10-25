"use client";

import { formatRate, placeholderReason } from "@/lib/agent/evidence";
import type { Receipt, RunResult, Verdict } from "@/lib/agent/types";
import { VERDICT_STYLE, isSimulated, receiptNote, verdictLabel } from "./Receipt";

/** Worst first: names Qloo can't find, then the lowest affinities, then picks that are fading. */
const SEVERITY: Partial<Record<Verdict, number>> = { hallucination: 0, miss: 1, fading: 2 };
/** Struck through, as in the pack: the critic rejects these. Fading is a warning, so it isn't struck. */
const STRUCK: ReadonlySet<Verdict> = new Set(["miss", "hallucination"]);

/** Up to `n` of the plain model's worst picks, from the run's own receipts. */
export function worstMisses(receipts: readonly Receipt[], n = 3): Receipt[] {
  return receipts
    .filter((r) => SEVERITY[r.verdict] !== undefined)
    .sort((a, b) => (SEVERITY[a.verdict] ?? 9) - (SEVERITY[b.verdict] ?? 9) || (a.affinity ?? 0) - (b.affinity ?? 0))
    .slice(0, n);
}

const TEXT: Record<Verdict, string> = { pass: "text-pass", miss: "text-miss", hallucination: "text-invented", fading: "text-fade", unscored: "text-muted" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Side({ title, tone, active, big, bigLabel, lines }: { title: string; tone: "bad" | "good"; active: boolean; big: string; bigLabel: string; lines: React.ReactNode[] }) {
  const ring = active ? (tone === "bad" ? "border-miss/70 bg-miss/5" : "border-accent/70 bg-accent/5") : "border-line bg-panel-2/40";
  return (
    <div aria-current={active ? "true" : undefined} className={`min-w-0 rounded-xl border p-3 transition-colors ${ring}`}>
      <h3 className={`text-meta font-semibold ${tone === "bad" ? "text-miss" : "text-accent"}`}>
        {title}
        {active && <span className="ml-1.5 hidden font-normal text-muted sm:inline">· shown below</span>}
      </h3>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className={`font-mono text-3xl font-semibold leading-none ${big === "—" ? "text-muted" : tone === "bad" ? "text-miss" : "text-pass"}`}>{big}</span>
        <span className="text-meta text-ink/85">{bigLabel}</span>
      </p>
      <ul className="mt-1.5 space-y-0.5 text-meta leading-snug text-muted">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The core idea on the first screen: the same model's plan with and without
 * Qloo, counted from this run's own receipts. Placeholder runs (simulated Qloo
 * or a scripted model) show no counts, and say why.
 */
export function DiffCard({ result, mode }: { result: RunResult; mode: "qloo" | "without" }) {
  const blank = placeholderReason(result);
  const runSimulated = result.qloo.simulated > 0;
  const noBaseline = result.baseline.unavailable;
  const base = result.baseline.receipts;
  const grounded = result.grounded.receipts;
  const b = result.metrics.baseline;
  const g = result.metrics.grounded;
  const show = (v: string) => (blank ? "—" : v);
  const showBase = (v: string) => (blank || noBaseline ? "—" : v);
  const hidden = `${runSimulated ? "Simulated run" : "Scripted model"}: counts hidden`;

  const flagged = b.hallucinations + b.misses + b.fading;
  const replaced = grounded.filter((r) => r.replaced).length;
  const passed = grounded.filter((r) => r.verdict === "pass").length;
  const worst = noBaseline ? [] : worstMisses(base);
  const replacementFor = (name: string) => grounded.find((r) => r.replaced?.name.toLowerCase() === name.toLowerCase())?.name;

  return (
    <section aria-label="With and without Qloo" className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
      <div className="grid gap-3 lg:items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:col-span-2">
          <Side
            title="Same model, no Qloo"
            tone="bad"
            active={mode === "without"}
            big={showBase(String(flagged))}
            bigLabel={noBaseline ? "no draft this run" : `of ${plural(b.picks, "pick")} flagged`}
            lines={
              blank || noBaseline
                ? [noBaseline ? "The plan without Qloo isn’t available on this run." : hidden]
                : [
                    `${b.hallucinations} invented · ${b.misses} low-affinity · ${b.fading} fading`,
                    <>
                      Culture Miss Rate <span className="font-mono text-miss">{formatRate(b.cultureMissRate)}</span>
                    </>,
                  ]
            }
          />
          <Side
            title="With the Qloo critic"
            tone="good"
            active={mode === "qloo"}
            big={show(String(replaced))}
            bigLabel="replaced"
            lines={
              blank
                ? [hidden]
                : [
                    `${passed} of ${plural(g.picks, "pick")} pass`,
                    <>
                      Miss Rate after the critic <span className="font-mono text-ink">{formatRate(g.cultureMissRate)}</span> (low by design)
                    </>,
                  ]
            }
          />
        </div>
        {worst.length > 0 && (
          <div className="min-w-0">
            <h3 className="text-meta font-semibold text-ink">What the plain model would have shipped</h3>
            <ul className="mt-1.5 space-y-2">
              {worst.map((r) => {
                const sim = isSimulated(r, runSimulated);
                const v = VERDICT_STYLE[r.verdict];
                const swap = replacementFor(r.name);
                return (
                  <li key={`${r.role}-${r.name}`} className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`rounded-full border px-2 py-0.5 text-meta font-medium ${v.cls} ${STRUCK.has(r.verdict) ? "line-through decoration-2" : ""}`}>{r.name}</span>
                      <span className={`text-caption font-medium ${TEXT[r.verdict]}`}>{verdictLabel(r.verdict, sim)}</span>
                      {swap && (
                        <span className="text-meta text-muted">
                          → <span className="text-pass">{swap}</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-meta leading-snug text-muted">{receiptNote(r, sim)}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <p className="mt-3 border-t border-line pt-2 text-meta leading-snug text-muted">
        {blank ?? (
          <>
            The pass bar comes from Qloo&apos;s own candidates for each role (the higher of 0.25 and 0.7 × their median affinity), and the critic replaces whatever falls below it, so the
            rate after the critic is near zero by construction. What it measures is how often the model alone misses; the blind judge in the benchmark asks
            whether the result is actually better.
          </>
        )}
        {!blank && noBaseline && <> The same-model plan without Qloo isn&apos;t available on this run ({noBaseline}), so there is nothing to compare against.</>}
      </p>
    </section>
  );
}
