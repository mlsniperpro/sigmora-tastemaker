import { AsyncLocalStorage } from "node:async_hooks";
import type { QlooCallMeta } from "../qloo/client";
import type { RunEvent, TraceStep } from "./types";
import { publicErrorText } from "../net";

/**
 * Records the agent's steps and attributes every Qloo call to the step that
 * made it. Steps may run concurrently: each runs in its own async context, so
 * a call is credited to the step whose code made it. Work outside any step
 * (the baseline draft) is timed separately and recorded with `record`.
 */
export class Tracer {
  readonly steps: TraceStep[] = [];
  private readonly current = new AsyncLocalStorage<TraceStep>();
  constructor(private readonly emit?: (e: RunEvent) => void) {}

  readonly onCall = (m: QlooCallMeta) => {
    this.current.getStore()?.calls.push(m);
  };

  async step<T>(id: string, title: string, fn: (s: TraceStep) => Promise<T>, opts: { model?: string } = {}): Promise<T> {
    const s = this.open(id, title, opts.model);
    const t0 = Date.now();
    try {
      return await this.current.run(s, () => fn(s));
    } catch (err) {
      s.status = "error";
      s.detail = publicErrorText(err);
      throw err;
    } finally {
      this.close(s, Date.now() - t0);
    }
  }

  /** Like `step`, but a failure is recorded on the step and the run carries on. */
  async optional<T>(id: string, title: string, fn: (s: TraceStep) => Promise<T>): Promise<T | undefined> {
    try {
      return await this.step(id, title, fn);
    } catch {
      return undefined;
    }
  }

  record(step: Omit<TraceStep, "calls"> & { calls?: QlooCallMeta[] }) {
    this.close({ calls: [], ...step }, step.ms);
  }

  private open(id: string, title: string, model?: string): TraceStep {
    const s: TraceStep = { id, title, detail: "", status: "done", ms: 0, calls: [], model };
    this.emit?.({ type: "start", id, title });
    return s;
  }

  private close(s: TraceStep, ms: number) {
    s.ms = ms;
    this.steps.push(s);
    this.emit?.({ type: "step", step: s });
  }
}
