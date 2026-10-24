"use client";

import { useCallback, useRef, useState } from "react";
import type { RunEvent, RunResult, TraceStep } from "@/lib/agent/types";
import { NdjsonParser } from "@/lib/ndjson";
import type { BriefInput, RunRequest } from "@/lib/agent/brief";
import { encodeBrief } from "@/lib/permalink";

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

    const state = { finished: false };
    const apply = (ev: RunEvent) => {
      if (ev.type === "step") setSteps((s) => [...s, ev.step]);
      else if (ev.type === "result") {
        state.finished = true;
        setResult(ev.result);
      } else {
        state.finished = true;
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
      if (!state.finished) setError("The run was cut off before it finished. Try again; finished runs are cached and load instantly.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctrl) setRunning(false);
    }
  }, []);

  /** Measure a shipped campaign; on success, run the brief seeded with what performed. */
  const requery = useCallback(
    async (campaignId: string) => {
      setError(undefined);
      try {
        const res = await fetch("/api/requery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId }) });
        const body = (await res.json().catch(() => ({}))) as { brief?: BriefInput; error?: string };
        if (!res.ok || !body.brief) throw new Error(body.error ?? `Measuring failed (${res.status})`);
        await run({ brief: body.brief });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [run],
  );

  return { steps, result, error, running, run, requery };
}
