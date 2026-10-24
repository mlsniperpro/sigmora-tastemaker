"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PRESETS } from "@/lib/agent/presets";
import { decodeBrief } from "@/lib/permalink";
import { BriefForm } from "./BriefForm";
import { CampaignPack } from "./CampaignPack";
import { Scoreboard } from "./Scoreboard";
import { ShipBar } from "./ShipBar";
import { SourceBanner } from "./SourceBanner";
import { TasteMap } from "./TasteMap";
import { Trace } from "./Trace";
import { useRun } from "./useRun";

export function App() {
  const params = useSearchParams();
  const { steps, result, error, running, run } = useRun();
  const [mode, setMode] = useState<"qloo" | "without">("qloo");
  const [activePreset, setActivePreset] = useState<string>();
  const [showCustom, setShowCustom] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const preset = params.get("preset");
    const b = params.get("b");
    const brief = b ? decodeBrief(b) : undefined;
    const id = PRESETS.some((p) => p.id === preset) ? preset! : PRESETS[0].id;
    // The URL decides what runs on first load; the fetch it starts must follow mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActivePreset(brief ? undefined : id);
    void run(brief ? { brief } : { preset: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const side = result ? (mode === "qloo" ? result.grounded : result.baseline) : undefined;

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Tastemaker by Sigmora</p>
          <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">Don&apos;t guess the culture. Query it.</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-snug text-muted">
            A marketing agent that plans your launch and checks every cultural pick against Qloo before it ships. The model proposes, Qloo scores,
            weak picks get cut, and every survivor carries a receipt.
          </p>
        </div>
        <div role="group" aria-label="Plan view" className="flex rounded-full border border-line bg-panel p-1 text-[12px]">
          <button type="button" aria-pressed={mode === "qloo"} onClick={() => setMode("qloo")} className={`rounded-full px-3 py-1.5 ${mode === "qloo" ? "bg-accent font-semibold text-accent-ink" : "text-muted"}`}>
            With Qloo
          </button>
          <button type="button" aria-pressed={mode === "without"} onClick={() => setMode("without")} className={`rounded-full px-3 py-1.5 ${mode === "without" ? "bg-miss font-semibold text-bg" : "text-muted"}`}>
            Without Qloo
          </button>
        </div>
      </header>

      <section aria-label="Brief" className="space-y-3 rounded-2xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted">Try a preset</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={running}
              onClick={() => {
                setActivePreset(p.id);
                void run({ preset: p.id });
              }}
              title={p.blurb}
              className={`rounded-full border px-3 py-1.5 text-[12px] disabled:opacity-60 ${activePreset === p.id ? "border-accent bg-accent/15 text-accent" : "border-line text-ink hover:border-accent/60"}`}
            >
              {p.title}
            </button>
          ))}
          <button type="button" onClick={() => setShowCustom((s) => !s)} aria-expanded={showCustom} className="rounded-full border border-dashed border-line px-3 py-1.5 text-[12px] text-muted hover:text-ink">
            {showCustom ? "Hide custom brief" : "Your own brief"}
          </button>
          {result && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="ml-auto rounded-full px-3 py-1.5 text-[12px] text-violet hover:underline"
            >
              {copied ? "Link copied" : "Copy permalink"}
            </button>
          )}
        </div>
        {result && (
          <p className="text-[12.5px] text-ink/85">
            <span className="text-muted">Brief:</span> {result.brief.subject} — {result.brief.product}. {result.brief.goal}{" "}
            <span className="text-muted">Audience loves {result.brief.seeds.join(", ")}.</span>
          </p>
        )}
        {showCustom && <BriefForm busy={running} onRun={(b) => {
              setActivePreset(undefined);
              void run({ brief: b });
            }} />}
      </section>

      {error && <div role="alert" className="rounded-xl border border-miss/50 bg-miss/10 px-3 py-2 text-[13px] text-miss">{error}</div>}
      {result && <SourceBanner result={result} />}
      {result && <Scoreboard result={result} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="order-3 min-w-0 lg:sticky lg:top-4 lg:order-1 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <Trace steps={steps} running={running} />
        </div>
        <div className="order-2 min-w-0">{result ? <TasteMap result={result} /> : <Placeholder running={running} label="Taste Map" />}</div>
        <div className="order-1 min-w-0 lg:order-3">{side ? <CampaignPack side={side} mode={mode} /> : <Placeholder running={running} label="Campaign pack" />}</div>
      </div>

      {result && mode === "qloo" && <ShipBar result={result} />}

      <footer className="grid gap-3 border-t border-line pt-4 text-[11.5px] leading-relaxed text-muted sm:grid-cols-2">
        <p>
          <strong className="text-ink">Responsible taste.</strong> Inputs are public catalog entities, tags and demographic buckets — never a
          person&apos;s data. Results are audience-level affinity, never &ldquo;this user likes X&rdquo;. Every number links to the Qloo call that
          produced it, and replayed or simulated results are labeled.
        </p>
        <p>
          Built for the Qloo Agentic Hackathon. Open source (MIT) on{" "}
          <a className="text-violet hover:underline" href="https://github.com/mlsniperpro/sigmora-tastemaker">GitHub</a>. Qloo data via the hackathon
          API; Sigmora is the publishing engine behind &ldquo;Ship&rdquo;.
        </p>
      </footer>
    </main>
  );
}

function Placeholder({ running, label }: { running: boolean; label: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-line text-[12px] text-muted">
      {running ? `${label} builds as the agent runs…` : label}
    </div>
  );
}
