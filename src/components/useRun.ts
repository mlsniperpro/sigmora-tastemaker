"use client";

import { useCallback, useRef, useState } from "react";
import type { BriefInput } from "@/lib/agent/brief";
import type { RunEvent, RunResult, TraceStep } from "@/lib/agent/types";
import { NdjsonParser } from "@/lib/ndjson";
import { encodeBrief } from "@/lib/permalink";

export type RunRequest = { preset: string } | { brief: BriefInput };

/** Streams a run from /api/run and keeps the URL as a permalink to it. */
export function useRun() {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [result, setResult] = useState<RunResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (req: RunRequest) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setSteps([]);
    setResult(undefined);
    setError(undefined);
    setRunning(true);
    const url = new URL(window.location.href);
    url.search = "preset" in req ? `?preset=${encodeURIComponent(req.preset)}` : `?b=${encodeBrief(req.brief)}`;
    window.history.replaceState(null, "", url);

    let finished = false;
    const apply = (ev: RunEvent) => {
      if (ev.type === "step") setSteps((s) => [...s, ev.step]);
      else if (ev.type === "result") {
        finished = true;
        setResult(ev.result);
      } else {
        finished = true;
        setError(ev.message);
      }
    };
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Run failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const parser = new NdjsonParser<RunEvent>();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(dec.decode(value, { stream: true })).forEach(apply);
      }
      parser.end().forEach(apply);
      if (!finished) setError("The run was cut off before it finished. Try again; finished runs are cached and load instantly.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctrl) setRunning(false);
    }
  }, []);

  return { steps, result, error, running, run };
}
