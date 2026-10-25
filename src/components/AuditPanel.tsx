"use client";

import { useId, useState } from "react";
import type { AuditResult } from "@/lib/agent/audit";
import { annotation } from "@/lib/agent/evidence";
import type { Receipt, Verdict } from "@/lib/agent/types";
import { AUDIT_SAMPLE, AUDIT_SAMPLE_AUDIENCE } from "@/lib/auditSample";
import { AGE_BUCKETS, ROLE_LABEL, type AgeBucket } from "@/lib/vocab";
import { AGE_LABEL, Chips, INPUT } from "./BriefForm";
import { ReceiptChip, receiptNote } from "./Receipt";

/** Same limit as the server's (src/lib/agent/extract.ts), kept here so the browser never imports server code. */
const MAX_CHARS = 4000;

const STRUCK: ReadonlySet<Verdict> = new Set(["miss", "hallucination"]);
const NAME_CLS: Record<Verdict, string> = { pass: "text-ink", miss: "text-miss line-through", hallucination: "text-invented line-through", fading: "text-fade", unscored: "text-muted" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the audit found, in words; a simulated audit gives no verdict counts. */
export function auditSummary(r: Pick<AuditResult, "receipts" | "metrics" | "simulated">): string {
  const n = r.receipts.length;
  if (!n) return "No cultural names found to check. Label the picks (e.g. “Collab targets: …”) or name artists, brands, shows and venues in full.";
  if (r.simulated) return `${plural(n, "name")} found and checked by the offline simulator. Its verdicts are simulated, not Qloo's, so no counts are given.`;
  const m = r.metrics;
  const passed = r.receipts.filter((x) => x.verdict === "pass").length;
  return `${plural(n, "name")} checked by Qloo: ${m.hallucinations} not found in Qloo · ${m.misses} low-affinity · ${m.fading} fading · ${passed} pass${m.unscored ? ` · ${m.unscored} unscored` : ""}.`;
}

function extractionNote(r: AuditResult): string {
  const e = r.extraction;
  const how =
    e.by === "model"
      ? `Names listed by ${e.model ?? "the model"} from your text; every one is checked against the catalogue, so an invented name comes back not found.`
      : "Names found by the deterministic scanner: every name on a labelled line (“Collab targets: …”), invented ones included, plus other names the catalogue knows by that exact name.";
  const skipped = e.unsearched ? ` ${plural(e.unsearched, "other capitalised phrase")} past the scan's limit ${e.unsearched === 1 ? "wasn't" : "weren't"} looked up.` : "";
  return `${how}${e.fallback ? ` The model wasn't used: ${e.fallback}.` : ""}${e.capped ? " Only the first 15 names are audited." : ""}${skipped}`;
}

function AuditRow({ r, suggestion, simulated }: { r: Receipt; suggestion?: string; simulated: boolean }) {
  const note = simulated ? receiptNote(r, true) : annotation(r);
  return (
    <li className="min-w-0 space-y-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-meta uppercase tracking-wider text-muted">{ROLE_LABEL[r.role]}</span>
        <span className={`text-body font-medium ${NAME_CLS[r.verdict]} ${STRUCK.has(r.verdict) ? "decoration-2" : ""}`}>{r.name}</span>
        {suggestion && (
          <span className="text-meta text-muted">
            → <span className="text-pass">{suggestion}</span> {simulated ? "(the simulator's pick)" : "(Qloo's pick)"}
          </span>
        )}
      </div>
      {r.verdict !== "pass" && note && <p className="text-meta leading-snug text-muted">{note}</p>}
      <ReceiptChip r={r} runSimulated={simulated} />
    </li>
  );
}

/** The audit's findings: a summary, how the names were found, then every name with its receipt. */
export function AuditResults({ result }: { result: AuditResult }) {
  const swap = (r: Receipt) => result.suggestions.find((s) => s.role === r.role && s.from.toLowerCase() === r.name.toLowerCase())?.to;
  return (
    <div className="space-y-2">
      <p className="text-body text-ink">
        {result.simulated && <span className="mr-1.5 rounded bg-fade/15 px-1.5 py-0.5 text-caption font-medium text-fade">simulated data, not Qloo</span>}
        {auditSummary(result)}
      </p>
      <p className="text-meta leading-snug text-muted">{extractionNote(result)}</p>
      {result.receipts.length > 0 && (
        <ul className="space-y-2 rounded-xl border border-line bg-panel-2/40 p-2.5">
          {result.receipts.map((r) => (
            <AuditRow key={`${r.role}-${r.name}`} r={r} suggestion={swap(r)} simulated={result.simulated} />
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && <p className="text-meta text-fade">Some checks didn&apos;t finish: {result.warnings.join("; ")}</p>}
    </div>
  );
}

/**
 * "Audit any AI's plan": paste a campaign anyone wrote and the Qloo critic
 * judges every cultural name in it against an audience. Closed by default;
 * the audience starts as the current brief's.
 */
export function AuditPanel({ seeds, ages }: { seeds: readonly string[]; ages: readonly AgeBucket[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [names, setNames] = useState(seeds.join(", "));
  const [audienceAges, setAges] = useState<AgeBucket[]>([...ages]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AuditResult>();

  async function audit(plan: { text: string; names: string; ages: AgeBucket[] }) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: plan.text, seeds: plan.names.split(",").map((s) => s.trim()).filter(Boolean), ages: plan.ages }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<AuditResult> & { error?: string };
      if (!res.ok || !body.receipts) throw new Error(body.error ?? `The audit failed (${res.status})`);
      setResult(body as AuditResult);
    } catch (err) {
      setResult(undefined);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-violet/40 bg-violet/5 p-3 sm:p-4">
      <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((o) => !o)} className="flex w-full items-baseline justify-between gap-3 text-left">
          <span>Audit any AI&apos;s plan</span>
          <span className="shrink-0 text-meta font-normal text-violet">{open ? "Close" : "Open"}</span>
        </button>
      </h2>
      <p className="mt-0.5 text-meta leading-snug text-muted">Paste a campaign written by ChatGPT, Claude or anyone: Qloo checks every name in it against your audience.</p>
      <div id={`${id}-body`} hidden={!open} className="mt-3 space-y-3">
        <form
          aria-label="Plan to audit"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void audit({ text, names, ages: audienceAges });
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor={`${id}-text`} className="text-caption text-muted">
              The plan, as the AI wrote it
            </label>
            <button
              type="button"
              // One click: fill in a chatbot-style plan for the hero audience and audit it.
              onClick={() => {
                const sample = { text: AUDIT_SAMPLE, names: AUDIT_SAMPLE_AUDIENCE.seeds.join(", "), ages: [...AUDIT_SAMPLE_AUDIENCE.ages] };
                setText(sample.text);
                setNames(sample.names);
                setAges(sample.ages);
                void audit(sample);
              }}
              disabled={busy}
              className="rounded-full border border-violet/60 px-3 py-1 text-meta text-violet hover:bg-violet/10"
            >
              Try a sample plan
            </button>
          </div>
          <textarea
            id={`${id}-text`}
            required
            minLength={20}
            maxLength={MAX_CHARS}
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Collab targets: …\nBrand partners: …\nOr paste the whole plan: hooks, captions, schedule."}
            className={`${INPUT} min-h-32 resize-y font-mono text-body-sm leading-snug`}
          />
          <p className="text-right font-mono text-caption text-muted" aria-live="polite">
            {text.length.toLocaleString("en-US")} / {MAX_CHARS.toLocaleString("en-US")}
          </p>
          <label className="block text-caption text-muted">
            The audience already loves (comma-separated)
            <input required className={INPUT} value={names} onChange={(e) => setNames(e.target.value)} placeholder="Tems, Rema, Asake" />
          </label>
          <Chips
            label="Audience ages"
            options={AGE_BUCKETS}
            selected={(a) => audienceAges.includes(a)}
            toggle={(a: AgeBucket) => setAges((xs) => (xs.includes(a) ? (xs.length > 1 ? xs.filter((x) => x !== a) : xs) : [...xs, a]))}
            name={AGE_LABEL}
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-violet px-4 py-2 text-body font-semibold text-bg disabled:opacity-60">
            {busy ? "Auditing…" : "Audit every name"}
          </button>
        </form>
        <div role="region" aria-label="Audit results" aria-live="polite" aria-busy={busy}>
          {error && <p role="alert" className="rounded-lg border border-miss/50 bg-miss/10 px-2.5 py-1.5 text-body text-miss">{error}</p>}
          {result && !busy && <AuditResults result={result} />}
        </div>
      </div>
    </section>
  );
}
