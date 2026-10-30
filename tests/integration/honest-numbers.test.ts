/**
 * No real data, no numbers: on a simulated run the agent's own trace text names no affinity, score or
 * verdict count (structural counts stay), while a run on recorded Qloo responses keeps every number.
 */
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import type { RunResult } from "@/lib/agent/types";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { simulate } from "@/lib/qloo/sim/simulator";

/** A placeholder score or signed value as the trace would print it: "0.36", "+0.53". */
const SCORE = /\d\.\d\d|[+−-]\d/;

async function simulatedAndReplayed(): Promise<{ simulated: RunResult; replayed: RunResult }> {
  const sim = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
  const seen = new Map<string, unknown>();
  sim.observe((m) => seen.set(m.key, simulate(m.path, m.params)));
  const simulated = await runTastemaker(PRESETS[0].brief, { qloo: sim, llm: new DeterministicLLM() });
  // The same answers as recorded responses: the client labels them "replay", as it would recorded live data.
  const replay = new QlooClient({ cache: new MemoryCache(), fixtures: Object.fromEntries(seen) });
  const replayed = await runTastemaker(PRESETS[0].brief, { qloo: replay, llm: new DeterministicLLM() });
  return { simulated, replayed };
}

describe("trace details", () => {
  it("print no placeholder number on a simulated run, and every number on a replayed one", async () => {
    const { simulated, replayed } = await simulatedAndReplayed();
    expect(simulated.qloo.simulated).toBeGreaterThan(0);
    expect(replayed.qloo.simulated).toBe(0);
    expect(replayed.qloo.replay).toBe(replayed.qloo.calls);

    const detail = (r: RunResult, id: string) => r.trace.find((s) => s.id === id)?.detail ?? "";
    for (const s of simulated.trace) expect(s.detail, `${s.id}: ${s.detail}`).not.toMatch(SCORE);
    for (const id of ["critic-1", "critic-2", "audit"]) {
      expect(detail(simulated, id)).toMatch(/^\d+ picks checked by the offline simulator \(verdict counts hidden: simulated data\)/);
      expect(detail(simulated, id)).not.toMatch(/invented|low-affinity|fading/);
    }
    expect(detail(simulated, "demographics")).toMatch(/^Strongest age over-index: \d\d to \d\d, mean of 3 seed rows$/);
    expect(detail(simulated, "cities")).toMatch(/^[A-Z][^0-9]+ › .* · ranked by heatmap · \d+ heatmap cells/);
    // Structural counts stay: picks drafted, heatmap cells, trend readings.
    expect(detail(simulated, "generate")).toMatch(/^\d+ cultural picks, \d+ hooks, \d+ captions$/);
    expect(detail(simulated, "trending")).toMatch(/^\d+ trend readings of \d+ checked/);
    expect(detail(simulated, "choose-1")).toMatch(/the simulator's check/);

    expect(detail(replayed, "demographics")).toMatch(/\([+-]?\d\.\d\d\)/);
    expect(detail(replayed, "cities")).toMatch(/\d\.\d\d › /);
    expect(detail(replayed, "critic-1")).toMatch(/\d+ picks · \d+ invented · \d+ low-affinity · \d+ fading/);
    expect(detail(replayed, "choose-1")).toMatch(/Qloo's check \(affinity \d\.\d\d\)/);
    // Same plan either way: only the wording changes.
    expect(replayed.grounded.receipts.map((r) => [r.name, r.verdict])).toEqual(simulated.grounded.receipts.map((r) => [r.name, r.verdict]));
  });
});
