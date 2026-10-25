"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PRESETS } from "@/lib/agent/presets";
import type { RunResult, Served } from "@/lib/agent/types";
import { entityNames, placeholderReason } from "@/lib/agent/evidence";
import { measureFromUrl, requestFromUrl, runIdFromUrl } from "@/lib/permalink";
import { BriefForm } from "./BriefForm";
import { Intro } from "./Intro";
import { CampaignPack } from "./CampaignPack";
import { DiffCard } from "./DiffCard";
import { ShipBar } from "./ShipBar";
import { SourceBanner } from "./SourceBanner";
import { TasteMap } from "./TasteMap";
import { Trace } from "./Trace";
import { useRun } from "./useRun";

/**
 * The ROI line, from this run's own measurements only. A run served from the
 * cache or a recording says its time was measured when it first ran. A
 * placeholder run (simulated Qloo or a scripted model) is labelled and counts no misses.
 */
export function RoiLine({ result, served }: { result: RunResult; served?: Served }) {
  const seconds = Math.max(1, Math.round(result.durationMs / 1000));
  const checked = result.grounded.receipts.length + result.baseline.receipts.length;
  const blank = placeholderReason(result);
  const simulated = result.qloo.simulated > 0;
  const caught = blank || result.baseline.unavailable ? 0 : result.baseline.receipts.filter((r) => r.verdict !== "pass" && r.verdict !== "unscored").length;
  const when = served ? (served.from === "recording" ? " (recorded run)" : " (when it first ran)") : "";
  return (
    <p className="mt-1 text-meta text-ink/80">
      <strong className="text-accent">
        This plan took {seconds} s{when}
      </strong>{" "}
      and {result.qloo.calls} {simulated ? "simulated Qloo calls" : "Qloo calls"}, with {checked} cultural picks checked
      {caught > 0 ? `; ${caught} of the plain model's picks would have shipped wrong` : ""}.
      {blank && <span className="ml-1.5 whitespace-nowrap rounded bg-fade/15 px-1.5 py-0.5 text-caption font-medium text-fade">{simulated ? "simulated" : "scripted model"}: no miss count</span>}
    </p>
  );
}

/** The With / Without Qloo switch. It stays pinned to the top of the screen so its effect is always in view. */
function PlanToggle({ mode, setMode, result }: { mode: "qloo" | "without"; setMode: (m: "qloo" | "without") => void; result?: RunResult }) {
  const flagged = result && !result.baseline.unavailable ? result.baseline.receipts.filter((r) => r.verdict === "miss" || r.verdict === "hallucination").length : 0;
  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-bg/80 sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-meta leading-snug text-muted" aria-live="polite">
          {mode === "qloo" ? (
            <>
              <span className="font-semibold text-accent">With Qloo:</span> <span className="hidden sm:inline">the plan after the Qloo critic; </span>every pick has a receipt
            </>
          ) : (
            <>
              <span className="font-semibold text-miss">Without Qloo:</span> same model, no Qloo{flagged > 0 ? <span className="hidden sm:inline">; struck picks failed the check</span> : null}
            </>
          )}
        </p>
        <div role="group" aria-label="Plan view" className="flex shrink-0 rounded-full border border-line bg-panel p-1 text-meta">
          <button
            type="button"
            aria-pressed={mode === "qloo"}
            onClick={() => setMode("qloo")}
            className={`rounded-full px-3 py-1.5 ${mode === "qloo" ? "bg-accent font-semibold text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            With Qloo
          </button>
          <button
            type="button"
            aria-pressed={mode === "without"}
            onClick={() => setMode("without")}
            className={`rounded-full px-3 py-1.5 ${mode === "without" ? "bg-miss font-semibold text-bg" : "text-muted hover:text-ink"}`}
          >
            Without Qloo
          </button>
        </div>
      </div>
    </div>
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
  // The brief form folds into a one-line summary once there is a run to look at.
  const [editing, setEditing] = useState(false);
  // A shared `?b=` brief is someone else's text: it is shown, and runs (spending the demo's budget) only on a click.
  const [shared, setShared] = useState(!initial.measure && !initial.runId && "brief" in initial.request ? initial.request : undefined);

  // All deps are stable (a useState value and useCallbacks), so this starts once per mount.
  useEffect(() => {
    if (initial.measure) void requery(initial.measure);
    else if (initial.runId) void open(initial.runId);
    else if (!("brief" in initial.request)) void run(initial.request);
  }, [initial, run, open, requery]);

  const side = result ? (mode === "qloo" ? result.grounded : result.baseline) : undefined;
  const showForm = editing || (!result && !running);
  const runSimulated = !!result && result.qloo.simulated > 0;

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-4 px-4 pb-5 pt-5 sm:px-6">
      <header>
        <Intro>{result && <RoiLine result={result} served={served} />}</Intro>
      </header>

      <PlanToggle mode={mode} setMode={setMode} result={result} />

      <section aria-label="Brief" className="space-y-2 rounded-2xl border border-line bg-panel p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption uppercase tracking-wider text-muted">Try a preset</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={activePreset === p.id}
              // Switching mid-run is allowed: the request in flight is cancelled.
              onClick={() => {
                setActivePreset(p.id);
                setEditing(false);
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
        {(result || running) && (
          <div className="flex items-center gap-2">
            <p
              className={`min-w-0 flex-1 text-body-sm text-ink/85 ${showForm ? "" : "truncate"}`}
              title={result ? `${result.brief.subject} — ${result.brief.product}. ${result.brief.goal}` : undefined}
            >
              {result ? (
                <>
                  <span className="text-muted">Brief:</span> {result.brief.subject} — {result.brief.product}. {result.brief.goal}{" "}
                  <span className="text-muted">Audience loves {result.brief.seeds.join(", ")}.</span>
                </>
              ) : (
                <span className="text-muted">Planning and taste-checking…</span>
              )}
            </p>
            <button
              type="button"
              aria-expanded={showForm}
              aria-controls="brief-form"
              onClick={() => setEditing((e) => !e)}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-meta text-ink hover:border-accent/60"
            >
              {showForm ? "Close" : "Edit brief"}
            </button>
          </div>
        )}
        {/* Hidden rather than unmounted, so a half-written brief survives folding it away. */}
        <div id="brief-form" hidden={!showForm}>
          <BriefForm
            busy={running}
            onRun={(b) => {
              setActivePreset(undefined);
              setEditing(false);
              void run({ brief: b });
            }}
          />
        </div>
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
      {result && <DiffCard result={result} mode={mode} />}
      {result && <SourceBanner result={result} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="order-3 min-w-0 lg:sticky lg:top-16 lg:order-1 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
          <Trace
            steps={steps}
            running={running}
            pending={pending}
            served={served && result ? { ...served, at: result.createdAt } : undefined}
            // A preset served from the cache or a recording can be run live now ("fresh" skips both).
            onRerun={activePreset && served ? () => void run({ preset: activePreset, fresh: true }) : undefined}
            names={result ? entityNames(result) : undefined}
          />
        </div>
        <div className="order-2 min-w-0">{result ? <TasteMap result={result} /> : <Placeholder running={running} label="Taste Map" />}</div>
        <div className="order-1 min-w-0 scroll-mt-16 lg:order-3">
          {side ? <CampaignPack side={side} mode={mode} runSimulated={runSimulated} /> : <Placeholder running={running} label="Campaign pack" />}
        </div>
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
