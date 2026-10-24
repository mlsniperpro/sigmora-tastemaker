"use client";

import { useState } from "react";
import type { RunResult } from "@/lib/agent/types";
import type { ShipReceipt } from "@/lib/publisher";

/** Ship the verified pack; once Sigmora has measured it, re-run with the picks that performed as the new seeds. */
export function ShipBar({ result, onMeasure }: { result: RunResult; onMeasure: (campaignId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ShipReceipt>();
  const [error, setError] = useState<string>();
  /** Picks the critic still flags; Ship asks before sending them. */
  const [flagged, setFlagged] = useState<{ name: string; verdict: string; note: string }[]>();

  async function ship(acceptFlagged = false) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: result.id, acceptFlagged }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ShipReceipt> & { error?: string; flagged?: { name: string; verdict: string; note: string }[] };
      if (res.status === 409 && body.flagged) {
        setFlagged(body.flagged);
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `Ship failed (${res.status})`);
      setFlagged(undefined);
      setReceipt(body as ShipReceipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Ship" className="rounded-2xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Ship it</h2>
          <p className="text-meta text-muted">
            Hand the pack to Sigmora: {result.grounded.draft.captions.length} posts, one a day, plus the hooks, script and music brief for production. The
            public demo uses a labeled sandbox publisher.
          </p>
        </div>
        <button type="button" onClick={() => void ship()} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-body font-semibold text-accent-ink disabled:opacity-60">
          {busy ? "Scheduling…" : "Schedule with Sigmora"}
        </button>
      </div>
      {error && <p className="mt-2 text-meta text-miss">{error}</p>}
      {flagged && (
        <div role="alertdialog" aria-label="Flagged picks" className="mt-3 space-y-1.5 rounded-lg border border-fade/40 bg-fade/10 p-2.5 text-meta text-fade">
          <p>
            <strong>{flagged.length} pick{flagged.length > 1 ? "s" : ""} still failed the Qloo critic.</strong> Ship anyway, or pick another preset or brief.
          </p>
          <ul className="list-disc pl-5">
            {flagged.map((f) => (
              <li key={f.name}>
                {f.name}: {f.note}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void ship(true)} disabled={busy} className="rounded-lg border border-fade/60 px-3 py-1 text-fade">
            Ship anyway
          </button>
        </div>
      )}
      {receipt && (
        <div className="mt-3 space-y-1.5">
          <p className="text-meta text-fade">{receipt.note}</p>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {receipt.posts.map((p) => (
              <li key={p.platform + p.scheduledFor} className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-meta">
                <span className="font-medium text-ink">{p.platform}</span>{" "}
                <span className="text-muted">{new Date(p.scheduledFor).toUTCString().slice(0, 22)} UTC</span>{" "}
                <span className={p.status === "scheduled" ? "text-pass" : "text-fade"}>· {p.status}</span>
              </li>
            ))}
          </ul>
          <p className="font-mono text-label text-muted">campaign {receipt.campaignId}</p>
          {receipt.publisher === "sigmora" && (
            <p className="flex flex-wrap items-center gap-2 text-meta text-muted">
              <button type="button" onClick={() => onMeasure(receipt.campaignId)} className="rounded-lg border border-accent/60 px-3 py-1.5 text-accent">
                Measure and re-query
              </button>
              <span>
                once 2+ posts have 500+ impressions: the picks that performed become the next run&apos;s seeds. Bookmark{" "}
                <a className="text-violet underline" href={`/?measure=${encodeURIComponent(receipt.campaignId)}`}>
                  this link
                </a>{" "}
                to measure later.
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
