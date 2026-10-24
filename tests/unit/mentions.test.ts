import { describe, expect, it } from "vitest";
import { Brief } from "@/lib/agent/brief";
import { makeCtx } from "@/lib/agent/context";
import { candidateMentions, unlistedMentions, MAX_MENTION_SEARCHES } from "@/lib/agent/mentions";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { Draft, type DraftInput } from "@/lib/llm/types";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";

const brief = Brief.parse(PRESETS[0].brief);
const draft = (text: string, picks: string[] = ["Ayra Starr"]) =>
  Draft.parse({ positioning: text, hooks: ["h"], script: "s", captions: [{ platform: "TikTok", text: "t" }], musicBrief: "m", picks: picks.map((name) => ({ name, type: "artist", role: "collab" })) });

describe("candidateMentions", () => {
  it("finds proper-noun runs the picks don't cover, longest first, and skips the brief's own names and platforms", () => {
    const c = candidateMentions(draft("Nia Sol meets Burna Boy at Love Island USA, then Ayra Starr. Post it on TikTok."), brief);
    expect(c).toContain("Burna Boy");
    expect(c).toContain("Love Island USA");
    expect(c).not.toContain("Ayra Starr");
    expect(c).not.toContain("Nia Sol");
    expect(c).not.toContain("TikTok");
    expect(c.indexOf("Love Island USA")).toBeLessThan(c.indexOf("Burna Boy"));
  });
});

describe("candidateMentions: regressions", () => {
  const withX = (text: string, picks: string[] = ["Ayra Starr"]) =>
    Draft.parse({ ...draft(text, picks), captions: [{ platform: "TikTok", text: "t" }, { platform: "X", text: "u" }] });

  it("skips platforms by exact name only, so an X caption doesn't hide names with an x in them", () => {
    const c = candidateMentions(withX("A cameo from Rex Orange County with Alix Earle, then post to X."), brief);
    expect(c).toEqual(expect.arrayContaining(["Rex Orange County", "Alix Earle"]));
    expect(c).not.toContain("X");
  });

  it("never treats a streaming service, social network or store in a call to action as a pick", () => {
    const c = candidateMentions(draft("Pre-save on Spotify and Apple Music, watch on YouTube, follow on Instagram. Tickets on Ticketmaster with Burna Boy."), brief);
    expect(c.filter((n) => /Spotify|Apple|YouTube|Instagram|Ticketmaster/.test(n) && !n.includes("Burna"))).toEqual([]);
    expect(c).toContain("Burna Boy");
  });

  it("matches known names on whole words, not substrings", () => {
    expect(candidateMentions(draft("the Remastered Edition drops", ["Rema"]), brief)).toContain("Remastered Edition");
    expect(candidateMentions(draft("we play the Atlanta Braves game"), { ...brief, targetCity: "Atlanta" })).toContain("Atlanta Braves");
  });

  it("also tries a sentence-start run without its opener, right after the whole run", () => {
    const c = candidateMentions(draft("Like Burna Boy on a Sunday. Tonight Ayra Starr joins.\nWatch Insecure first."), brief);
    expect(c.indexOf("Burna Boy")).toBe(c.indexOf("Like Burna Boy") + 1);
    expect(c).toContain("Insecure");
    // The opener glued to a pick is still that pick.
    expect(c.some((n) => n.includes("Ayra Starr"))).toBe(false);
  });

  it("reads a possessive as the name, and tries lone sentence openers last", () => {
    const c = candidateMentions(draft("We open with Nia Sol's single. First, Burna Boy."), brief);
    expect(c.some((n) => n.includes("Nia Sol"))).toBe(false);
    expect(c.indexOf("We")).toBeGreaterThan(c.indexOf("Burna Boy"));
  });

  it("never adds the brief's own seeds, typed or resolved from a link", () => {
    const c = candidateMentions(draft("For fans of Tems, Rema and Asake, and of Wizkid"), brief, ["Wizkid"]);
    expect(c.filter((n) => /Tems|Rema|Asake|Wizkid/.test(n))).toEqual([]);
  });
});

describe("unlistedMentions", () => {
  const qloo = () => new QlooClient({ cache: new MemoryCache(), fixtures: {} });
  it("returns only names Qloo has under exactly that name, with a role from Qloo's type", async () => {
    const ctx = makeCtx({ ages: ["25_to_29"] }, qloo(), [{ name: "Tems", entityId: "t" }]);
    const extra = await unlistedMentions(ctx, draft("Burna Boy and Insecure, Then Something Else Entirely."), brief);
    expect(extra.map((p) => [p.name, p.role])).toEqual(expect.arrayContaining([["Burna Boy", "collab"], ["Insecure", "reference"]]));
    expect(extra.some((p) => p.name.startsWith("Then"))).toBe(false);
  });

  it("caps the searches it spends", async () => {
    const q = qloo();
    const searches: string[] = [];
    q.observe((m) => {
      if (m.path === "/search") searches.push(m.key);
    });
    const many = Array.from({ length: 20 }, (_, i) => `Zq${String.fromCharCode(65 + i)}x Name`).join(", ");
    await unlistedMentions(makeCtx({ ages: ["25_to_29"] }, q, [{ name: "Tems", entityId: "t" }]), draft(many), brief);
    expect(searches.length).toBe(MAX_MENTION_SEARCHES);
  });

  it("puts an unlisted name through the critic in a real run", async () => {
    class Sneaky extends DeterministicLLM {
      override async draft(input: DraftInput) {
        const d = await super.draft(input);
        return { ...d, script: `${d.script} Cameo: Burna Boy.` };
      }
    }
    const r = await runTastemaker(PRESETS[0].brief, { qloo: qloo(), llm: new Sneaky() });
    expect(r.grounded.receipts.some((x) => x.name === "Burna Boy")).toBe(true);
    expect(r.trace.find((s) => s.id === "critic-1")?.detail).toMatch(/named in the copy but not listed, so added: .*Burna Boy/);
  });

  it("flags a failing name found only in the copy, and never rewrites the copy around it", async () => {
    class Sneaky extends DeterministicLLM {
      override async draft(input: DraftInput) {
        const d = await super.draft(input);
        return { ...d, script: `${d.script} Cameo: Nickelback.` };
      }
    }
    const r = await runTastemaker(PRESETS[0].brief, { qloo: qloo(), llm: new Sneaky() });
    expect(r.grounded.receipts.find((x) => x.name === "Nickelback")?.verdict).toBe("miss");
    expect(r.grounded.receipts.some((x) => x.replaced?.name === "Nickelback")).toBe(false);
    expect(r.grounded.draft.script).toContain("Nickelback");
  });
});
