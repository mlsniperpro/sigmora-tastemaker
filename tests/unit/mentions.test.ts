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
});
