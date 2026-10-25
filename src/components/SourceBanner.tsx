"use client";

import type { RunResult } from "@/lib/agent/types";

/**
 * Where this run's numbers came from, in one line: what was simulated, replayed or scripted (in bold), then
 * why and what that hides. Includes any live failure that forced a fallback. Nothing when every Qloo answer
 * was live and a real model drafted the plan.
 */
export function SourceBanner({ result, className = "" }: { result: RunResult; className?: string }) {
  const q = result.qloo;
  const fellBack = q.fallbacks.length > 0;
  const simulated = !fellBack && q.simulated > 0;
  const replayed = !fellBack && !simulated && q.replay > 0;
  const scripted = result.llm.scripted;
  if (!fellBack && !simulated && !replayed && !scripted) return null;

  const labels = [
    ...(fellBack ? [`Live Qloo failed for ${q.fallbackCalls} of ${q.calls} calls`] : []),
    ...(simulated ? ["Simulated Qloo data"] : []),
    ...(replayed ? ["Replayed Qloo responses"] : []),
    ...(scripted ? ["Scripted model"] : []),
  ];
  const keyless = simulated && scripted ? "No Qloo or LLM key on this deployment: " : simulated ? "No Qloo key on this deployment: " : scripted && !fellBack && !replayed ? "No LLM key is set: " : "";
  const parts = [
    ...(fellBack ? [`those answers are recorded live responses, each labeled in the trace (${q.fallbacks.map((f) => f.reason).join("; ")})`] : []),
    ...(simulated ? ["answers come from an offline simulator in Qloo's shapes (not Qloo data)"] : []),
    ...(replayed ? [`${q.replay} of ${q.calls} answers are recorded live hackathon API responses, served from fixtures`] : []),
    ...(scripted ? [simulated ? "drafts from a deterministic stand-in" : "drafts come from a deterministic stand-in, not a model"] : []),
  ];
  const hidden = simulated ? ", so numbers are not shown" : scripted ? ", so miss counts are not shown" : "";
  const sentence = `${keyless}${parts.join(keyless ? " and " : "; ")}${hidden}.`;
  return (
    <p role="note" className={`text-meta leading-snug text-muted ${className}`}>
      <strong className="font-semibold text-fade">{labels.join(" · ")}.</strong> {keyless ? sentence : sentence.charAt(0).toUpperCase() + sentence.slice(1)}
    </p>
  );
}
