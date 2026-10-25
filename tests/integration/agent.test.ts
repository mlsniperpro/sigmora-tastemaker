/** The agent loop end to end over the offline Qloo client, plus its failure paths. */
import { describe, expect, it } from "vitest";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { RunDeadlineError, qlooHealth, runTastemaker } from "@/lib/agent/run";
import { tasteCheck } from "@/lib/agent/tasteCheck";
import type { RunEvent } from "@/lib/agent/types";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import type { Choice, Draft, DraftInput } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooBudgetError } from "@/lib/qloo/errors";
import { QlooClient } from "@/lib/qloo/client";
import { receiptNote } from "@/components/Receipt";
import { must } from "../must";

const qloo = () => new QlooClient({ cache: new MemoryCache(), fixtures: {} });
const deps = () => ({ qloo: qloo(), llm: new DeterministicLLM() });

/** A model that ignores revise instructions and resubmits its first draft, rejected picks and all. */
class StubbornLLM extends DeterministicLLM {
  override async revise(_draft: Draft, _reps?: unknown, input?: DraftInput): Promise<Draft> {
    return this.draft(must(input, "draft input"));
  }
}
/** A model whose rewrite call always fails. */
class BrokenReviseLLM extends DeterministicLLM {
  override async revise(): Promise<Draft> {
    throw new Error("LLM 503 on /chat/completions");
  }
}
/** A model that names the brief's fixed market as a city pick (what real models do). */
class CityNamingLLM extends DeterministicLLM {
  override async draft(input: DraftInput): Promise<Draft> {
    const d = await super.draft(input);
    return { ...d, picks: [...d.picks, { name: input.brief.targetCity ?? "Atlanta", type: "locality", role: "city", rationale: "" }] };
  }
}
/** A model that launches in the #2 metro (Houston) with a Houston venue. */
class SecondCityLLM extends DeterministicLLM {
  override async draft(input: DraftInput): Promise<Draft> {
    const d = await super.draft(input);
    const picks = d.picks.map((p) =>
      p.role === "city" ? { ...p, name: "Houston" } : p.role === "venue" ? { ...p, name: "House of Blues Houston", type: "place" as const } : p,
    );
    return { ...d, picks };
  }
}
/** A model whose ungrounded (baseline) draft fails. */
class BaselineFailsLLM extends DeterministicLLM {
  override async draft(input: DraftInput): Promise<Draft> {
    if (!input.grounding) throw new Error("LLM 529 overloaded");
    return super.draft(input);
  }
}
class FailingLLM extends DeterministicLLM {
  override async draft(): Promise<Draft> {
    throw new Error("LLM 401 on /v1/messages");
  }
}
/** Qloo whose compare and trending endpoints are down. */
class PartialQloo extends QlooClient {
  override compare(): never {
    throw new Error("Qloo 500 on /v2/analysis/compare");
  }
  override trending(): never {
    throw new Error("Qloo 500 on /v2/trending");
  }
}

/** Runs out of Qloo budget once the plan is drafted, as a run full of invented names would. */
const spent = { after: false };
class SpentQloo extends QlooClient {
  override insights(...args: Parameters<QlooClient["insights"]>) {
    return spent.after ? Promise.reject(new QlooBudgetError("run", 90)) : super.insights(...args);
  }
  override search(...args: Parameters<QlooClient["search"]>) {
    return spent.after ? Promise.reject(new QlooBudgetError("run", 90)) : super.search(...args);
  }
}
class DraftThenSpend extends DeterministicLLM {
  override async draft(input: DraftInput): Promise<Draft> {
    const d = await super.draft(input);
    if (input.grounding) spent.after = true;
    return d;
  }
}

describe("agent loop (zero credentials)", () => {
  for (const preset of PRESETS) {
    it(`${preset.id}: grounded plan beats the baseline and every pick has a receipt`, async () => {
      const r = await runTastemaker(preset.brief, deps());
      expect(r.grounded.receipts.length).toBe(r.grounded.draft.picks.length);
      expect(must(r.metrics.grounded.cultureMissRate, "grounded rate")).toBeLessThan(must(r.metrics.baseline.cultureMissRate, "baseline rate"));
      expect(r.metrics.grounded.hallucinations).toBe(0);
      for (const rec of r.grounded.receipts) {
        expect(rec.calls.length).toBeGreaterThan(0);
        expect(rec.affinity).toBeTypeOf("number");
      }
      expect(r.sources).toEqual(["simulated"]);
      expect(r.qloo).toMatchObject({ simulated: r.qloo.calls, fallbacks: [] });
      expect(r.trace.every((s) => s.status === "done")).toBe(true);
    });
  }

  it("catches invented entities in the baseline", async () => {
    const r = await runTastemaker(PRESETS[0].brief, deps());
    expect(r.baseline.receipts.filter((x) => x.verdict === "hallucination").map((x) => x.name)).toContain("Lagos Velvet Collective");
  });

  it("replaces a low-affinity pick and keeps the receipt chain", async () => {
    const r = await runTastemaker(PRESETS[0].brief, deps());
    const replaced = r.grounded.receipts.find((x) => x.replaced);
    expect(replaced?.replaced?.name).toBe("Coors Light");
    expect(replaced?.verdict).toBe("pass");
    expect(r.grounded.rounds).toBeGreaterThan(1);
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
      "filter.location=POLYGON",
      "filter.type=urn%3Aentity%3Alocality",
      "/v2/trending?",
      "/v2/analysis/compare?",
      "feature.explainability=true",
      "filter.results.entities=",
      "filter.location.query=",
      "/v2/tags?",
      "signal.interests.tags=",
    ]) {
      expect(keys.some((k) => k.includes(needle)), needle).toBe(true);
    }
    expect(keys.some((k) => k.includes("output.heatmap.boundary")), "boundary is broken on the live host").toBe(false);
    expect(keys.filter((k) => k.includes("filter.type=urn%3Aentity%3Aperson")).every((k) => !k.includes("signal.demographics")), "no demographics on person").toBe(true);
  });

  it("streams one step event per trace step, then the result", async () => {
    const events: RunEvent[] = [];
    const r = await runTastemaker(must(PRESETS[2]).brief, { ...deps(), emit: (e) => events.push(e) });
    expect(events.filter((e) => e.type === "step")).toHaveLength(r.trace.length);
    expect(events.at(-1)?.type).toBe("result");
  });

  it("is deterministic for the same brief, but every run gets its own id", async () => {
    const a = await runTastemaker(must(PRESETS[1]).brief, deps());
    const b = await runTastemaker(must(PRESETS[1]).brief, deps());
    expect(a.grounded).toEqual(b.grounded);
    expect(a.baseline).toEqual(b.baseline);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("skips the model rewrite once the time budget is spent, keeping the swaps", async () => {
    const r = await runTastemaker(PRESETS[0].brief, { ...deps(), reviseDeadlineMs: -1 });
    expect(r.trace.find((s) => s.id === "revise-1")?.detail).toMatch(/time budget reached; copy not re-polished/);
    expect(r.grounded.draft.picks.map((p) => p.name)).not.toContain("Coors Light");
  });
});

describe("agent loop: failure paths", () => {
  it("rejects a brief whose seeds don't resolve, with a typed error", async () => {
    await expect(runTastemaker({ ...PRESETS[0].brief, seeds: ["Zzqx Nonexistent"], seedLinks: [] }, deps())).rejects.toMatchObject({ name: "NoSeedError" });
  });

  it("rejects an invalid brief before any call: no seed name and no link", async () => {
    await expect(runTastemaker({ ...PRESETS[0].brief, seeds: [], seedLinks: [] }, deps())).rejects.toThrow(/at least one name/);
  });

  it("seeds from a Spotify link alone, through /entities", async () => {
    const r = await runTastemaker({ ...PRESETS[0].brief, seeds: [] }, deps());
    expect(r.seeds.map((s) => s.name)).toEqual(["Tems"]);
    expect(r.trace.find((s) => s.id === "resolve")?.calls.some((c) => c.path === "/entities")).toBe(true);
  });

  it("doesn't double-count a seed given as both a link and a name", async () => {
    const r = await runTastemaker(PRESETS[0].brief, deps());
    expect(r.seeds.map((s) => s.name)).toEqual(["Tems", "Rema", "Asake"]);
  });

  it("keeps verified swaps even when the model reverts them, and never offers the same swap twice", async () => {
    const r = await runTastemaker(PRESETS[0].brief, { qloo: qloo(), llm: new StubbornLLM() });
    expect(r.grounded.draft.picks.map((p) => p.name)).not.toContain("Coors Light");
    const d = r.grounded.draft;
    expect(JSON.stringify([d.positioning, d.hooks, d.script, d.captions, d.musicBrief])).not.toMatch(/Coors Light/);
    const swaps = r.trace.filter((s) => s.id.startsWith("revise-")).flatMap((s) => s.detail.split("; "));
    expect(new Set(swaps).size).toBe(swaps.length);
    expect(r.metrics.grounded.cultureMissRate).toBe(0);
  });

  it("keeps the swaps when the copy polish fails, and says so in the trace", async () => {
    const r = await runTastemaker(PRESETS[0].brief, { qloo: qloo(), llm: new BrokenReviseLLM() });
    const revise = r.trace.find((s) => s.id === "revise-1");
    expect(revise?.detail).toMatch(/LLM polish failed \(LLM 503/);
    expect(r.grounded.draft.picks.map((p) => p.name)).not.toContain("Coors Light");
  });

  it("passes a city pick that matches the brief's fixed market (and misses another)", async () => {
    const r = await runTastemaker(must(PRESETS[1]).brief, { qloo: qloo(), llm: new CityNamingLLM() });
    expect(r.grounded.receipts.find((x) => x.role === "city")).toMatchObject({ name: "Atlanta", verdict: "pass" });
    const other = await tasteCheck({ seeds: ["Glossier"], ages: ["25_to_29"], city: "Atlanta", picks: [{ name: "Madison Square Garden", type: "place", role: "venue" }] }, { qloo: qloo() });
    expect(other.receipts[0]?.verdict).toBe("miss");
    expect(other.receipts[0]?.note).toMatch(/Not in Atlanta/);
  });

  it("credits every Qloo call to the step that made it, with steps running in parallel", async () => {
    /** Live-mode client whose stubbed network answers after a random delay, so parallel steps interleave. */
    const fetchImpl = async (url: URL) => {
      await new Promise((r) => setTimeout(r, Math.random() * 15));
      const { simulate } = await import("@/lib/qloo/sim/simulator");
      return Response.json(simulate(url.pathname as never, Object.fromEntries(url.searchParams)));
    };
    const live = new QlooClient({ apiKey: "k", cache: new MemoryCache(), fixtures: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: live, llm: new DeterministicLLM() });
    const types = (id: string) => new Set(must(r.trace.find((s) => s.id === id), id).calls.map((c) => new URLSearchParams(c.key.split("?")[1]).get("filter.type") ?? c.path));
    expect(types("demographics")).toEqual(new Set(["urn:demographics"]));
    expect(types("tags")).toEqual(new Set(["urn:tag"]));
    expect([...types("cities")].every((t) => ["/search", "urn:entity:locality", "urn:heatmap"].includes(t))).toBe(true);
    expect([...types("culture")].some((t) => t === "urn:demographics" || t === "urn:tag")).toBe(false);
    expect(r.trace.reduce((n, s) => n + s.calls.length, 0)).toBe(r.qloo.calls);
  });

  it("taste_check ranks city picks when no market is fixed, instead of failing them all", async () => {
    const r = await tasteCheck({ seeds: ["Tems", "Rema"], ages: ["25_to_29"], picks: [{ name: "Washington", type: "locality", role: "city" }, { name: "Boise", type: "locality", role: "city" }] }, { qloo: qloo() });
    expect(r.receipts.find((x) => x.name === "Washington")?.verdict).toBe("pass");
    expect(r.receipts.find((x) => x.name === "Washington")?.affinity).toBeTypeOf("number");
  });

  it("maps where inside a fixed market the audience is (DTC preset)", async () => {
    const r = await runTastemaker(must(PRESETS[1]).brief, deps());
    expect(r.citiesRankedBy).toBe("in-city");
    expect(r.heatmap.length).toBeGreaterThan(10);
    const call = must(r.trace.find((s) => s.id === "cities")).calls[0];
    expect(call?.key).toMatch(/filter\.location\.query=Atlanta/);
    expect(call?.key).toMatch(/filter\.type=urn%3Aheatmap|filter\.type=urn:heatmap/);
  });

  it("judges venues in the city the plan chose, not the top-ranked one", async () => {
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: qloo(), llm: new SecondCityLLM() });
    expect(r.cities[0]?.name).toBe("Washington, DC");
    expect(r.grounded.receipts.find((x) => x.role === "city")).toMatchObject({ name: "Houston", verdict: "pass" });
    const venue = must(r.grounded.receipts.find((x) => x.role === "venue"));
    expect(venue.note).not.toMatch(/Not in/);
    expect(r.trace.some((s) => s.id === "venues-houston")).toBe(true);
  });

  it("judges the baseline's venue in the baseline's own city", async () => {
    const r = await runTastemaker(must(PRESETS[0]).brief, deps());
    // The scripted baseline launches in New York at Madison Square Garden; the grounded plan picks Washington.
    expect(r.baseline.receipts.find((x) => x.role === "city")?.name).toBe("New York");
    const venue = must(r.baseline.receipts.find((x) => x.role === "venue"));
    expect(venue.name).toBe("Madison Square Garden");
    expect(venue.note).not.toMatch(/Not in/);
    // Its pass bar comes from New York's venue pool, loaded in the audit step, not from the grounded city's.
    const audit = must(r.trace.find((s) => s.id === "audit"));
    expect(audit.calls.some((c) => c.path === "/v2/insights" && c.key.includes("urn%3Aentity%3Aplace") && c.key.includes("filter.location.query=New%20York"))).toBe(true);
  });

  it("says a venue isn't in the launch city, and that nothing there could replace it, when the city returns no venues", async () => {
    // Boise: a fixed market where the venue search comes back empty, so the scripted plan's New York venue can't be swapped.
    const brief = Brief.parse({ ...must(PRESETS[0]).brief, candidateCities: undefined, targetCity: "Boise", seeds: ["Phoebe Bridgers"] });
    const simulated = await runTastemaker(brief, deps());
    expect(simulated.trace.find((s) => s.id === "venues")?.detail).toBe("No venues returned");
    const sim = must(simulated.grounded.receipts.find((x) => x.role === "venue"));
    expect(sim).toMatchObject({ name: "Madison Square Garden", verdict: "miss", outOfCity: "Boise" });
    expect(sim.note).toBe("Not in Boise (the offline simulator's location filter doesn't return it there), and the offline simulator returned no venues there to replace it.");
    // The UI shows that note on simulated data too, not the generic "scored below the pass bar".
    expect(receiptNote(sim, true)).toBe(sim.note);
    expect(receiptNote({ verdict: "miss", note: "Affinity 0.10 is below the 0.25 bar." }, true)).toMatch(/below the pass bar .* offline simulator/);

    // The same run over live-shaped answers names Qloo.
    const fetchImpl = async (url: URL) => {
      const { simulate } = await import("@/lib/qloo/sim/simulator");
      return Response.json(simulate(url.pathname as never, Object.fromEntries(url.searchParams)));
    };
    const live = new QlooClient({ apiKey: "k", cache: new MemoryCache(), fixtures: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await runTastemaker(brief, { qloo: live, llm: new DeterministicLLM() });
    const venue = must(r.grounded.receipts.find((x) => x.role === "venue"));
    expect(venue).toMatchObject({ verdict: "miss", outOfCity: "Boise", note: "Not in Boise (Qloo's location filter doesn't return it there), and Qloo returned no venues there to replace it." });
    expect(venue.note).not.toMatch(/bar/);
  });

  it("keeps a finished grounded plan when the baseline draft fails, and marks the comparison unavailable", async () => {
    const r = await runTastemaker(must(PRESETS[0]).brief, { qloo: qloo(), llm: new BaselineFailsLLM() });
    expect(r.grounded.receipts.length).toBeGreaterThan(0);
    expect(r.baseline.unavailable).toMatch(/529/);
    expect(r.baseline.receipts).toEqual([]);
    expect(r.trace.find((s) => s.id === "baseline")?.status).toBe("error");
  });

  it("keeps going when optional surfaces fail, marks those steps, and reports it", async () => {
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new PartialQloo({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });
    const compare = r.trace.find((s) => s.id === "compare");
    expect(compare?.status).toBe("error");
    expect(compare?.detail).toMatch(/500/);
    expect(r.trace.find((s) => s.id === "trending")).toMatchObject({ status: "error" });
    expect(r.trace.find((s) => s.id === "critic-1")?.detail).toMatch(/trend check failed/);
    expect(r.positioning).toEqual([]);
    expect(r.grounded.receipts.length).toBeGreaterThan(0);
  });

  it("finishes the plan with unscored picks when the Qloo budget runs out mid-critic", async () => {
    spent.after = false;
    const r = await runTastemaker(PRESETS[0].brief, { qloo: new SpentQloo({ cache: new MemoryCache(), fixtures: {} }), llm: new DraftThenSpend() });
    expect(r.grounded.receipts.length).toBeGreaterThan(0);
    // Per pick: what the run already holds (the ranked pools, their scores) is still judged; only picks needing a refused call are unscored.
    const unscored = r.grounded.receipts.filter((x) => x.verdict === "unscored");
    expect(unscored.length).toBeGreaterThan(0);
    expect(unscored.every((x) => /Not checked: .*Qloo call budget/.test(x.note))).toBe(true);
    expect(r.grounded.receipts.filter((x) => x.verdict !== "unscored" && x.role !== "city").length).toBeGreaterThan(0);
    const critic = must(r.trace.find((s) => s.id === "critic-1")).detail;
    expect(critic).toMatch(new RegExp(`${unscored.length} unscored · cut short \\(Qloo call budget`));
    expect(critic).not.toMatch(/trend check failed/);
    // A cut pass is no evidence against its unscored picks, so none is swapped out.
    expect(r.trace.some((s) => s.id.startsWith("choose-"))).toBe(false);
    // The baseline audit degrades the same way instead of failing the run.
    expect(r.baseline.unavailable).toBeUndefined();
    expect(r.baseline.receipts.filter((x) => x.verdict === "unscored").every((x) => /Not checked/.test(x.note))).toBe(true);
  });

  it("never waits on a hung model past the run's deadline", async () => {
    class HungChoice extends StubbornLLM {
      override choose(): Promise<Choice[]> {
        return new Promise<Choice[]>(() => undefined);
      }
    }
    const r = await runTastemaker(PRESETS[0].brief, { ...deps(), llm: new HungChoice(), deadlineMs: 300 });
    expect(r.trace.find((s) => s.id.startsWith("choose-"))?.detail).toMatch(/Out of time waiting for the model's choice/);

    class HungDraft extends DeterministicLLM {
      override draft(): Promise<Draft> {
        return new Promise<Draft>(() => undefined);
      }
    }
    await expect(runTastemaker(PRESETS[0].brief, { ...deps(), llm: new HungDraft(), deadlineMs: 100 })).rejects.toThrow(RunDeadlineError);
  });

  it("fails the run when the model can't draft at all (both plans need it)", async () => {
    const events: RunEvent[] = [];
    await expect(runTastemaker(PRESETS[0].brief, { qloo: qloo(), llm: new FailingLLM(), emit: (e) => events.push(e) })).rejects.toThrow(/401/);
    expect(events.some((e) => e.type === "step" && e.step.id === "generate" && e.step.status === "error")).toBe(true);
  });
});

describe("qlooHealth", () => {
  it("counts sources and groups fallback reasons", () => {
    const call = (source: "live" | "replay" | "simulated", cached = false, fallbackReason?: string) => ({ path: "/search" as const, params: {}, key: "k", source, cached, latencyMs: 1, fallbackReason });
    const h = qlooHealth([
      { id: "a", title: "", detail: "", status: "done", ms: 0, calls: [call("live"), call("live", true), call("simulated", false, "Qloo 429 on /search"), call("simulated", false, "Qloo 429 on /search")] },
      { id: "b", title: "", detail: "", status: "done", ms: 0, calls: [call("replay")] },
    ]);
    expect(h).toEqual({ calls: 5, live: 1, cached: 1, replay: 1, simulated: 2, fallbackCalls: 2, fallbacks: [{ reason: "Qloo 429 on /search", count: 2 }] });
  });
});

describe("tasteCheck", () => {
  it("scores arbitrary picks and suggests replacements", async () => {
    const r = await tasteCheck(
      {
        seeds: ["Tems", "Rema"],
        ages: ["25_to_29"],
        picks: [
          { name: "Ayra Starr", type: "artist", role: "collab" },
          { name: "Nickelback", type: "artist", role: "collab" },
          { name: "Lagos Velvet Collective", type: "artist", role: "collab" },
        ],
      },
      { qloo: qloo() },
    );
    expect(r.receipts.map((x) => x.verdict)).toEqual(["pass", "miss", "hallucination"]);
    expect(r.suggestions.map((s) => s.from)).toEqual(["Nickelback", "Lagos Velvet Collective"]);
    expect(r.sources).toEqual(["simulated"]);
  });
  it("validates its audience like a brief", async () => {
    await expect(tasteCheck({ seeds: [], ages: ["25_to_29"], picks: [] }, { qloo: qloo() })).rejects.toThrow();
  });
});

it("every preset is a valid brief", () => {
  for (const p of PRESETS) expect(Brief.safeParse(p.brief).success).toBe(true);
});
