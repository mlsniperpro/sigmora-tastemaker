"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BriefInput } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import type { RunEvent, RunResult, TraceStep } from "@/lib/agent/types";
import { AGE_BUCKETS } from "@/lib/qloo/types";
import { CampaignPack } from "./CampaignPack";
import { ShipBar } from "./ShipBar";
import { TasteMap } from "./TasteMap";
import { Trace } from "./Trace";

type Req = { preset: string } | { brief: BriefInput };

function encodeBrief(b: BriefInput): string {
  const bytes = new TextEncoder().encode(JSON.stringify(b));
  let s = "";
  bytes.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBrief(s: string): BriefInput | undefined {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

function SourceBanner({ result }: { result: RunResult }) {
  const sim = result.sources.includes("simulated");
  const replay = result.sources.includes("replay");
  const scripted = result.llm.scripted;
  if (!sim && !replay && !scripted) return null;
  return (
    <div role="note" className="rounded-xl border border-fade/40 bg-fade/10 px-3 py-2 text-[12px] leading-snug text-fade">
      {sim && (
        <p>
          <strong>Simulated Qloo data.</strong> No Qloo key is configured on this deployment, so responses come from an offline simulator with
          placeholder numbers in Qloo&apos;s response shapes. They are not Qloo data.
        </p>
      )}
      {!sim && replay && <p><strong>Replayed Qloo responses.</strong> Recorded from the live hackathon API and served from fixtures.</p>}
      {scripted && <p className="mt-0.5"><strong>Scripted model.</strong> No LLM key is set, so drafts come from a deterministic stand-in.</p>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "plain" }) {
  return (
    <div className="min-w-0">
      <div className={`font-mono text-2xl font-semibold ${tone === "good" ? "text-pass" : tone === "bad" ? "text-miss" : "text-ink"}`}>{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
    </div>
  );
}

function Scoreboard({ result }: { result: RunResult }) {
  const g = result.metrics.grounded;
  const b = result.metrics.baseline;
  const p = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-panel p-4 sm:grid-cols-4">
      <Metric label="Culture Miss Rate, plain LLM (this run)" value={p(b.cultureMissRate)} tone="bad" />
      <Metric label="Culture Miss Rate, with Qloo critic" value={p(g.cultureMissRate)} tone="good" />
      <Metric label="Invented entities caught" value={String(b.hallucinations)} tone="plain" />
      <Metric label="Picks replaced by the critic" value={String(result.grounded.receipts.filter((r) => r.replaced).length)} tone="plain" />
    </div>
  );
}

const AGE_LABEL = (a: string) => a.replace(/_/g, " ").replace("and younger", "& under").replace("and older", "+");

function CustomBrief({ onRun, busy }: { onRun: (b: BriefInput) => void; busy: boolean }) {
  const [subject, setSubject] = useState("");
  const [product, setProduct] = useState("");
  const [seeds, setSeeds] = useState("");
  const [link, setLink] = useState("");
  const [ages, setAges] = useState<string[]>(["25_to_29", "30_to_34"]);
  const [family, setFamily] = useState<"music" | "dtc" | "sports">("music");
  const [goal, setGoal] = useState("");
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const hero = PRESETS[0].brief;
        onRun({
          family,
          subject: subject.trim() || "My launch",
          product: product.trim() || "new release",
          seeds: seeds.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5),
          seedLinks: link.trim() ? [link.trim()] : [],
          ages: ages as BriefInput["ages"],
          goal: goal.trim() || "Launch to the right audience.",
          candidateCities: hero.candidateCities,
        });
      }}
    >
      <label className="text-[11px] text-muted">
        Who&apos;s launching
        <input className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Artist, brand or club" maxLength={80} />
      </label>
      <label className="text-[11px] text-muted">
        What
        <input className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="A single, a pop-up, a season" maxLength={120} />
      </label>
      <label className="text-[11px] text-muted sm:col-span-2">
        Your audience already loves (comma-separated)
        <input required className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="Tems, Rema, Asake" />
      </label>
      <label className="text-[11px] text-muted sm:col-span-2">
        Or paste a Spotify artist / IMDb link (optional)
        <input type="url" className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://open.spotify.com/artist/…" />
      </label>
      <label className="text-[11px] text-muted sm:col-span-2">
        Goal
        <input className="mt-0.5 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Launch to 25–34s and pick the first city" maxLength={200} />
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="text-[11px] text-muted">Ages</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {AGE_BUCKETS.map((a) => {
            const on = ages.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => setAges((xs) => (on ? (xs.length > 1 ? xs.filter((x) => x !== a) : xs) : [...xs, a]))}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}
              >
                {AGE_LABEL(a)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <select className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-ink" value={family} onChange={(e) => setFamily(e.target.value as typeof family)} aria-label="Kind of launch">
          <option value="music">Music release</option>
          <option value="dtc">Brand / DTC</option>
          <option value="sports">Sports club</option>
        </select>
        <button disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-ink disabled:opacity-50">
          Plan &amp; taste-check
        </button>
      </div>
    </form>
  );
}

export function App() {
  const params = useSearchParams();
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [result, setResult] = useState<RunResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"qloo" | "without">("qloo");
  const [activePreset, setActivePreset] = useState<string>();
  const [showCustom, setShowCustom] = useState(false);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (req: Req) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setSteps([]);
    setResult(undefined);
    setError(undefined);
    setRunning(true);
    setActivePreset("preset" in req ? req.preset : undefined);
    const url = new URL(window.location.href);
    url.search = "preset" in req ? `?preset=${req.preset}` : `?b=${encodeBrief(req.brief)}`;
    window.history.replaceState(null, "", url);
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Run failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as RunEvent;
          if (ev.type === "step") setSteps((s) => [...s, ev.step]);
          else if (ev.type === "result") setResult(ev.result);
          else setError(ev.message);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctrl) setRunning(false);
    }
  }, []);

  useEffect(() => {
    const preset = params.get("preset");
    const b = params.get("b");
    const brief = b ? decodeBrief(b) : undefined;
    // Reading the URL once on mount decides what to run; a fetch must follow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(brief ? { brief } : { preset: PRESETS.some((p) => p.id === preset) ? preset! : PRESETS[0].id });
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
              onClick={() => run({ preset: p.id })}
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
        {showCustom && <CustomBrief busy={running} onRun={(b) => run({ brief: b })} />}
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
