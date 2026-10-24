import { describe, expect } from "vitest";
import { fc, it } from "@fast-check/vitest";
import { PICK_TYPES, ROLES } from "@/lib/agent/brief";
import { LLMOutputError, coerceDraft, extractJson, normalizeRole, normalizeType } from "@/lib/llm/coerce";
import { Draft, applyReplacements } from "@/lib/llm/types";

const pick = (name: string, type = "artist", role = "collab") => ({ name, type, role, rationale: "" });
const minimal = { positioning: "p", hooks: ["h"], script: "s", captions: [{ platform: "X", text: "t" }], musicBrief: "m", picks: [pick("Tems")] };

describe("coerceDraft", () => {
  it("accepts a clean draft unchanged", () => {
    expect(coerceDraft(minimal)).toEqual(Draft.parse(minimal));
  });

  it("maps common synonyms and drops what still doesn't fit", () => {
    const d = coerceDraft({
      ...minimal,
      picks: [pick("Insecure", "TV Show", "Hook reference"), pick("Barbie", "film", "reference"), pick("Atlanta", "city", "launch city"), pick("??", "planet", "collab"), pick("", "artist", "collab")],
    });
    expect(d.picks.map((p) => [p.name, p.type, p.role])).toEqual([
      ["Insecure", "tv_show", "reference"],
      ["Barbie", "movie", "reference"],
      ["Atlanta", "locality", "city"],
    ]);
  });

  it("truncates long strings and caps list lengths instead of failing", () => {
    const d = coerceDraft({
      ...minimal,
      positioning: "x".repeat(1000),
      hooks: Array.from({ length: 12 }, (_, i) => `hook ${i}`),
      picks: Array.from({ length: 40 }, (_, i) => pick(`Artist ${i}`)),
    });
    expect(d.positioning).toHaveLength(400);
    expect(d.hooks).toHaveLength(5);
    expect(d.picks).toHaveLength(20);
  });

  it("rejects a plan with no usable picks, hooks or captions with a typed error", () => {
    expect(() => coerceDraft({ ...minimal, picks: [] })).toThrow(LLMOutputError);
    expect(() => coerceDraft({ ...minimal, hooks: [] })).toThrow(LLMOutputError);
    expect(() => coerceDraft(null)).toThrow(LLMOutputError);
  });

  it.prop([fc.anything()])("either returns a valid Draft or throws LLMOutputError, for any input", (raw) => {
    try {
      expect(Draft.safeParse(coerceDraft(raw)).success).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(LLMOutputError);
    }
  });

  it.prop([fc.constantFrom(...PICK_TYPES), fc.constantFrom(...ROLES)])("normalizes canonical names to themselves", (t, r) => {
    expect(normalizeType(t)).toBe(t);
    expect(normalizeRole(r)).toBe(r);
  });
});

describe("extractJson", () => {
  it("finds the object inside prose or code fences", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("throws typed errors for no or broken JSON", () => {
    expect(() => extractJson("no json here")).toThrow(LLMOutputError);
    expect(() => extractJson("{ nope }")).toThrow(LLMOutputError);
  });
});

describe("applyReplacements", () => {
  const draft = Draft.parse({
    ...minimal,
    positioning: "For Black Panther and Black Panther: Wakanda Forever fans who think Rema is Remarkable",
    hooks: ["Coors Light nights"],
    picks: [pick("Coors Light", "brand", "sponsor"), pick("Black Panther", "movie", "reference"), pick("Black Panther: Wakanda Forever", "movie", "reference"), pick("Rema")],
  });

  it("replaces whole names only, longest first", () => {
    const r = applyReplacements(draft, [
      { from: "Black Panther", to: "Sinners", type: "movie", role: "reference", reason: "" },
      { from: "Rema", to: "Victony", type: "artist", role: "collab", reason: "" },
    ]);
    expect(r.positioning).toBe("For Sinners and Black Panther: Wakanda Forever fans who think Victony is Remarkable");
  });

  it("matches names case-insensitively, in copy and in picks", () => {
    const d = Draft.parse({ ...draft, hooks: ["COORS LIGHT nights"], picks: [pick("coors light", "brand", "sponsor")] });
    const r = applyReplacements(d, [{ from: "Coors Light", to: "Apple Music", type: "brand", role: "sponsor", reason: "" }]);
    expect(r.hooks[0]).toBe("Apple Music nights");
    expect(r.picks[0]?.name).toBe("Apple Music");
  });

  it("is the identity with no replacements", () => {
    expect(applyReplacements(draft, [])).toBe(draft);
  });

  it("never cascades A→B, B→C within one pass", () => {
    const r = applyReplacements(draft, [
      { from: "Coors Light", to: "Black Panther", type: "brand", role: "sponsor", reason: "" },
      { from: "Black Panther", to: "Sinners", type: "movie", role: "reference", reason: "" },
    ]);
    expect(r.hooks[0]).toBe("Black Panther nights");
  });

  it("updates the pick list by role and name, with the reason as rationale", () => {
    const r = applyReplacements(draft, [{ from: "Coors Light", to: "Apple Music", type: "brand", role: "sponsor", reason: "Qloo" }]);
    expect(r.picks[0]).toEqual({ name: "Apple Music", type: "brand", role: "sponsor", rationale: "Qloo" });
  });

  it.prop([fc.stringMatching(/^[A-Z][a-z]{2,8}$/), fc.stringMatching(/^[A-Z][a-z]{2,8}$/), fc.array(fc.stringMatching(/^[a-z ]{0,12}$/), { maxLength: 4 })])(
    "after replacing X with Y, X no longer appears as a whole word",
    (x, y, filler) => {
      fc.pre(x !== y && !y.includes(x));
      const text = [...filler, x, ...filler].join(" ");
      const d = Draft.parse({ ...minimal, positioning: text.slice(0, 400), picks: [pick(x)] });
      const r = applyReplacements(d, [{ from: x, to: y, type: "artist", role: "collab", reason: "" }]);
      expect(new RegExp(`(?<![\\p{L}\\p{N}])${x}(?![\\p{L}\\p{N}])`, "u").test(r.positioning)).toBe(false);
      expect(r.picks[0]?.name).toBe(y);
    },
  );
});
