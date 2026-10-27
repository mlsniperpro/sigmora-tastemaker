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

const DESCRIPTION = "Paste a campaign written by ChatGPT, Claude or anyone: Qloo checks every name in it against your audience.";

/**
 * Said above a simulated audit's results. The catalog's size isn't given: it lives in a server-only module
 * (the browser never imports it, tests/unit/client-bundle.test.ts), and the audit's answer doesn't carry it.
 */
export const SIMULATED_CATALOG_NOTE = "Offline demo catalog (small): famous names may be missing or judged by placeholder data. A Qloo key gives real verdicts.";

const STRUCK: ReadonlySet<Verdict> = new Set(["miss", "hallucination"]);
const NAME_CLS: Record<Verdict, string> = { pass: "text-ink", miss: "text-miss line-through", hallucination: "text-invented line-through", fading: "text-fade", unscored: "text-muted" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Same limits as the server's audit request (src/lib/agent/audit.ts, src/lib/agent/brief.ts), checked in the browser first. */
const MIN_CHARS = 20;
const MAX_NAMES = 5;
const MAX_NAME_CHARS = 80;

/** The audience field's names: comma-separated, trimmed, blanks and repeats dropped. */
export const audienceNames = (names: string) => [...new Set(names.split(",").map((s) => s.trim()).filter(Boolean))];

export const NAME_ONE = "Name at least one artist or brand your audience loves.";

/** What's wrong with the form before it is sent, in words the reader can act on; undefined when it can go. */
export function auditInputProblem(plan: { text: string; names: string }): { field: "text" | "names"; message: string } | undefined {
  if (plan.text.trim().length < MIN_CHARS) return { field: "text", message: "Paste at least a sentence or two of the plan." };
  const names = audienceNames(plan.names);
  if (!names.length) return { field: "names", message: NAME_ONE };
  if (names.length > MAX_NAMES) return { field: "names", message: `Name up to ${MAX_NAMES} artists or brands your audience loves (you gave ${names.length}).` };
  if (names.some((n) => n.length > MAX_NAME_CHARS)) return { field: "names", message: `Keep each name under ${MAX_NAME_CHARS} characters, and separate names with commas.` };
  return undefined;
}

/**
 * The server's refusal in words: a 400 is a request the browser check let through (its schema text is
 * for developers, so it is never shown); other statuses already carry a sentence for people.
 */
export function friendlyAuditError(status: number, error?: string): string {
  if (status === 400) {
    if (/\bseeds\b/.test(error ?? "")) return NAME_ONE;
    if (/\btext\b/.test(error ?? "")) return "Paste at least a sentence or two of the plan, up to 4,000 characters.";
    if (/\bages\b/.test(error ?? "")) return "Pick at least one age range for the audience.";
    return "The audit couldn't read that request. Check the plan and the audience's names, then try again.";
  }
  return error ?? `The audit failed (${status}). Try again shortly.`;
}

/** What the audit found, in words; a simulated audit gives no verdict counts. */
export function auditSummary(r: Pick<AuditResult, "receipts" | "metrics" | "simulated">): string {
  const n = r.receipts.length;
  if (!n) return "No cultural names found to check. Label the picks (e.g. “Collab targets: …”) or name artists, brands, shows and venues in full.";
  if (r.simulated) return `${plural(n, "name")} found and checked by the offline simulator. Its verdicts are simulated, not Qloo's, so no counts are given.`;
  const m = r.metrics;
  const passed = r.receipts.filter((x) => x.verdict === "pass").length;
  return `${plural(n, "name")} checked by Qloo: ${m.hallucinations} not found in Qloo · ${m.misses} low-affinity · ${m.fading} fading · ${passed} pass${m.unscored ? ` · ${m.unscored} unscored` : ""}.`;
}

export function extractionNote(r: AuditResult): string {
  const e = r.extraction;
  const how =
    e.by === "model"
      ? `Names listed by ${e.model ?? "the model"} from your text; every one is checked against the catalogue, so an invented name comes back not found.`
      : "Names found by the deterministic scanner: every name on a labelled line (“Collab targets: …”), invented ones included, plus other names the catalogue knows by that exact name.";
  const skipped = e.unsearched ? ` ${plural(e.unsearched, "other capitalised phrase")} past the scan's limit ${e.unsearched === 1 ? "wasn't" : "weren't"} looked up.` : "";
  const list = (names: readonly string[]) => names.slice(0, 8).join(", ") + (names.length > 8 ? `, and ${String(names.length - 8)} more` : "");
  // Prose names the catalogue doesn't know by that exact name aren't audited (from prose alone an invention can't be told from an ordinary phrase): say which.
  const unmatched = e.unmatched?.length ? ` Not audited, because no entity has that exact name: ${list(e.unmatched)}. Put a name on a labelled line (“Collab targets: …”) to have it checked.` : "";
  const dropped = e.dropped?.length ? ` The model also listed ${list(e.dropped)}, which your text doesn't contain, so ${e.dropped.length === 1 ? "it wasn't" : "they weren't"} audited.` : "";
  const kinds = (e.otherTypes ?? []).map((o) => `${o.name} (${o.type.replace(/_/g, " ")})`);
  const other = kinds.length ? ` Known to the catalogue as a kind this audit doesn't check: ${list(kinds)}.` : "";
  const cached = r.recorded
    ? ` This is the recorded live audit of the sample, shown because a new audit was refused (${r.refusedBecause ?? "budget"}).`
    : r.cached
      ? " Served from an identical earlier audit, so no Qloo calls were spent."
      : "";
  return `${how}${e.fallback ? ` The model wasn't used: ${e.fallback}.` : ""}${e.capped ? ` Only the first 15 names are audited${e.cut?.length ? ` (not checked: ${e.cut.join(", ")})` : ""}.` : ""}${skipped}${unmatched}${other}${dropped}${cached}`;
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
      {result.simulated && <p className="text-meta leading-snug text-fade">{SIMULATED_CATALOG_NOTE}</p>}
      <p className="text-body text-ink">
        {result.simulated && <span className="mr-1.5 rounded bg-fade/15 px-1.5 py-0.5 text-caption font-medium text-fade">simulated data, not Qloo</span>}
        {auditSummary(result)}
      </p>
      {/* The scan's caveats are a tap away, so on a phone the verdicts come first. */}
      <details className="text-meta leading-snug text-muted">
        <summary className="inline-flex min-h-6 cursor-pointer items-center text-violet">How the names were found</summary>
        <p className="mt-1">{extractionNote(result)}</p>
      </details>
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
 * judges every cultural name in it against an audience. Closed by default
 * (the page's header opens it too, through `open` / `setOpen`); the audience
 * starts as the current brief's.
 */
export function AuditPanel({
  seeds,
  ages,
  open: openProp,
  setOpen: setOpenProp,
}: {
  seeds: readonly string[];
  ages: readonly AgeBucket[];
  open?: boolean;
  setOpen?: (open: boolean) => void;
}) {
  const id = useId();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = setOpenProp ?? setOpenState;
  const [text, setText] = useState("");
  const [names, setNames] = useState(seeds.join(", "));
  const [audienceAges, setAges] = useState<AgeBucket[]>([...ages]);
  // The audience follows the brief on screen until the reader edits it (adjusting state while rendering, not in an effect).
  const [edited, setEdited] = useState(false);
  // The one-click sample brings its own audience; once the reader writes their own plan, the brief's comes back.
  const [sampleAudience, setSampleAudience] = useState(false);
  const briefAudience = `${seeds.join(", ")}|${ages.join(",")}`;
  const [shownAudience, setShownAudience] = useState(briefAudience);
  if (briefAudience !== shownAudience) {
    setShownAudience(briefAudience);
    if (!edited) {
      setNames(seeds.join(", "));
      setAges([...ages]);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [problem, setProblem] = useState<ReturnType<typeof auditInputProblem>>();
  const [result, setResult] = useState<AuditResult>();

  async function audit(plan: { text: string; names: string; ages: AgeBucket[] }) {
    const bad = auditInputProblem(plan);
    setProblem(bad);
    if (bad) {
      setResult(undefined);
      setError(undefined);
      document.getElementById(`${id}-${bad.field}`)?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: plan.text, seeds: audienceNames(plan.names), ages: plan.ages }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<AuditResult> & { error?: string };
      if (!res.ok || !body.receipts) throw new Error(friendlyAuditError(res.status, body.error));
      setResult(body as AuditResult);
    } catch (err) {
      setResult(undefined);
      // A network failure has no status, and its message is the browser's: it gets a plain sentence too.
      setError(err instanceof TypeError ? "The audit couldn't reach the server. Check your connection and try again." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="audit" aria-labelledby={`${id}-title`} className="scroll-mt-16 rounded-2xl border border-violet/40 bg-violet/5 p-3 sm:p-4">
      <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)} className="flex min-h-6 w-full items-baseline justify-between gap-3 text-left">
          <span className="shrink-0">Audit any AI&apos;s plan</span>
          {/* On desktop the description shares the title's line (the paragraph below is then for screen readers only). */}
          <span aria-hidden className="hidden min-w-0 flex-1 truncate text-meta font-normal text-muted lg:block">
            {DESCRIPTION}
          </span>
          <span className="shrink-0 text-meta font-normal text-violet">{open ? "Close" : "Open"}</span>
        </button>
      </h2>
      <p className="mt-0.5 text-meta leading-snug text-muted lg:sr-only">{DESCRIPTION}</p>
      <div id={`${id}-body`} hidden={!open} className="mt-3 space-y-3">
        <form
          aria-label="Plan to audit"
          className="space-y-2"
          // The browser's own bubbles can't say what's wrong in this form's words; auditInputProblem does.
          noValidate
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
                setSampleAudience(!edited);
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
            minLength={MIN_CHARS}
            maxLength={MAX_CHARS}
            aria-invalid={problem?.field === "text" || undefined}
            aria-describedby={problem?.field === "text" ? `${id}-problem` : undefined}
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (problem?.field === "text") setProblem(undefined);
              if (sampleAudience && !edited) {
                setNames(seeds.join(", "));
                setAges([...ages]);
                setSampleAudience(false);
              }
            }}
            placeholder={"Collab targets: …\nBrand partners: …\nOr paste the whole plan: hooks, captions, schedule."}
            className={`${INPUT} min-h-32 resize-y font-mono text-body-sm leading-snug`}
          />
          <p className="text-right font-mono text-caption text-muted" aria-live="polite">
            {text.length.toLocaleString("en-US")} / {MAX_CHARS.toLocaleString("en-US")}
          </p>
          <label className="block text-caption text-muted">
            The audience already loves (comma-separated){sampleAudience ? " · the sample's audience" : ""}
            <input
              id={`${id}-names`}
              required
              className={INPUT}
              value={names}
              aria-invalid={problem?.field === "names" || undefined}
              aria-describedby={problem?.field === "names" ? `${id}-problem` : undefined}
              onChange={(e) => {
                setNames(e.target.value);
                setEdited(true);
                if (problem?.field === "names") setProblem(undefined);
              }}
              placeholder="Tems, Rema, Asake"
            />
          </label>
          <Chips
            label="Audience ages"
            options={AGE_BUCKETS}
            selected={(a) => audienceAges.includes(a)}
            toggle={(a: AgeBucket) => {
              setEdited(true);
              setAges((xs) => (xs.includes(a) ? (xs.length > 1 ? xs.filter((x) => x !== a) : xs) : [...xs, a]));
            }}
            name={AGE_LABEL}
          />
          {problem && (
            <p id={`${id}-problem`} role="alert" className="text-body text-miss">
              {problem.message}
            </p>
          )}
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
