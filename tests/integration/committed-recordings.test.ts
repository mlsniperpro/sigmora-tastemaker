/**
 * The committed recordings themselves (fixtures/*\/recorded.json), read from disk.
 * The other suites run with recordings off (tests/setup.ts), so this is the one
 * place a malformed or stale recording fails CI instead of being silently
 * dropped (or failing) on the live demo. Empty stores pass: nothing is served.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordedSampleAudit } from "@/lib/agent/audit";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { isHealthy, recordedRuns } from "@/lib/agent/runCache";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

const committed = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "fixtures", name, "recorded.json"), "utf8")) as Record<string, unknown>;
const PATHS = ["/search", "/entities", "/v2/insights", "/v2/trending", "/v2/tags", "/v2/analysis/compare"];

describe("committed recordings", () => {
  it("runs: one per preset, each current-schema, healthy, live, and of the preset's current brief", () => {
    const store = committed("runs");
    const presetIds = PRESETS.map((p) => p.id);
    for (const key of Object.keys(store)) expect(presetIds).toContain(key);
    const runs = recordedRuns(store);
    expect([...runs.keys()].sort()).toEqual(Object.keys(store).sort());
    for (const [preset, run] of runs) {
      const brief = Brief.parse(PRESETS.find((p) => p.id === preset)?.brief);
      expect({ preset, healthy: isHealthy(run), sources: run.sources, brief: run.brief }).toEqual({ preset, healthy: true, sources: ["live"], brief });
    }
  });

  it("audits: only the sample, and it loads", () => {
    const store = committed("audits");
    for (const key of Object.keys(store)) expect(key).toBe("sample");
    if ("sample" in store) expect(recordedSampleAudit(store)).toBeDefined();
  });

  it("qloo: every fixture is a recorded answer to a known endpoint, and every preset replays from them without a schema error", async () => {
    const store = committed("qloo");
    for (const [key, value] of Object.entries(store)) {
      expect(PATHS).toContain(key.split("?")[0]);
      expect(typeof value === "object" && value !== null).toBe(true);
    }
    if (!Object.keys(store).length) return;
    for (const preset of PRESETS) {
      const qloo = new QlooClient({ cache: new MemoryCache(), fixtures: store });
      const run = await runTastemaker(preset.brief, { qloo, llm: new DeterministicLLM(), newId: () => `replay-${preset.id}` });
      const failed = run.trace.filter((s) => s.status !== "done").map((s) => `${s.id}: ${s.status} ${s.detail}`);
      expect({ preset: preset.id, failed }).toEqual({ preset: preset.id, failed: [] });
    }
  }, 60_000);
});
