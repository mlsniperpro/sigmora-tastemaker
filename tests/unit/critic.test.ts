import { describe, it, expect, vi } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { ROLE_SPEC, ROLES } from "@/lib/agent/brief";
import { DEFAULT_CRITIC, isFading, makeCtx, scoreEntities, toCandidate, type Audience, type Ctx, type RankedCandidate } from "@/lib/agent/context";
import { chooseReplacements, critique, metricsOf, thresholdFor } from "@/lib/agent/critic";
import type { Receipt, Verdict } from "@/lib/agent/types";
import type { Pick } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { QlooBudgetError } from "@/lib/qloo/errors";
import { InsightsResponse } from "@/lib/qloo/types";
import { must } from "../must";

const audience: Audience = { ages: ["25_to_29", "30_to_34"] };
const ctxWith = (candidates: Ctx["candidates"], a: Audience = audience): Ctx => {
  const c = makeCtx(a, new QlooClient({ cache: new MemoryCache(), fixtures: {} }), [{ name: "Tems", entityId: "t" }]);
  c.candidates = candidates;
  return c;
};
const cand = (name: string, affinity: number, type: RankedCandidate["type"] = "artist"): RankedCandidate => ({ name, type, affinity, entityId: `id-${name}` });
const receipt = (name: string, verdict: Verdict, role: Receipt["role"] = "collab", affinity?: number): Receipt => ({ name, type: "artist", role, verdict, affinity, drivers: [], calls: [], note: "" });
const picksOf = (names: string[], role: Pick["role"] = "collab"): Pick[] => names.map((n) => ({ name: n, type: "artist", role, rationale: "" }));

describe("ROLE_SPEC", () => {
  it("covers every role, with at least one type and a positive count", () => {
    for (const r of ROLES) {
      expect(ROLE_SPEC[r].types.length).toBeGreaterThan(0);
      expect(ROLE_SPEC[r].count).toBeGreaterThan(0);
    }
  });
});

describe("thresholdFor", () => {
  test.prop([fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 })])("median bar: max(floor, ratio × median), never above the best candidate unless the floor is", (affs) => {
    const ctx = ctxWith({ collab: affs.map((a, i) => cand(`a${i}`, a)) });
    const t = thresholdFor(ctx, "collab");
    expect(t).toBeGreaterThanOrEqual(DEFAULT_CRITIC.minAffinity - 0.0005);
    expect(t).toBeLessThanOrEqual(Math.max(DEFAULT_CRITIC.minAffinity, Math.max(...affs)) + 0.0005);
  });
  test.prop([fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 14 })])("top-3 bar (cities): the third-best candidate, or the last when fewer", (affs) => {
    const ctx = ctxWith({ city: affs.map((a, i) => cand(`c${i}`, a, "locality")) });
    const sorted = [...affs].sort((a, b) => b - a);
    expect(thresholdFor(ctx, "city")).toBe(sorted[Math.min(2, sorted.length - 1)]);
  });
  it("sets no bar (rather than a made-up one) when Qloo returned no candidates", () => {
    expect(thresholdFor(ctxWith({}), "collab")).toBeUndefined();
  });
});

describe("metricsOf", () => {
  const verdict = fc.constantFrom<Verdict>("pass", "miss", "hallucination", "fading", "unscored");
  test.prop([fc.array(verdict, { maxLength: 30 })])("counts add up; the miss rate is in [0, 1] when at least half the picks were judged, else null", (vs) => {
    const m = metricsOf(vs.map((v, i) => receipt(`n${i}`, v)));
    expect(m.picks).toBe(vs.length);
    expect(m.hallucinations + m.misses + m.fading + m.unscored).toBe(vs.filter((v) => v !== "pass").length);
    expect(m.judged).toBe(m.picks - m.unscored);
    if (m.judged === 0 || m.judged * 2 < m.picks) expect(m.cultureMissRate).toBeNull();
    else {
      const rate = must(m.cultureMissRate);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
      expect(rate).toBeCloseTo((m.hallucinations + m.misses) / m.judged, 3);
    }
  });
  it("leaves unscored picks out of the rate instead of counting them as passes or misses", () => {
    expect(metricsOf([receipt("a", "unscored"), receipt("b", "miss")]).cultureMissRate).toBe(1);
    expect(metricsOf([receipt("a", "unscored"), receipt("b", "pass")])).toMatchObject({ judged: 1, cultureMissRate: 0 });
  });
  it("shows no rate (null, not a fake 0%) when nothing or too little was judged", () => {
    expect(metricsOf([receipt("a", "unscored")])).toMatchObject({ picks: 1, judged: 0, cultureMissRate: null });
    expect(metricsOf([])).toMatchObject({ picks: 0, judged: 0, cultureMissRate: null });
    expect(metricsOf([receipt("a", "unscored"), receipt("b", "unscored"), receipt("c", "pass")]).cultureMissRate).toBeNull();
  });
  it("counts fading as a warning, not a miss", () => {
    expect(metricsOf([receipt("a", "fading"), receipt("b", "pass")]).cultureMissRate).toBe(0);
  });
});

describe("an entity Qloo returns without an affinity", () => {
  it("is never given a made-up 0: no candidate, no score", async () => {
    expect(toCandidate({ entity_id: "e1", name: "N" }, "artist")).toEqual([]);
    expect(toCandidate({ entity_id: "e1", name: "N", query: { affinity: 0 } }, "artist")).toEqual([expect.objectContaining({ affinity: 0 })]);
    const ctx = ctxWith({});
    const reply = { data: { results: { entities: [{ entity_id: "e1", name: "N", query: {} }, { entity_id: "e2", name: "M", query: { affinity: 0.4 } }] } }, meta: { key: "k", source: "live" } };
    vi.spyOn(ctx.qloo, "insights").mockResolvedValue(reply as unknown as Awaited<ReturnType<Ctx["qloo"]["insights"]>>);
    await scoreEntities(ctx, "artist", ["e1", "e2"]);
    expect(ctx.scores.has("e1")).toBe(false);
    expect(ctx.scores.get("e2")?.affinity).toBe(0.4);
  });
});

describe("a name with its subtitle dropped", () => {
  it("resolves to Qloo's full title instead of being called invented, and the receipt says so", async () => {
    const ctx = ctxWith({ reference: [cand("Insecure", 0.6, "tv_show"), cand("Abbott Elementary", 0.5, "tv_show")] });
    const full = { entity_id: "bp2", name: "Black Panther: Wakanda Forever", types: ["urn:entity:movie"], subtype: "urn:entity:movie" };
    type Reply<K extends "search" | "insights"> = Awaited<ReturnType<Ctx["qloo"][K]>>;
    vi.spyOn(ctx.qloo, "search").mockResolvedValue({ data: { results: [full] }, meta: { key: "s", source: "live" } } as unknown as Reply<"search">);
    vi.spyOn(ctx.qloo, "insights").mockResolvedValue({ data: { results: { entities: [{ ...full, query: { affinity: 0.7 } }] } }, meta: { key: "i", source: "live" } } as unknown as Reply<"insights">);
    const { receipts } = await critique(ctx, [{ name: "Wakanda Forever", type: "movie", role: "reference", rationale: "" }]);
    const r = must(receipts[0]);
    expect(r.verdict).not.toBe("hallucination");
    expect(r.entityId).toBe("bp2");
    expect(r.note).toContain('Matched to Qloo\'s "Black Panther: Wakanda Forever"');
  });
});

describe("isFading", () => {
  it("needs a reading below the threshold", () => {
    const ctx = ctxWith({});
    // Readings are population_percent_delta (percent); the default bar is DEFAULT_CRITIC.fadingBelow.
    ctx.trends.set("a", -9).set("b", 2).set("c", undefined);
    expect([isFading(ctx, "a"), isFading(ctx, "b"), isFading(ctx, "c"), isFading(ctx, "none")]).toEqual([true, false, false, false]);
  });
});

describe("chooseReplacements", () => {
  it("offers the best unused, untried candidate of the same role", () => {
    const ctx = ctxWith({ collab: [cand("Ayra Starr", 0.9), cand("Victony", 0.8), cand("Omah Lay", 0.7)] });
    const reps = chooseReplacements(ctx, picksOf(["Ayra Starr", "Ed Sheeran"]), [receipt("Ayra Starr", "pass"), receipt("Ed Sheeran", "miss", "collab", 0.1)], new Set());
    expect(reps).toEqual([expect.objectContaining({ from: "Ed Sheeran", to: "Victony", role: "collab" })]);
  });

  it("never proposes the same swap twice across rounds, matching names loosely", () => {
    const ctx = ctxWith({ collab: [cand("Victony", 0.8), cand("Omah Lay", 0.7)] });
    const tried = new Set<string>();
    const r1 = chooseReplacements(ctx, picksOf(["Ed Sheeran"]), [receipt("Ed Sheeran", "miss")], tried);
    // the model resubmitted the rejected pick in another spelling
    const r2 = chooseReplacements(ctx, picksOf(["ed sheeran"]), [receipt("ed sheeran", "miss")], tried);
    expect(r1[0]?.to).toBe("Victony");
    expect(r2[0]?.to).toBe("Omah Lay");
    expect(chooseReplacements(ctx, picksOf(["Ed Sheeran"]), [receipt("Ed Sheeran", "miss")], tried)).toEqual([]);
  });

  test.prop([fc.uniqueArray(fc.stringMatching(/^[A-Z][a-z]{2,7}$/), { minLength: 2, maxLength: 12, selector: (s) => s.toLowerCase() }), fc.array(fc.boolean(), { minLength: 12, maxLength: 12 })])(
    "never proposes a name already in the plan, already tried, or twice",
    (names, failing) => {
      const inPlan = names.slice(0, Math.ceil(names.length / 2));
      const ctx = ctxWith({ collab: names.map((n, i) => cand(n, 1 - i / 20)) });
      const receipts = inPlan.map((n, i) => receipt(n, failing[i] ? "miss" : "pass"));
      const reps = chooseReplacements(ctx, picksOf(inPlan), receipts, new Set());
      const tos = reps.map((r) => r.to);
      expect(new Set(tos).size).toBe(tos.length);
      tos.forEach((t) => expect(inPlan).not.toContain(t));
      reps.forEach((r) => expect(receipts.find((x) => x.name === r.from)?.verdict).not.toBe("pass"));
    },
  );

  it("skips fading references, and swaps a city that misses a fixed market for that market (never another ranked metro)", () => {
    const ctx = ctxWith({ reference: [cand("Old Show", 0.9, "tv_show"), cand("New Show", 0.8, "tv_show")], city: [cand("Houston", 0.9, "locality")] }, { ...audience, targetCity: "Atlanta" });
    ctx.trends.set("id-Old Show", -9);
    const reps = chooseReplacements(ctx, picksOf(["x"]), [receipt("Barbie", "fading", "reference"), receipt("Dallas", "miss", "city")], new Set());
    expect(reps.map((r) => r.to)).toEqual(["New Show", "Atlanta"]);
    expect(reps[1]).toMatchObject({ from: "Dallas", role: "city", type: "locality" });
  });

  it("doesn't swap in the fixed market when the plan already names it", () => {
    const ctx = ctxWith({}, { ...audience, targetCity: "Atlanta" });
    const plan: Pick[] = [...picksOf(["Atlanta"], "city"), ...picksOf(["Dallas"], "city")];
    expect(chooseReplacements(ctx, plan, [receipt("Atlanta", "pass", "city"), receipt("Dallas", "miss", "city")], new Set())).toEqual([]);
  });

  it("only offers alternatives that clear the role's bar", () => {
    // median 0.5 → bar max(0.25, 0.35) = 0.35: the 0.2 candidate is below it
    const ctx = ctxWith({ collab: [cand("Top", 0.9), cand("Mid", 0.5), cand("Low", 0.2)] });
    const reps = chooseReplacements(ctx, picksOf(["Top", "Mid", "A", "B"]), [receipt("A", "miss", "collab", 0.1), receipt("B", "miss", "collab", 0.1)], new Set());
    expect(reps).toEqual([]);
    const bar = must(thresholdFor(ctx, "collab"));
    for (const r of chooseReplacements(ctx, picksOf(["A"]), [receipt("A", "miss", "collab", 0.1)], new Set())) {
      for (const o of r.options ?? []) expect(o.affinity).toBeGreaterThanOrEqual(bar);
    }
  });

  test.prop([fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 }), fc.nat(5)])("every offered option clears the bar", (affs, failing) => {
    const ctx = ctxWith({ collab: affs.map((a, i) => cand(`c${i}`, a)) });
    const bar = must(thresholdFor(ctx, "collab"));
    const receipts = Array.from({ length: failing }, (_, i) => receipt(`f${i}`, "miss", "collab", 0));
    for (const r of chooseReplacements(ctx, picksOf(receipts.map((x) => x.name)), receipts, new Set())) {
      for (const o of must(r.options)) expect(o.affinity).toBeGreaterThanOrEqual(bar);
    }
  });

  it("offers a ranked, above-bar candidate for an unscored pick (unscored is not a pass)", () => {
    const ctx = ctxWith({ collab: [cand("Victony", 0.8), cand("Omah Lay", 0.7)] });
    const reps = chooseReplacements(ctx, picksOf(["Mystery"]), [receipt("Mystery", "unscored")], new Set());
    expect(reps).toEqual([expect.objectContaining({ from: "Mystery", to: "Victony" })]);
    expect(reps[0]?.reason).toMatch(/couldn't be scored/);
  });
});

describe("critique (offline)", () => {
  it("scores cities from the ranked pool, without another call, and resolves later passes from memo", async () => {
    const ctx = ctxWith({ city: [cand("Washington", 0.7, "locality"), cand("Houston", 0.5, "locality"), cand("Atlanta", 0.4, "locality"), cand("Dallas", 0.2, "locality")] });
    for (const c of ctx.candidates.city ?? []) c.key = "rank-call";
    const keys: string[] = [];
    ctx.qloo.observe((m) => keys.push(m.key));
    const { receipts } = await critique(ctx, [...picksOf(["Washington", "Dallas"], "city")]);
    expect(receipts.map((r) => [r.name, r.verdict, r.affinity])).toEqual([
      ["Washington", "pass", 0.7],
      ["Dallas", "miss", 0.2],
    ]);
    expect(receipts[0]?.calls).toEqual(["rank-call"]);
    expect(keys).toEqual([]);
  });

  it("passes the brief's fixed market and misses any other city, by name", async () => {
    const ctx = ctxWith({}, { ...audience, targetCity: "Atlanta" });
    const { receipts } = await critique(ctx, picksOf(["Atlanta", "Dallas"], "city"));
    expect(receipts.map((r) => r.verdict)).toEqual(["pass", "miss"]);
    expect(must(receipts[0]).affinity).toBeUndefined();
  });

  it("re-scores only entities it hasn't seen", async () => {
    const ctx = ctxWith({});
    const keys: string[] = [];
    ctx.qloo.observe((m) => keys.push(m.key));
    await critique(ctx, picksOf(["Ayra Starr", "Victony"]));
    const first = keys.length;
    await critique(ctx, picksOf(["Ayra Starr", "Victony"]));
    expect(keys.length).toBe(first);
  });
});

describe("critic honesty", () => {
  const live = (o: Partial<Record<"insights", QlooClient["insights"]>> = {}) => {
    const q = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
    if (o.insights) q.insights = o.insights;
    return q;
  };

  it("searches every type before calling a name 'not found', and says what it searched", async () => {
    const ctx = ctxWith({ collab: [cand("Ayra Starr", 0.9)] });
    const { receipts } = await critique(ctx, picksOf(["Lagos Velvet Collective"]));
    const r = must(receipts[0]);
    expect(r.verdict).toBe("hallucination");
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]).not.toMatch(/types=/);
    expect(r.note).toMatch(/Not found in Qloo/);
    expect(r.affinity).toBeUndefined();
  });

  it("calls a real entity filed under another type a role mismatch, not an invention", async () => {
    const ctx = ctxWith({ collab: [cand("Ayra Starr", 0.9)] });
    const r = must((await critique(ctx, picksOf(["Insecure"]))).receipts[0]);
    expect(r.verdict).toBe("miss");
    expect(r.note).toMatch(/files "Insecure" as tv show/);
  });

  it("calls a resolved entity that the scoring call (filter.results.entities) leaves out a miss, with no made-up number", async () => {
    const empty: QlooClient["insights"] = async (type, params) => {
      const q = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
      const r = await q.insights(type, params);
      return params["filter.results.entities"] ? { ...r, data: { ...r.data, results: { ...r.data.results, entities: [] } } } : r;
    };
    const ctx = makeCtx(audience, live({ insights: empty }), [{ name: "Tems", entityId: "t" }]);
    ctx.candidates = { collab: [cand("Ayra Starr", 0.9)] };
    const r = must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]);
    expect(r.verdict).toBe("miss");
    expect(r.affinity).toBeUndefined();
    expect(r.note).toMatch(/left it out/);
    expect(r.calls.some((k) => k.includes("filter.results.entities"))).toBe(true);
    expect(metricsOf([r]).cultureMissRate).toBe(1);
  });

  it("shows no number when Qloo returns the entity without an affinity, and doesn't count it as a miss (or a pass)", async () => {
    const noAffinity: QlooClient["insights"] = async (type, params) => {
      const q = new QlooClient({ cache: new MemoryCache(), fixtures: {} });
      const r = await q.insights(type, params);
      if (!params["filter.results.entities"]) return r;
      const entities = (r.data.results.entities ?? []).map((e) => ({ ...e, query: {} }));
      return { ...r, data: { ...r.data, results: { ...r.data.results, entities } } };
    };
    const ctx = makeCtx(audience, live({ insights: noAffinity }), [{ name: "Tems", entityId: "t" }]);
    ctx.candidates = { collab: [cand("Ayra Starr", 0.9)] };
    const r = must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]);
    expect(r.verdict).toBe("unscored");
    expect(r.affinity).toBeUndefined();
    expect(metricsOf([r])).toMatchObject({ judged: 0, cultureMissRate: null });
  });

  it("marks a pick unscored, not missed, when its role has no candidate pool", async () => {
    const ctx = ctxWith({});
    const r = must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]);
    expect(r.verdict).toBe("unscored");
    expect(r.threshold).toBeUndefined();
    expect(r.note).toMatch(/no candidates for this role/);
  });
});

describe("explainability Qloo couldn't compute", () => {
  type Reply = Awaited<ReturnType<Ctx["qloo"]["insights"]>>;
  /** The scoring reply as the client hands it over: parsed by the response schema. */
  const scoringReply = (query: Record<string, unknown>): Reply =>
    ({ data: InsightsResponse.parse({ results: { entities: [{ entity_id: "id-Burna Boy", name: "Burna Boy", query }] } }), meta: { key: "score-key", source: "live" } }) as unknown as Reply;
  const ctxFor = () => ctxWith({ collab: [cand("Ayra Starr", 0.9), cand("Burna Boy", 0.8)] });

  it("judges the pick on its affinity, shows no driver split, and puts Qloo's warning on the receipt", async () => {
    const ctx = ctxFor();
    vi.spyOn(ctx.qloo, "insights").mockResolvedValue(scoringReply({ affinity: 0.8, explainability: { warning: "Explainability unavailable for this request" } }));
    const r = must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]);
    expect(r.verdict).toBe("pass");
    expect(r.affinity).toBe(0.8);
    expect(r.drivers).toEqual([]);
    expect(r.explainabilityWarning).toBe("Explainability unavailable for this request");
    expect(r.note).toMatch(/no driver split for this score \("Explainability unavailable for this request"\)/);
  });

  it("treats affinity: null as unscored, not as a crash or a 0", async () => {
    const ctx = ctxFor();
    vi.spyOn(ctx.qloo, "insights").mockResolvedValue(scoringReply({ affinity: null }));
    const r = must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]);
    expect(r.verdict).toBe("unscored");
    expect(r.affinity).toBeUndefined();
  });
});

describe("a pass cut short by the run's Qloo budget", () => {
  /** Offline Qloo that refuses every call once `spent` is set, as the run cap does. */
  class Spendable extends QlooClient {
    spent = false;
    override search(...a: Parameters<QlooClient["search"]>) {
      return this.spent ? Promise.reject(new QlooBudgetError("run", 90)) : super.search(...a);
    }
    override insights(...a: Parameters<QlooClient["insights"]>) {
      return this.spent ? Promise.reject(new QlooBudgetError("run", 90)) : super.insights(...a);
    }
    override trending(...a: Parameters<QlooClient["trending"]>) {
      return this.spent ? Promise.reject(new QlooBudgetError("run", 90)) : super.trending(...a);
    }
  }
  const setup = () => {
    const q = new Spendable({ cache: new MemoryCache(), fixtures: {} });
    const ctx = makeCtx(audience, q, [{ name: "Tems", entityId: "t" }]);
    ctx.candidates = { collab: [cand("Victony", 0.8), cand("Omah Lay", 0.7), cand("Fireboy DML", 0.6)] };
    return { q, ctx };
  };
  const NAMES = ["Ayra Starr", "Ed Sheeran", "Burna Boy", "Wizkid", "Lagos Velvet Collective"];

  it("keeps the receipts already judged, and marks unscored only the picks whose own calls were refused", async () => {
    const { q, ctx } = setup();
    const first = await critique(ctx, picksOf(["Ayra Starr", "Ed Sheeran"]));
    expect(first.cut).toBeUndefined();
    expect(first.receipts.every((x) => x.verdict !== "unscored")).toBe(true);
    q.spent = true;
    const second = await critique(ctx, picksOf(["Ayra Starr", "Ed Sheeran", "Burna Boy"]));
    expect(second.cut).toMatch(/Qloo call budget for this run \(90\) is spent/);
    // A cut is said once, on `cut`, not reported as a failed trend check.
    expect(second.warnings).toEqual([]);
    for (const before of first.receipts) {
      const after = must(second.receipts.find((x) => x.name === before.name));
      expect([after.verdict, after.affinity, after.drivers]).toEqual([before.verdict, before.affinity, before.drivers]);
    }
    expect(second.receipts.find((x) => x.name === "Burna Boy")).toMatchObject({ verdict: "unscored", note: "Not checked: Qloo call budget for this run (90) is spent." });
  });

  test.prop([fc.subarray(NAMES, { minLength: 1 }), fc.subarray(NAMES)])("a cut never changes a verdict the run could already reach: it only withholds the rest", async (known, later) => {
    const { q, ctx } = setup();
    const judged = await critique(ctx, picksOf(known));
    q.spent = true;
    const cut = await critique(ctx, picksOf([...new Set([...known, ...later])]));
    for (const r of cut.receipts) {
      const was = judged.receipts.find((x) => x.name === r.name);
      expect(r.verdict).toBe(was ? was.verdict : "unscored");
    }
  });

  it("doesn't swap out unscored picks after a cut (no evidence they're bad), but still swaps real misses", () => {
    const ctx = ctxWith({ collab: [cand("Victony", 0.8), cand("Omah Lay", 0.7)] });
    const receipts = [receipt("Mystery", "unscored"), receipt("Ed Sheeran", "miss", "collab", 0.1)];
    expect(chooseReplacements(ctx, picksOf(["Mystery", "Ed Sheeran"]), receipts, new Set(), { cut: true }).map((r) => r.from)).toEqual(["Ed Sheeran"]);
    // Without a cut, an unscored pick is still offered a ranked swap.
    expect(chooseReplacements(ctx, picksOf(["Mystery", "Ed Sheeran"]), receipts, new Set()).map((r) => r.from)).toEqual(["Mystery", "Ed Sheeran"]);
  });
});

describe("an entity the scoring call already left out", () => {
  it("isn't re-scored on later passes", async () => {
    const ctx = ctxWith({ collab: [cand("Ayra Starr", 0.9)] });
    const real = ctx.qloo.insights.bind(ctx.qloo);
    const scored: string[] = [];
    vi.spyOn(ctx.qloo, "insights").mockImplementation(async (t, p) => {
      const r = await real(t, p);
      if (!p["filter.results.entities"]) return r;
      scored.push(String(p["filter.results.entities"]));
      // Qloo leaves every asked-about entity out.
      return { ...r, data: { ...r.data, results: { ...r.data.results, entities: [] } } };
    });
    expect(must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]).verdict).toBe("miss");
    expect(must((await critique(ctx, picksOf(["Burna Boy"]))).receipts[0]).verdict).toBe("miss");
    expect(scored).toHaveLength(1);
  });
});
