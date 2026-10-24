import { describe, expect, it } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { applyChoices } from "@/lib/agent/choose";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import type { Choice, Replacement } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

const rep = (from: string, options: string[]): Replacement => ({
  from,
  to: options[0] ?? "",
  type: "artist",
  role: "collab",
  reason: "r",
  options: options.map((name, i) => ({ name, type: "artist" as const, affinity: 0.9 - i / 10 })),
});

describe("applyChoices", () => {
  it("takes the model's choice when it is one of the options, and says why", () => {
    const { replacements, notes } = applyChoices([rep("Ed Sheeran", ["Victony", "Omah Lay", "Ckay"])], [{ from: "ed sheeran", to: "Omah Lay", why: "fits the late-night angle" }]);
    expect(replacements[0]?.to).toBe("Omah Lay");
    expect(notes[0]).toMatch(/model's choice from Victony, Omah Lay, Ckay: fits the late-night angle/);
  });

  it("refuses a name outside the options (no hallucination through a choice)", () => {
    const { replacements, notes } = applyChoices([rep("Ed Sheeran", ["Victony", "Omah Lay"])], [{ from: "Ed Sheeran", to: "Lagos Velvet Collective", why: "x" }]);
    expect(replacements[0]?.to).toBe("Victony");
    expect(notes[0]).toMatch(/wasn't one of/);
  });

  test.prop([
    fc.array(fc.uniqueArray(fc.constantFrom("A", "B", "C", "D", "E"), { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 4 }),
    fc.array(fc.record({ from: fc.constantFrom("f0", "f1", "f2", "f3"), to: fc.constantFrom("A", "B", "C", "D", "E", "Zz"), why: fc.constant("w") }), { maxLength: 6 }),
  ])("every final pick is one of its swap's options, and no two swaps take the same name", (optionSets, choices: Choice[]) => {
    const reps = optionSets.map((o, i) => rep(`f${i}`, o));
    const { replacements } = applyChoices(reps, choices);
    const tos = replacements.map((r) => r.to);
    expect(new Set(tos).size).toBe(tos.length);
    for (const r of replacements) expect(reps.find((x) => x.from === r.from)?.options?.map((o) => o.name)).toContain(r.to);
  });
});

describe("the model's choice in a run", () => {
  it("is traced, applied and kept within Qloo's options", async () => {
    class Chooser extends DeterministicLLM {
      override async choose(reps: Replacement[]): Promise<Choice[]> {
        return reps.map((r) => ({ from: r.from, to: r.options?.at(-1)?.name ?? r.to, why: "closer to the brief" }));
      }
    }
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new Chooser() });
    const step = r.trace.find((s) => s.id === "choose-1");
    expect(step?.detail).toMatch(/model's choice from .*closer to the brief/);
    expect(r.metrics.grounded.hallucinations).toBe(0);
  });

  it("keeps Qloo's top options when the model's choice call fails", async () => {
    class Broken extends DeterministicLLM {
      override choose(): Promise<Choice[]> {
        return Promise.reject(new Error("LLM 503"));
      }
    }
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new Broken() });
    expect(r.trace.find((s) => s.id === "choose-1")?.detail).toMatch(/model choice failed \(LLM 503\); Qloo's top options kept/);
  });
});
