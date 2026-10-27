"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PRESETS, presetIdOf } from "@/lib/agent/presets";
import type { RunResult, Served } from "@/lib/agent/types";
import { entityNames, placeholderReason } from "@/lib/agent/evidence";
import { measureFromUrl, requestFromUrl, runIdFromUrl } from "@/lib/permalink";
import { AUDIT_SAMPLE_AUDIENCE } from "@/lib/auditSample";
import { AuditPanel } from "./AuditPanel";
import { BriefForm } from "./BriefForm";
import { Intro } from "./Intro";
import { CampaignPack } from "./CampaignPack";
import { DiffCard } from "./DiffCard";
import { ShipBar } from "./ShipBar";
import { TasteMap } from "./TasteMap";
import { callsLabel, callTally, Trace } from "./Trace";
import { endSentence, useRun, type RunOutcome } from "./useRun";

/** A failed request's message; with a result still on screen it says so, after the message has ended its sentence. */
export function RunError({ error, hasResult }: { error: string; hasResult: boolean }) {
  return (
    <div role="alert" className="rounded-xl border border-miss/50 bg-miss/10 px-3 py-2 text-body text-miss">
      {hasResult ? endSentence(error) : error}
      {hasResult && <span className="text-ink/80"> The previous result is still shown below.</span>}
    </div>
  );
}

/**
 * The ROI line, from this run's own measurements only. A run served from the
 * cache or a recording says its time was measured when it first ran. A
 * placeholder run (simulated Qloo or a scripted model) is labelled an offline demo run and counts neither misses
 * nor seconds: its timing is a stand-in's, not the product's.
 */
export function RoiLine({ result, served }: { result: RunResult; served?: Served }) {
  const seconds = Math.max(1, Math.round(result.durationMs / 1000));
  const checked = result.grounded.receipts.length + result.baseline.receipts.length;
  const blank = placeholderReason(result);
  const simulated = result.qloo.simulated > 0;
  const caught = blank || result.baseline.unavailable ? 0 : result.baseline.receipts.filter((r) => r.verdict !== "pass" && r.verdict !== "unscored").length;
  const when = served && served.from !== "simulated" ? (served.from === "recording" ? " (recorded run)" : " (when it first ran)") : "";
  return (
    <p className="mt-1 text-meta text-ink/80">
      {blank ? (
        <strong className="text-accent">Offline demo run</strong>
      ) : (
        <strong className="text-accent">
          This plan took {seconds} s{when}
        </strong>
      )}{" "}
      {blank ? "with" : "and"} {result.qloo.calls} {simulated ? "simulated Qloo calls" : "Qloo calls"}, with {checked} cultural picks checked
      {caught > 0 ? `; ${caught} of the plain model's picks would have shipped wrong` : ""}.
      {blank && <span className="ml-1.5 whitespace-nowrap rounded bg-fade/15 px-1.5 py-0.5 text-caption font-medium text-fade">{simulated ? "simulated" : "scripted model"}: no miss count</span>}
    </p>
  );
}

/**
 * The With / Without Qloo switch. It stays pinned to the top of the screen so its effect is always in view.
 * Below the desktop layout (where the trace sits in the left rail) it also jumps to the trace, which is
 * otherwise several screens down at phone width.
 */
function PlanToggle({
  mode,
  setMode,
  result,
  calls,
  onTrace,
}: {
  mode: "qloo" | "without";
  setMode: (m: "qloo" | "without") => void;
  result?: RunResult;
  /** Calls in the trace so far, and how many of them the offline simulator answered. */
  calls: { calls: number; simulated: number };
  onTrace: () => void;
}) {
  const flagged = result && !result.baseline.unavailable ? result.baseline.receipts.filter((r) => r.verdict === "miss" || r.verdict === "hallucination").length : 0;
  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-bg/80 sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* On a phone the toggle's pressed state says this, so the line gives its room to the trace link (still read out). */}
          <p className="sr-only text-meta leading-snug text-muted sm:not-sr-only" aria-live="polite">
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
          {calls.calls > 0 && (
            <a
              href="#agent-trace"
              onClick={(e) => {
                e.preventDefault();
                onTrace();
              }}
              className="whitespace-nowrap text-meta font-medium text-violet hover:underline lg:hidden"
            >
              Trace · {callsLabel(calls)} ↓
            </a>
          )}
        </div>
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
  const { steps, pending, live, served, result, error, running, run, open, requery } = useRun();
  const [mode, setMode] = useState<"qloo" | "without">("qloo");
  // The URL decides what runs on first load; read it once, at mount.
  const [initial] = useState(() => ({ measure: measureFromUrl(params), runId: runIdFromUrl(params), request: requestFromUrl(params) }));
  const [activePreset, setActivePreset] = useState(!initial.measure && !initial.runId && "preset" in initial.request ? initial.request.preset : undefined);
  const [copied, setCopied] = useState(false);
  // Kept here so the toggle bar's jump link can open a collapsed trace.
  const [traceCollapsed, setTraceCollapsed] = useState(false);
  // The brief form folds into a one-line summary once there is a run to look at.
  const [editing, setEditing] = useState(false);
  // "Paste any AI's plan" in the header opens the audit panel further down.
  const [auditOpen, setAuditOpen] = useState(false);
  // A shared `?b=` brief is someone else's text: it is shown, and runs (spending the demo's budget) only on a click.
  const [shared, setShared] = useState(!initial.measure && !initial.runId && "brief" in initial.request ? initial.request : undefined);
  // A `?run=` link the server doesn't know (or couldn't be asked about): the hero preset is shown instead, with this notice on top.
  const [deadLink, setDeadLink] = useState<"gone" | "failed">();

  // The preset behind the result on screen (none for a custom brief or a permalink); unset while nothing is shown.
  // A failed run leaves that result in place, so the highlight goes back to its preset, not to whatever was clicked last.
  const shown = useRef<{ preset?: string }>(undefined);
  const settle = useCallback((preset: string | undefined, outcome: RunOutcome | "gone") => {
    if (outcome === "ok") shown.current = { preset };
    else if (outcome === "failed" && shown.current) setActivePreset(shown.current.preset);
  }, []);

  // All deps are stable (a useState value and useCallbacks), so this starts once per mount.
  useEffect(() => {
    if (initial.measure) void requery(initial.measure).then((outcome) => settle(undefined, outcome));
    else if (initial.runId) {
      let preset: string | undefined;
      // A permalink to a preset's run highlights that preset (and offers "Re-run live").
      void open(initial.runId, (r) => {
        preset = presetIdOf(r.brief);
        if (preset) setActivePreset(preset);
      }).then((outcome) => {
        settle(preset, outcome);
        // A dead link never leaves the page empty: say so, and show the hero preset.
        if (outcome !== "gone" && outcome !== "failed") return;
        setDeadLink(outcome);
        setActivePreset(PRESETS[0].id);
        void run({ preset: PRESETS[0].id }).then((o) => settle(PRESETS[0].id, o));
      });
    } else if (!("brief" in initial.request)) {
      const { preset } = initial.request;
      void run(initial.request).then((outcome) => settle(preset, outcome));
    }
  }, [initial, run, open, requery, settle]);

  const side = result ? (mode === "qloo" ? result.grounded : result.baseline) : undefined;
  const showForm = editing || (!result && !running);
  const runSimulated = !!result && result.qloo.simulated > 0;
  const traceCalls = callTally(steps);
  const openAudit = () => {
    setAuditOpen(true);
    // Once the panel's body is shown, so the scroll lands on the final layout and focus on the plan box.
    requestAnimationFrame(() => {
      document.getElementById("audit")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector<HTMLTextAreaElement>("#audit textarea")?.focus({ preventScroll: true });
    });
  };
  // Below the desktop layout the campaign pack sits a screen or more under the toggle, so flipping
  // the view would change nothing visible: bring the pack's top under the sticky bar.
  const switchMode = (m: "qloo" | "without") => {
    if (m === mode) return;
    setMode(m);
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    requestAnimationFrame(() => {
      const pack = document.querySelector('section[aria-label="Campaign pack"]');
      if (!pack || pack.getBoundingClientRect().top < window.innerHeight * 0.6) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      pack.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  };

  const jumpToTrace = () => {
    setTraceCollapsed(false);
    // After the expanded steps render, so the scroll lands on the final layout.
    requestAnimationFrame(() => {
      const el = document.getElementById("agent-trace");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.focus({ preventScroll: true });
    });
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-3 px-4 pb-5 pt-4 sm:px-6">
      {deadLink && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-fade/50 bg-fade/10 px-3 py-2 text-body text-ink">
          <p className="min-w-0">
            <strong className="font-semibold text-fade">{deadLink === "gone" ? "That shared run has expired or never existed;" : "That shared run couldn't be opened right now;"}</strong> here&apos;s the hero preset instead.
          </p>
          <button type="button" onClick={() => setDeadLink(undefined)} className="shrink-0 rounded-full border border-line px-3 py-1 text-meta text-ink hover:border-accent/60">
            Dismiss
          </button>
        </div>
      )}
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <Intro>{result && <RoiLine result={result} served={served} />}</Intro>
        {/* The second way in: someone else's plan, checked by the same critic. The panel itself stays below the diff card. */}
        <a
          href="#audit"
          onClick={(e) => {
            e.preventDefault();
            openAudit();
          }}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-violet/60 bg-violet/10 px-4 py-1.5 text-body font-semibold text-violet hover:bg-violet/20 lg:self-end lg:py-2"
        >
          Paste any AI&apos;s plan <span aria-hidden>→</span>
        </a>
      </header>

      <PlanToggle mode={mode} setMode={switchMode} result={result} calls={traceCalls} onTrace={jumpToTrace} />

      <section aria-label="Brief" className="space-y-2 rounded-2xl border border-line bg-panel p-3">
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
                setDeadLink(undefined);
                setEditing(false);
                // A refused or failed run leaves the previous result on screen, so the preset behind that one is highlighted again.
                void run({ preset: p.id }).then((outcome) => settle(p.id, outcome));
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
                  <span className="text-muted">{endSentence(`Audience loves ${result.brief.seeds.join(", ")}`)}</span>
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
            // "Edit brief" starts from the brief on screen, not from empty fields.
            current={result ? { id: result.id, brief: result.brief } : undefined}
            onRun={(b) => {
              setActivePreset(undefined);
              setDeadLink(undefined);
              setEditing(false);
              void run({ brief: b }).then((outcome) => settle(undefined, outcome));
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
              void run(shared).then((outcome) => {
                settle(undefined, outcome);
                if (outcome === "failed") setShared(shared);
              });
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-body font-semibold text-accent-ink"
          >
            Plan &amp; taste-check it
          </button>
        </div>
      )}
      {running && result && (
        <p role="status" className="rounded-xl border border-line bg-panel px-3 py-2 text-body text-muted">
          Planning and taste-checking a new run; the previous result stays below until it is ready.
        </p>
      )}
      {error && <RunError error={error} hasResult={!!result} />}
      {result && <DiffCard result={result} mode={mode} served={served} />}
      <AuditPanel seeds={result?.brief.seeds ?? AUDIT_SAMPLE_AUDIENCE.seeds} ages={result?.brief.ages ?? AUDIT_SAMPLE_AUDIENCE.ages} open={auditOpen} setOpen={setAuditOpen} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="order-3 min-w-0 lg:sticky lg:top-16 lg:order-1 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
          <Trace
            steps={steps}
            running={live}
            pending={pending}
            // While a new run streams, the trace is that run's, not the result on screen's.
            served={!live && served && result ? { ...served, at: result.createdAt } : undefined}
            // A preset served from the cache or a recording can be run again now ("fresh" skips both); live only when Qloo is.
            onRerun={activePreset && served ? () => void run({ preset: activePreset, fresh: true }) : undefined}
            rerunLive={!runSimulated}
            collapsed={traceCollapsed}
            setCollapsed={setTraceCollapsed}
            names={result ? entityNames(result) : undefined}
          />
        </div>
        <div className="order-2 min-w-0">{result ? <TasteMap result={result} /> : <Placeholder running={running} label="Taste Map" />}</div>
        <div className="order-1 min-w-0 scroll-mt-16 lg:order-3">
          {side ? <CampaignPack side={side} mode={mode} runSimulated={runSimulated} scripted={!!result?.llm.scripted} /> : <Placeholder running={running} label="Campaign pack" />}
        </div>
      </div>

      {result && mode === "qloo" && (
        <ShipBar
          // A new run starts with no receipt from the previous one.
          key={result.id}
          result={result}
          onMeasure={(campaignId) => {
            setActivePreset(undefined);
            void requery(campaignId).then((outcome) => settle(undefined, outcome));
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
