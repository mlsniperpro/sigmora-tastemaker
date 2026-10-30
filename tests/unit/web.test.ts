import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { affinityWeb } from "@/lib/agent/web";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

describe("affinityWeb", () => {
  it("links seeds to the picks they drove, across domains, from explainability only", async () => {
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });
    const web = affinityWeb(r);
    expect(web.inputs).toEqual(["Tems", "Rema", "Asake"]);
    expect(new Set(web.picks.map((p) => p.type)).size).toBeGreaterThanOrEqual(4);
    for (const e of web.edges) {
      const pick = r.grounded.receipts.find((x) => x.name === web.picks[e.pick]?.name);
      expect(pick?.drivers.find((d) => d.name === web.inputs[e.input])?.score).toBe(e.weight);
    }
    // more than a star: several inputs each drive more than one pick
    expect(new Set(web.edges.map((e) => e.input)).size).toBeGreaterThan(1);
  });

  it("leaves out unscored picks and drivers that aren't seeds", () => {
    const base = { type: "artist" as const, role: "collab" as const, calls: [], note: "" };
    const web = affinityWeb({
      seeds: [{ name: "Tems", entityId: "t" }, { name: "Unresolved" }],
      grounded: {
        rounds: 1,
        draft: { positioning: "", hooks: [], script: "", captions: [], musicBrief: "", picks: [] },
        receipts: [
          { ...base, name: "A", verdict: "pass", affinity: 0.8, drivers: [{ name: "Tems", score: 0.4 }, { name: "signal", score: 0.2 }] },
          { ...base, name: "B", verdict: "unscored", drivers: [{ name: "Tems", score: 0.3 }] },
        ],
      },
    });
    expect(web.inputs).toEqual(["Tems"]);
    expect(web.picks.map((p) => p.name)).toEqual(["A"]);
    expect(web.edges).toEqual([{ input: 0, pick: 0, weight: 0.4 }]);
  });
});
