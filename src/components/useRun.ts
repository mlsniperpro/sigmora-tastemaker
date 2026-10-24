"use client";

import { useCallback, useRef, useState } from "react";
import type { BriefInput, RunRequest } from "@/lib/agent/brief";
import type { RunEvent, RunResult, Served, TraceStep } from "@/lib/agent/types";
import { NdjsonParser } from "@/lib/ndjson";
import { encodeBrief } from "@/lib/permalink";

/** Point the address bar at what's on screen: the request while it runs, then the finished run itself. */
function setUrl(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, "", url);
}

/** Streams a run from /api/run (or loads a finished one) and keeps the URL as a permalink to it. */
export function useRun() {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [result, setResult] = useState<RunResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  /** The step in progress, shown in the trace while it runs. */
  const [pending, setPending] = useState<string>();
  /** Set when the result is an earlier run (its trace is a replay), with where it came from. */
  const [served, setServed] = useState<Served>();
  const abort = useRef<AbortController | null>(null);

  /** Starts a new request: cancels the previous one and clears the screen. */
  const begin = useCallback(() => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setSteps([]);
    setPending(undefined);
    setServed(undefined);
    setResult(undefined);
    setError(undefined);
    setRunning(true);
    return ctrl;
  }, []);
  const end = useCallback((ctrl: AbortController) => {
    if (abort.current !== ctrl) return;
    setRunning(false);
    setPending(undefined);
  }, []);
  const show = useCallback((r: RunResult, from?: Served) => {
    setServed(from);
    // A served run's trace replaces any partial live steps (e.g. a live run that failed over to a recording).
    if (from) setSteps(r.trace);
    setResult(r);
    setUrl(`?run=${r.id}`);
  }, []);

  const run = useCallback(
    async (req: RunRequest) => {
      const ctrl = begin();
      setUrl("preset" in req ? `?preset=${encodeURIComponent(req.preset)}` : `?b=${encodeBrief(req.brief)}`);
      const state = { finished: false };
      const apply = (ev: RunEvent) => {
        if (ev.type === "start") setPending(ev.title);
        else if (ev.type === "step") {
          setPending(undefined);
          setSteps((s) => [...s, ev.step]);
        } else if (ev.type === "result") {
          state.finished = true;
          show(ev.result, ev.served);
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
        end(ctrl);
      }
    },
    [begin, end, show],
  );

  /** Opens a finished run by id (a `?run=` permalink). */
  const open = useCallback(
    async (id: string) => {
      const ctrl = begin();
      try {
        const res = await fetch(`/api/run?id=${encodeURIComponent(id)}`, { signal: ctrl.signal });
        const body = (await res.json().catch(() => ({}))) as { result?: RunResult; error?: string };
        if (!res.ok || !body.result) throw new Error(body.error ?? `Couldn't open that run (${res.status})`);
        show(body.result, { from: "cache" });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(`${(err as Error).message} Pick a preset to run it again.`);
      } finally {
        end(ctrl);
      }
    },
    [begin, end, show],
  );

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

  return { steps, pending, served, result, error, running, run, open, requery };
}
