import type { QlooCallMeta } from "../qloo/client";
import type { RunEvent, TraceStep } from "./types";

/**
 * Records the agent's steps and attributes every Qloo call to the step that
 * made it. Steps run one at a time; work that overlaps them (the baseline
 * draft) is timed separately and recorded with `record`.
 */
export class Tracer {
  readonly steps: TraceStep[] = [];
  private current?: TraceStep;
  constructor(private readonly emit?: (e: RunEvent) => void) {}

  readonly onCall = (m: QlooCallMeta) => {
    this.current?.calls.push(m);
  };

  async step<T>(id: string, title: string, fn: (s: TraceStep) => Promise<T>, opts: { model?: string } = {}): Promise<T> {
    const s = this.open(id, title, opts.model);
    const t0 = Date.now();
    try {
      return await fn(s);
    } catch (err) {
      s.status = "error";
      s.detail = err instanceof Error ? err.message : String(err);
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
    this.current = s;
    this.emit?.({ type: "start", id, title });
    return s;
  }

  private close(s: TraceStep, ms: number) {
    s.ms = ms;
    if (this.current === s) this.current = undefined;
    this.steps.push(s);
    this.emit?.({ type: "step", step: s });
  }
}
