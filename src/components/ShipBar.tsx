"use client";

import { useState } from "react";
import type { RunResult } from "@/lib/agent/types";
import type { ShipReceipt } from "@/lib/publisher";

export function ShipBar({ result }: { result: RunResult }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [receipt, setReceipt] = useState<ShipReceipt>();
  const [error, setError] = useState<string>();

  async function ship() {
    setState("busy");
    setError(undefined);
    try {
      const res = await fetch("/api/ship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: result.id,
          subject: result.brief.subject,
          posts: result.grounded.draft.captions,
          verifiedPicks: result.grounded.receipts.filter((r) => r.verdict === "pass").map((r) => r.name),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Ship failed (${res.status})`);
      setReceipt(body as ShipReceipt);
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }

  return (
    <section aria-label="Ship" className="rounded-2xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Ship it</h2>
          <p className="text-[12px] text-muted">
            Hand the verified pack to Sigmora: {result.grounded.draft.captions.length} posts, one a day. The public demo uses a labeled sandbox publisher.
          </p>
        </div>
        <button type="button" onClick={ship} disabled={state === "busy"} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink disabled:opacity-60">
          {state === "busy" ? "Scheduling…" : "Schedule with Sigmora"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-miss">{error}</p>}
      {receipt && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[12px] text-fade">{receipt.note}</p>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {receipt.posts.map((p) => (
              <li key={p.platform + p.scheduledFor} className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px]">
                <span className="font-medium text-ink">{p.platform}</span>{" "}
                <span className="text-muted">{new Date(p.scheduledFor).toUTCString().slice(0, 22)} UTC</span>{" "}
                <span className={p.status === "scheduled" ? "text-pass" : "text-fade"}>· {p.status}</span>
              </li>
            ))}
          </ul>
          <p className="font-mono text-[10px] text-muted">campaign {receipt.campaignId}</p>
        </div>
      )}
    </section>
  );
}
