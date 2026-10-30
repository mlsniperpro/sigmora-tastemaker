"use client";

import type { RunResult, Served } from "@/lib/agent/types";
import { endSentence } from "./useRun";

/**
 * Where this run's numbers came from, in one line: what was simulated, replayed or scripted (in bold), then
 * why and what that hides. Includes any live failure that forced a fallback. Nothing when every Qloo answer
 * was live and a real model drafted the plan. A run `served` from the simulator is the preset after live Qloo failed
 * (the deployment may well have a key), so it says that, with the reason, instead of blaming a missing key.
 */
export function SourceBanner({ result, served, className = "" }: { result: RunResult; served?: Served; className?: string }) {
  const q = result.qloo;
  const fellBack = q.fallbacks.length > 0;
  const offline = served?.from === "simulated";
  const simulated = !fellBack && (q.simulated > 0 || offline);
  const replayed = !fellBack && !simulated && q.replay > 0;
  const scripted = result.llm.scripted;
  if (!fellBack && !simulated && !replayed && !scripted) return null;

  const labels = [
    ...(fellBack ? [`Live Qloo failed for ${q.fallbackCalls} of ${q.calls} calls`] : []),
    ...(offline ? ["Live Qloo unavailable"] : []),
    ...(simulated ? ["Simulated Qloo data"] : []),
    ...(replayed ? ["Replayed Qloo responses"] : []),
    ...(scripted ? ["Scripted model"] : []),
  ];
  const keyless = offline ? "" : simulated && scripted ? "No Qloo or LLM key on this deployment: " : simulated ? "No Qloo key on this deployment: " : scripted && !fellBack && !replayed ? "No LLM key is set: " : "";
  const parts = [
    ...(fellBack ? [`those answers are recorded live responses, each labeled in the trace (${q.fallbacks.map((f) => f.reason).join("; ")})`] : []),
    ...(offline ? ["this is the preset on the offline simulator, with answers in Qloo's shapes (not Qloo data)"] : []),
    ...(simulated && !offline ? ["answers come from an offline simulator in Qloo's shapes (not Qloo data)"] : []),
    ...(replayed ? [`${q.replay} of ${q.calls} answers are recorded live hackathon API responses, served from fixtures`] : []),
    ...(scripted ? [simulated && !offline ? "drafts from a deterministic stand-in" : "drafts come from a deterministic stand-in, not a model"] : []),
  ];
  const hidden = simulated ? ", so numbers are not shown" : scripted ? ", so miss counts are not shown" : "";
  // Why the run fell back is a sentence of its own, so the main one reads straight through.
  const why = offline && served.reason ? ` Why: ${endSentence(served.reason)}` : "";
  const sentence = `${keyless}${parts.join(keyless ? " and " : "; ")}${hidden}.${why}`;
  return (
    <p role="note" className={`text-meta leading-snug text-muted ${className}`}>
      <strong className="font-semibold text-fade">{labels.join(" · ")}.</strong> {keyless ? sentence : sentence.charAt(0).toUpperCase() + sentence.slice(1)}
    </p>
  );
}
