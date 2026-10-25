"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PRESETS } from "@/lib/agent/presets";
import type { RunResult, Served } from "@/lib/agent/types";
import { entityNames } from "@/lib/agent/evidence";
import { measureFromUrl, requestFromUrl, runIdFromUrl } from "@/lib/permalink";
import { BriefForm } from "./BriefForm";
import { Intro } from "./Intro";
import { CampaignPack } from "./CampaignPack";
import { Scoreboard } from "./Scoreboard";
import { ShipBar } from "./ShipBar";
import { SourceBanner } from "./SourceBanner";
import { TasteMap } from "./TasteMap";
import { Trace } from "./Trace";
import { useRun } from "./useRun";

/**
 * The ROI line, from this run's own measurements only. A run served from the
 * cache or a recording says its time was measured when it first ran.
 */
export function RoiLine({ result, served }: { result: RunResult; served?: Served }) {
  const seconds = Math.max(1, Math.round(result.durationMs / 1000));
  const checked = result.grounded.receipts.length + result.baseline.receipts.length;
  const caught = result.baseline.unavailable ? 0 : result.baseline.receipts.filter((r) => r.verdict !== "pass" && r.verdict !== "unscored").length;
  const when = served ? (served.from === "recording" ? " (recorded run)" : " (when it first ran)") : "";
  return (
    <p className="mt-1 text-meta text-ink/80">
      <strong className="text-accent">
        This plan took {seconds} s{when}
      </strong>{" "}
      and {result.qloo.calls} Qloo calls, with {checked} cultural picks checked
      {caught > 0 ? `; ${caught} of the plain model's picks would have shipped wrong` : ""}.
    </p>
  );
}

export function App() {
  const params = useSearchParams();
  const { steps, pending, served, result, error, running, run, open, requery } = useRun();
  const [mode, setMode] = useState<"qloo" | "without">("qloo");
  // The URL decides what runs on first load; read it once, at mount.
  const [initial] = useState(() => ({ measure: measureFromUrl(params), runId: runIdFromUrl(params), request: requestFromUrl(params) }));
  const [activePreset, setActivePreset] = useState(!initial.measure && !initial.runId && "preset" in initial.request ? initial.request.preset : undefined);
  const [copied, setCopied] = useState(false);
  // A shared `?b=` brief is someone else's text: it is shown, and runs (spending the demo's budget) only on a click.
  const [shared, setShared] = useState(!initial.measure && !initial.runId && "brief" in initial.request ? initial.request : undefined);

  // All deps are stable (a useState value and useCallbacks), so this starts once per mount.
  useEffect(() => {
    if (initial.measure) void requery(initial.measure);
    else if (initial.runId) void open(initial.runId);
    else if (!("brief" in initial.request)) void run(initial.request);
  }, [initial, run, open, requery]);

  const side = result ? (mode === "qloo" ? result.grounded : result.baseline) : undefined;

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <Intro>{result && <RoiLine result={result} served={served} />}</Intro>
        <div role="group" aria-label="Plan view" className="flex rounded-full border border-line bg-panel p-1 text-meta">
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
          <span className="text-caption uppercase tracking-wider text-muted">Try a preset</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              // Switching mid-run is allowed: the request in flight is cancelled.
              onClick={() => {
                setActivePreset(p.id);
                void run({ preset: p.id });
              }}
              title={p.blurb}
              className={`rounded-full border px-3 py-1.5 text-meta disabled:opacity-60 ${activePreset === p.id ? "border-accent bg-accent/15 text-accent" : "border-line text-ink hover:border-accent/60"}`}
            >
              {p.title}
            </button>
          ))}
          {result && (
            <button
              type="button"
              onClick={() => {
                // Absent outside secure contexts, whatever lib.dom says.
                const clipboard = navigator.clipboard as Clipboard | undefined;
                void clipboard?.writeText(window.location.href).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="ml-auto rounded-full px-3 py-1.5 text-meta text-violet hover:underline"
            >
              {copied ? "Link copied" : "Copy permalink"}
            </button>
          )}
        </div>
        {result && (
          <p className="text-body-sm text-ink/85">
            <span className="text-muted">Brief:</span> {result.brief.subject} — {result.brief.product}. {result.brief.goal}{" "}
            <span className="text-muted">Audience loves {result.brief.seeds.join(", ")}.</span>
          </p>
        )}
        <BriefForm
          busy={running}
          onRun={(b) => {
            setActivePreset(undefined);
            void run({ brief: b });
          }}
        />
      </section>

      {shared && (
        <div role="region" aria-label="Shared brief" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-body text-ink">
          <span className="min-w-0">
            Shared brief: <strong>{shared.brief.subject}</strong> for fans of {shared.brief.seeds.join(", ") || shared.brief.seedLinks?.join(", ")}.
          </span>
          <button
            type="button"
            onClick={() => {
              setShared(undefined);
              void run(shared);
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-body font-semibold text-accent-ink"
          >
            Plan &amp; taste-check it
          </button>
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-miss/50 bg-miss/10 px-3 py-2 text-body text-miss">{error}</div>}
      {result && <SourceBanner result={result} />}
      {result && <Scoreboard result={result} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="order-3 min-w-0 lg:sticky lg:top-4 lg:order-1 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <Trace
            steps={steps}
            running={running}
            pending={pending}
            served={served && result ? { ...served, at: result.createdAt } : undefined}
            onRerun={activePreset && served?.from === "recording" ? () => void run({ preset: activePreset, fresh: true }) : undefined}
            names={result ? entityNames(result) : undefined}
          />
        </div>
        <div className="order-2 min-w-0">{result ? <TasteMap result={result} /> : <Placeholder running={running} label="Taste Map" />}</div>
        <div className="order-1 min-w-0 lg:order-3">{side ? <CampaignPack side={side} mode={mode} /> : <Placeholder running={running} label="Campaign pack" />}</div>
      </div>

      {result && mode === "qloo" && (
        <ShipBar
          // A new run starts with no receipt from the previous one.
          key={result.id}
          result={result}
          onMeasure={(campaignId) => {
            setActivePreset(undefined);
            void requery(campaignId);
          }}
        />
      )}

      <footer className="grid gap-3 border-t border-line pt-4 text-caption leading-relaxed text-muted sm:grid-cols-2">
        <p>
          <strong className="text-ink">Responsible taste.</strong> Inputs are public catalog entities, tags and demographic buckets — never a
          person&apos;s data. Results are audience-level affinity, never &ldquo;this user likes X&rdquo;. Every receipt names the Qloo calls behind
          its number, every Taste Map panel names its endpoint, the trace shows every call&apos;s parameters, and replayed or simulated results are labeled.
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
    <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-line text-meta text-muted">
      {running ? `${label} builds as the agent runs…` : label}
    </div>
  );
}
