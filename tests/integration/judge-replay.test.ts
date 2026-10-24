/** The judge over real agent output: record verdicts once, replay them with no model configured. */
import { describe, expect, it, vi } from "vitest";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { judgePair, seededRandom } from "@/lib/benchmark/judge";
import { HttpChat, ReplayChat } from "@/lib/llm/chat";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { sentJson } from "../must";

describe("judge record → replay", () => {
  it("judges a real run over the HTTP wire format, then replays the same verdicts offline", async () => {
    const brief = Brief.parse(PRESETS[0].brief);
    const run = await runTastemaker(brief, { qloo: new QlooClient({ cache: new MemoryCache(), fixtures: {} }), llm: new DeterministicLLM() });

    // A stub Anthropic-format host that prefers whichever plan names more of the audience's own scene.
    const host = vi.fn(async (_u: string, init: RequestInit) => {
      const body = sentJson(init) as { messages: { content: string }[] };
      const user = body.messages[0]?.content ?? "";
      const [p1 = "", p2 = ""] = user.split("=== Plan 1 ===")[1]?.split("=== Plan 2 ===") ?? [];
      const score = (p: string) => ["Ayra Starr", "Victony", "Afrobeats Intelligence", "Echostage"].filter((n) => p.includes(n)).length;
      const winner = score(p1) > score(p2) ? "1" : score(p2) > score(p1) ? "2" : "tie";
      const s = { audienceFit: 3, specificity: 3, credibility: 3, freshness: 3 };
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ scores: { "1": s, "2": s }, winner, reason: "fit" }) }] });
    });
    const live = new HttpChat({ format: "anthropic", model: "judge-m", apiKey: "k", fetchImpl: host as unknown as typeof fetch });
    const recorder: Record<string, string> = {};
    const recorded = await judgePair(new ReplayChat("judge-m", {}, live, recorder), brief, run.grounded.draft, run.baseline.draft, seededRandom(brief.subject));
    expect(host).toHaveBeenCalledTimes(2);
    expect(recorded).toMatchObject({ final: "grounded", consistent: true });
    const sent = sentJson((host.mock.calls[0] as unknown as [string, RequestInit])[1]) as { system: string; messages: { content: string }[] };
    expect(sent.messages[0]?.content).not.toMatch(/qloo/i);

    const offline = new ReplayChat("judge-m", recorder);
    const replayed = await judgePair(offline, brief, run.grounded.draft, run.baseline.draft, seededRandom(brief.subject));
    expect(replayed).toEqual(recorded);
    expect(offline.replayed).toBe(2);
  });
});
