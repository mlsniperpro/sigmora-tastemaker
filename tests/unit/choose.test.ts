import { describe, expect, it } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { MAX_OWN_IDEAS, applyChoices, ownProposals, withOwnIdeas } from "@/lib/agent/choose";
import type { Receipt } from "@/lib/agent/types";
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

const verdict = (name: string, v: Receipt["verdict"], affinity?: number): Receipt => ({ name, type: "artist", role: "collab", verdict: v, affinity, drivers: [], calls: [], note: "" });

describe("the model's own ideas", () => {
  const offered = [rep("Ed Sheeran", ["Victony", "Omah Lay"]), rep("Nickelback", ["Ckay"])];

  it("proposes only flagged, new, deduplicated names, one per swap, capped", () => {
    const choices: Choice[] = [
      { from: "Ed Sheeran", to: "Burna Boy", why: "w", own: true },
      { from: "Ed Sheeran", to: "Wizkid", why: "second idea for the same swap", own: true },
      { from: "Nickelback", to: "Tems", why: "already in the plan", own: true },
      { from: "Unknown Swap", to: "Rema", why: "no such swap", own: true },
    ];
    const p = ownProposals(offered, choices, new Set(["tems"]));
    expect(p).toEqual([{ from: "Ed Sheeran", pick: { name: "Burna Boy", type: "artist", role: "collab", rationale: "w" } }]);
    expect(ownProposals(offered, [{ from: "Ed Sheeran", to: "Victony", why: "listed option" }], new Set())).toEqual([]);
  });

  test.prop([fc.array(fc.record({ from: fc.constantFrom("Ed Sheeran", "Nickelback"), to: fc.string({ maxLength: 12 }), why: fc.constant("w"), own: fc.boolean() }), { maxLength: 8 })])(
    "never proposes more than the cap, an empty name, or two for one swap",
    (choices) => {
      const p = ownProposals(offered, choices, new Set());
      expect(p.length).toBeLessThanOrEqual(MAX_OWN_IDEAS);
      expect(new Set(p.map((x) => x.from)).size).toBe(p.length);
      for (const x of p) expect(x.pick.name.trim()).not.toBe("");
    },
  );

  it("uses an own idea only after Qloo passed it, and says what happened either way", () => {
    const choices: Choice[] = [
      { from: "Ed Sheeran", to: "Burna Boy", why: "global reach", own: true },
      { from: "Nickelback", to: "Lagos Velvet Collective", why: "invented", own: true },
    ];
    const proposals = ownProposals(offered, choices, new Set());
    const verdicts = [verdict("Burna Boy", "pass", 0.71), verdict("Lagos Velvet Collective", "hallucination")];
    const { replacements, notes } = applyChoices(withOwnIdeas(offered, proposals, verdicts), choices, verdicts);
    expect(replacements.map((r) => r.to)).toEqual(["Burna Boy", "Ckay"]);
    expect(notes[0]).toMatch(/the model's own idea, which passed Qloo's check \(affinity 0\.71\): global reach/);
    // On simulated data the same choice is told in words: no placeholder score, and the simulator is credited.
    const sim = applyChoices(withOwnIdeas(offered, proposals, verdicts), choices, verdicts, true);
    expect(sim.replacements.map((r) => r.to)).toEqual(["Burna Boy", "Ckay"]);
    expect(sim.notes[0]).toMatch(/the model's own idea, which passed the simulator's check: global reach/);
    expect(sim.notes.join(" ") + sim.replacements.map((r) => r.reason).join(" ")).not.toMatch(/affinity 0\.71|\(affinity/);
    expect(replacements[0]?.reason).toMatch(/proposed Burna Boy itself, and Qloo scored it above the bar/);
    expect(notes[1]).toMatch(/Qloo's top option: the model's own idea "Lagos Velvet Collective" came back hallucination/);
  });

  it("never uses an own idea Qloo scored below the bar or didn't score", () => {
    const choices: Choice[] = [{ from: "Ed Sheeran", to: "Coldplay", why: "w", own: true }];
    const proposals = ownProposals(offered, choices, new Set());
    for (const v of [[verdict("Coldplay", "miss", 0.1)], [verdict("Coldplay", "unscored")], []]) {
      expect(applyChoices(withOwnIdeas(offered, proposals, v), choices, v).replacements[0]?.to).toBe("Victony");
    }
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

  it("scores the model's own ideas with Qloo: an invented one is refused, a real one above the bar is used", async () => {
    class Inventive extends DeterministicLLM {
      override async choose(reps: Replacement[]): Promise<Choice[]> {
        return reps.map((r, i) => ({ from: r.from, to: i === 0 ? "Lagos Velvet Collective" : r.to, why: "my own idea", own: i === 0 }));
      }
    }
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new Inventive() });
    const step = r.trace.find((s) => s.id === "choose-1");
    expect(step?.detail).toMatch(/the model's own idea "Lagos Velvet Collective" came back hallucination/);
    expect(r.grounded.receipts.some((x) => x.name === "Lagos Velvet Collective")).toBe(false);
    // The scripted model's own "Telfar" passes the check and replaces the low-affinity sponsor, verified again by the next critic pass.
    // This run's data is simulated, so the trace credits the simulator, not Qloo, and prints none of its placeholder scores.
    const scripted = await runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });
    const chose = scripted.trace.find((s) => s.id === "choose-1")?.detail ?? "";
    expect(chose).toMatch(/→ Telfar \(the model's own idea, which passed the simulator's check: /);
    expect(chose).not.toMatch(/affinity|\d\.\d\d|Qloo's check/);
    expect(scripted.grounded.receipts.find((x) => x.name === "Telfar")?.verdict).toBe("pass");
  });

  it("keeps the critic's top options when the model's choice call fails, crediting the simulator on simulated data", async () => {
    class Broken extends DeterministicLLM {
      override choose(): Promise<Choice[]> {
        return Promise.reject(new Error("LLM 503"));
      }
    }
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new Broken() });
    expect(r.trace.find((s) => s.id === "choose-1")?.detail).toMatch(/model choice failed \(LLM 503\); the simulator's top options kept/);
  });
});
