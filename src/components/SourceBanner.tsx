"use client";

import type { RunResult } from "@/lib/agent/types";

/** Says plainly where this run's numbers came from, including any live failure that forced a fallback. */
export function SourceBanner({ result }: { result: RunResult }) {
  const q = result.qloo;
  const fellBack = q.fallbacks.length > 0;
  const allLive = q.live + q.cached === q.calls;
  if (allLive && !result.llm.scripted) return null;
  return (
    <div role="note" className="space-y-0.5 rounded-xl border border-fade/40 bg-fade/10 px-3 py-2 text-meta leading-snug text-fade">
      {fellBack && (
        <p>
          <strong>Live Qloo failed for {q.fallbackCalls} of {q.calls} calls</strong> ({q.fallbacks.map((f) => f.reason).join("; ")}). Those
          answers are recorded live responses, each labeled in the trace.
        </p>
      )}
      {!fellBack && q.simulated > 0 && (
        <p>
          <strong>Simulated Qloo data.</strong> No Qloo key is configured on this deployment, so responses come from an offline simulator with placeholder
          numbers in Qloo&apos;s response shapes. They are not Qloo data.
        </p>
      )}
      {!fellBack && q.simulated === 0 && q.replay > 0 && (
        <p>
          <strong>Replayed Qloo responses.</strong> {q.replay} of {q.calls} answers were recorded from the live hackathon API and served from fixtures.
        </p>
      )}
      {result.llm.scripted && (
        <p>
          <strong>Scripted model.</strong> No LLM key is set, so drafts come from a deterministic stand-in.
        </p>
      )}
    </div>
  );
}
