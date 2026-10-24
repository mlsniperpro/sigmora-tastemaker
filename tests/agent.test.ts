import { describe, expect, it } from "vitest";
import { runTastemaker, signalAges } from "@/lib/agent/run";
import { PRESETS } from "@/lib/agent/presets";
import { sameName } from "@/lib/agent/util";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import type { RunEvent } from "@/lib/agent/types";

const deps = () => ({ qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });

describe("agent loop (zero credentials)", () => {
  for (const preset of PRESETS) {
    it(`${preset.id}: grounded plan beats the baseline and every pick has a receipt`, async () => {
      const r = await runTastemaker(preset.brief, deps());
      expect(r.grounded.receipts.length).toBe(r.grounded.draft.picks.length);
      expect(r.metrics.grounded.cultureMissRate).toBeLessThan(r.metrics.baseline.cultureMissRate);
      expect(r.metrics.grounded.hallucinations).toBe(0);
      for (const rec of r.grounded.receipts.filter((x) => x.verdict !== "hallucination")) {
        expect(rec.calls.length).toBeGreaterThan(0);
        expect(rec.affinity).toBeTypeOf("number");
      }
      expect(r.sources).toEqual(["simulated"]);
    });
  }

  it("catches invented entities in the baseline", async () => {
    const r = await runTastemaker(PRESETS[0].brief, deps());
    const invented = r.baseline.receipts.filter((x) => x.verdict === "hallucination").map((x) => x.name);
    expect(invented).toContain("Lagos Velvet Collective");
  });

  it("replaces a low-affinity pick and keeps the receipt chain", async () => {
    const r = await runTastemaker(PRESETS[0].brief, deps());
    const replaced = r.grounded.receipts.find((x) => x.replaced);
    expect(replaced?.replaced?.name).toBe("Coors Light");
    expect(replaced?.verdict).toBe("pass");
    expect(r.grounded.rounds).toBeGreaterThan(1);
    // the replaced name is gone from every text field
    const { picks, ...text } = r.grounded.draft;
    expect(JSON.stringify(text)).not.toContain("Coors Light");
    expect(picks.map((p) => p.name)).not.toContain("Coors Light");
  });

  it("uses every Qloo surface the trace promises", async () => {
    const r = await runTastemaker(PRESETS[0].brief, deps());
    const keys = r.trace.flatMap((s) => s.calls.map((c) => c.key));
    for (const needle of [
      "/search?",
      "filter.type=urn%3Ademographics",
      "filter.type=urn%3Atag",
      "filter.type=urn%3Aheatmap",
      "output.heatmap.boundary=urn%3Aentity%3Alocality",
      "/v2/trending?",
      "/v2/analysis/compare?",
      "feature.explainability=true",
      "filter.results.entities=",
      "filter.location.query=",
    ]) {
      expect(keys.some((k) => k.includes(needle)), needle).toBe(true);
    }
  });

  it("streams one step event per trace step, then the result", async () => {
    const events: RunEvent[] = [];
    const r = await runTastemaker(PRESETS[2].brief, { ...deps(), emit: (e) => events.push(e) });
    expect(events.filter((e) => e.type === "step")).toHaveLength(r.trace.length);
    expect(events.at(-1)?.type).toBe("result");
  });

  it("is deterministic for the same brief", async () => {
    const a = await runTastemaker(PRESETS[1].brief, deps());
    const b = await runTastemaker(PRESETS[1].brief, deps());
    expect(a.id).toBe(b.id);
    expect(a.grounded.draft).toEqual(b.grounded.draft);
  });

  it("rejects a brief whose seeds don't resolve", async () => {
    await expect(runTastemaker({ ...PRESETS[0].brief, seeds: ["Zzqx Nonexistent"] }, deps())).rejects.toThrow(/resolve/);
  });
});

describe("helpers", () => {
  it("maps fine age buckets to signal buckets", () => {
    expect(signalAges(["25_to_29", "30_to_34", "35_to_44"])).toEqual(["35_and_younger", "36_to_55"]);
  });
  it("matches names without accepting fuzzy search noise", () => {
    expect(sameName("Arsenal F.C.", "Arsenal")).toBe(true);
    expect(sameName("SOB's", "SOBs")).toBe(true);
    expect(sameName("Lagos Velvet Collective", "Lagos")).toBe(false);
    expect(sameName("The Joe Rogan Experience", "Joe Rogan Experience")).toBe(true);
  });
});
