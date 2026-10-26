"use client";

import { useCallback, useReducer, useRef } from "react";
import type { BriefInput, RunRequest } from "@/lib/agent/brief";
import type { RunEvent, RunResult, Served, TraceStep } from "@/lib/agent/types";
import { NdjsonParser } from "@/lib/ndjson";

/** `text` as a sentence of its own: ends with terminal punctuation, so more can follow it. */
export function endSentence(text: string): string {
  const t = text.trimEnd();
  return /[.!?]["')\]]*$/.test(t) ? t : `${t}.`;
}

/** How a finished run was served, as the server reported it for a permalink; a missing or malformed answer reads as the cache. */
export function parseServed(v: unknown): Served {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  if (o.from !== "cache" && o.from !== "recording" && o.from !== "simulated") return { from: "cache" };
  return typeof o.reason === "string" ? { from: o.from, reason: o.reason } : { from: o.from };
}

/** Point the address bar at what's on screen: the finished run. */
function setUrl(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, "", url);
}

/**
 * What the hook shows. `result`, `steps` and `served` are the run on screen; `draft` is the run in progress, kept
 * apart so a refused or failed request never clears what is already shown (it only becomes the screen on success).
 */
export type RunState = {
  steps: TraceStep[];
  result?: RunResult;
  /** Set when the result is an earlier run (its trace is a replay), with where it came from. */
  served?: Served;
  error?: string;
  running: boolean;
  draft: {
    steps: TraceStep[];
    /** Steps started but not finished, in start order (several run in parallel). */
    inFlight: { id: string; title: string }[];
  };
};

export type RunAction = { type: "begin" } | { type: "event"; event: RunEvent } | { type: "fail"; message: string } | { type: "clearError" } | { type: "end" };

const emptyDraft: RunState["draft"] = { steps: [], inFlight: [] };
export const initialRunState: RunState = { steps: [], running: false, draft: emptyDraft };

export function runReducer(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case "begin":
      return { ...s, error: undefined, running: true, draft: emptyDraft };
    case "end":
      return { ...s, running: false, draft: emptyDraft };
    case "clearError":
      return { ...s, error: undefined };
    case "fail":
      // The result on screen stays; with none, the steps so far stay in the trace to show how far the run got.
      return { ...s, error: a.message, steps: s.result ? s.steps : s.draft.steps, draft: emptyDraft };
    case "event": {
      const ev = a.event;
      if (ev.type === "start") return { ...s, draft: { ...s.draft, inFlight: [...s.draft.inFlight, { id: ev.id, title: ev.title }] } };
      if (ev.type === "step") return { ...s, draft: { steps: [...s.draft.steps, ev.step], inFlight: s.draft.inFlight.filter((x) => x.id !== ev.step.id) } };
      if (ev.type === "error") return runReducer(s, { type: "fail", message: ev.message });
      // A served run's trace replaces any partial live steps (e.g. a live run that failed over to a recording).
      return { ...s, result: ev.result, served: ev.served, steps: ev.served ? ev.result.trace : s.draft.steps, error: undefined, draft: emptyDraft };
    }
  }
}

/** The trace follows the request in progress: nothing is on screen yet, or the new run has started streaming steps. */
export function followsDraft(s: RunState): boolean {
  return s.running && (!s.result || s.draft.steps.length > 0 || s.draft.inFlight.length > 0);
}

export type RunOutcome = "ok" | "failed" | "aborted";

/** Runs a request against /api/run, reporting each event to `dispatch`; says how it ended. */
export async function streamRun(req: RunRequest, signal: AbortSignal, dispatch: (a: RunAction) => void): Promise<RunOutcome> {
  let outcome: RunOutcome | undefined;
  const apply = (event: RunEvent) => {
    if (event.type === "result") outcome = "ok";
    else if (event.type === "error") outcome = "failed";
    dispatch({ type: "event", event });
  };
  try {
    const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal });
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
    if (!outcome) {
      outcome = "failed";
      dispatch({ type: "fail", message: "The run was cut off before it finished. Try again; finished runs are cached and load instantly." });
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return "aborted";
    dispatch({ type: "fail", message: (err as Error).message });
    return "failed";
  }
  return outcome;
}

/** Streams a run from /api/run (or loads a finished one) and keeps the URL as a permalink to the run on screen. */
export function useRun() {
  const [state, dispatch] = useReducer(runReducer, initialRunState);
  const abort = useRef<AbortController | null>(null);

  /** Starts a new request: cancels the previous one. What is on screen stays until the new run has a result. */
  const begin = useCallback(() => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    dispatch({ type: "begin" });
    return ctrl;
  }, []);
  const end = useCallback((ctrl: AbortController) => {
    if (abort.current !== ctrl) return;
    dispatch({ type: "end" });
  }, []);
  // The address bar only changes once a run has produced its result, so a refused or failed request leaves it alone.
  const send = useCallback((a: RunAction) => {
    dispatch(a);
    if (a.type === "event" && a.event.type === "result") setUrl(`?run=${a.event.result.id}`);
  }, []);

  const run = useCallback(
    async (req: RunRequest): Promise<RunOutcome> => {
      const ctrl = begin();
      try {
        return await streamRun(req, ctrl.signal, send);
      } finally {
        end(ctrl);
      }
    },
    [begin, end, send],
  );

  /**
   * Opens a finished run by id (a `?run=` permalink), and says how it went so the caller can decide what to show instead:
   * "gone" = the server has no such run (expired or never existed), "failed" = it couldn't be asked,
   * "aborted" = something newer took over the screen.
   */
  const open = useCallback(
    async (id: string): Promise<"ok" | "gone" | "failed" | "aborted"> => {
      const ctrl = begin();
      try {
        const res = await fetch(`/api/run?id=${encodeURIComponent(id)}`, { signal: ctrl.signal });
        const body = (await res.json().catch(() => ({}))) as { result?: RunResult; served?: unknown; error?: string };
        if (!res.ok || !body.result) {
          // Only a not-found answer means the link is dead; anything else is a failure to ask.
          if (res.status === 404) return "gone";
          throw new Error(body.error ?? `Couldn't open that run (${res.status})`);
        }
        send({ type: "event", event: { type: "result", result: body.result, served: parseServed(body.served) } });
        return "ok";
      } catch (err) {
        if ((err as Error).name === "AbortError") return "aborted";
        dispatch({ type: "fail", message: `${(err as Error).message} Pick a preset to run it again.` });
        return "failed";
      } finally {
        end(ctrl);
      }
    },
    [begin, end, send],
  );

  /** Measure a shipped campaign; on success, run the brief seeded with what performed. */
  const requery = useCallback(
    async (campaignId: string): Promise<RunOutcome> => {
      dispatch({ type: "clearError" });
      try {
        const res = await fetch("/api/requery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId }) });
        const body = (await res.json().catch(() => ({}))) as { brief?: BriefInput; error?: string };
        if (!res.ok || !body.brief) throw new Error(body.error ?? `Measuring failed (${res.status})`);
        return await run({ brief: body.brief });
      } catch (err) {
        dispatch({ type: "fail", message: err instanceof Error ? err.message : String(err) });
        return "failed";
      }
    },
    [run],
  );

  const live = followsDraft(state);
  return {
    steps: live ? state.draft.steps : state.steps,
    pending: live ? state.draft.inFlight.map((r) => r.title) : [],
    /** The trace is following a new run rather than the result on screen. */
    live,
    served: state.served,
    result: state.result,
    error: state.error,
    running: state.running,
    run,
    open,
    requery,
  };
}
