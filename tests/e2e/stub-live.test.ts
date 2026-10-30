/**
 * End to end through the real HTTP surface in stub mode: keys are set, so the
 * app takes its *live* code paths (throttle, retries, budgets, the
 * OpenAI-compatible wire format), while global fetch plays the Qloo host (answered
 * by the simulator, with an injected 429) and an LLM host. A second test
 * records the live responses and replays them with the network off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent, RunResult } from "@/lib/agent/types";
import { DeterministicLLM } from "@/lib/llm/deterministic";
import { Brief } from "@/lib/agent/brief";
import { PRESETS } from "@/lib/agent/presets";
import { runTastemaker } from "@/lib/agent/run";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import type { QlooPath } from "@/lib/qloo/params";
import { simulate } from "@/lib/qloo/sim/simulator";
import { must } from "../must";

const QLOO = "https://qloo.stub";
const LLM = "https://llm.stub/v1";

interface Seen {
  qloo: { url: URL; key: string | null }[];
  llm: number;
  injected429: boolean;
}

/** Plays both remote services. The LLM ignores revise instructions, like a stubborn real model. */
function stubNetwork(seen: Seen) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === QLOO) {
      const key = new Headers(init?.headers).get("x-api-key");
      seen.qloo.push({ url, key });
      if (!seen.injected429 && url.pathname === "/v2/insights") {
        seen.injected429 = true;
        return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      }
      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (params[k] = v));
      return Response.json(simulate(url.pathname as QlooPath, params));
    }
    if (url.href === `${LLM}/chat/completions`) {
      seen.llm++;
      const draft = await new DeterministicLLM().draft({ brief: Brief.parse(PRESETS[0].brief) });
      return Response.json({ choices: [{ message: { content: `Here is the plan:\n${JSON.stringify(draft)}` } }] });
    }
    return new Response("unexpected host", { status: 599 });
  });
}

async function readStream(res: Response) {
  const events = (await res.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as RunEvent);
  return { events, result: (events.find((e) => e.type === "result") as { result: RunResult } | undefined)?.result };
}

describe("e2e: /api/run in live mode against stubbed Qloo + LLM hosts", () => {
  beforeEach(() => {
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_RPS", "50");
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("LLM_MODEL", "stub-model");
    vi.stubEnv("LLM_API_KEY", "llm-secret");
    vi.stubEnv("LLM_BASE_URL", LLM);
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "1");
    // Room for two runs from one network, so the second meets the per-minute limit rather than its Qloo share.
    vi.stubEnv("QLOO_DAILY_CALL_CAP", "1200");
    vi.stubEnv("QLOO_IP_DAILY_CALLS", "240");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams a full live run, retries the 429, enforces ignored swaps, keeps secrets out, then rate-limits", async () => {
    // The per-IP limit is a fixed one-minute window: start the clock just after a minute boundary so both
    // requests below fall inside one window (the soak caught this test straddling a boundary).
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-24T12:00:05Z") });
    const seen: Seen = { qloo: [], llm: 0, injected429: false };
    vi.stubGlobal("fetch", stubNetwork(seen));
    const { POST } = await import("@/app/api/run/route");
    const req = (brief: unknown) =>
      new Request("http://tm.example/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ brief }) });

    const res = await POST(req(PRESETS[0].brief));
    expect(res.status).toBe(200);
    const { events, result } = await readStream(res);
    expect(result, JSON.stringify(events.at(-1))).toBeDefined();
    const r = must(result, "result");

    // every Qloo answer came from the (stub) live host, none fell back
    expect(r.sources).toEqual(["live"]);
    expect(r.qloo.fallbacks).toEqual([]);
    expect(seen.injected429).toBe(true);
    expect(seen.qloo.every((c) => c.key === "qloo-secret")).toBe(true);
    // the model ignored every swap; the loop applied them anyway and shipped a clean plan
    expect(seen.llm).toBeGreaterThanOrEqual(3);
    expect(r.metrics.grounded.hallucinations).toBe(0);
    expect(r.metrics.baseline.hallucinations).toBeGreaterThan(0);
    expect(must(r.metrics.grounded.cultureMissRate, "grounded rate")).toBeLessThan(must(r.metrics.baseline.cultureMissRate, "baseline rate"));
    expect(r.llm).toMatchObject({ scripted: false, label: "stub-model" });
    // no secret anywhere in what the browser receives
    const wire = JSON.stringify(events);
    expect(wire).not.toContain("qloo-secret");
    expect(wire).not.toContain("llm-secret");

    // a second, different custom brief from the same IP inside the minute is rate-limited
    const again = await POST(req({ ...PRESETS[0].brief, subject: "Someone else" }));
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toMatch(/^\d+$/);
    // …but the cached brief still loads instantly
    expect((await POST(req(PRESETS[0].brief))).headers.get("x-run-cache")).toBe("hit");
  });
});

describe("e2e: record live responses, then replay them with the network off", () => {
  it("replays a recorded run identically", async () => {
    const recorder: Record<string, unknown> = {};
    const seen: Seen = { qloo: [], llm: 0, injected429: true };
    const live = new QlooClient({ apiKey: "k", baseUrl: QLOO, mode: "live", cache: new MemoryCache(), fixtures: {}, recorder, fetchImpl: stubNetwork(seen) as unknown as typeof fetch });
    const recorded = await runTastemaker(must(PRESETS[1]).brief, { qloo: live, llm: new DeterministicLLM() });
    expect(recorded.sources).toEqual(["live"]);

    const offline = vi.fn(async () => {
      throw new Error("network is off");
    });
    const replay = new QlooClient({ mode: "replay", cache: new MemoryCache(), fixtures: recorder, fetchImpl: offline as unknown as typeof fetch });
    const replayed = await runTastemaker(must(PRESETS[1]).brief, { qloo: replay, llm: new DeterministicLLM() });
    expect(offline).not.toHaveBeenCalled();
    expect(replayed.sources).toEqual(["replay"]);
    // identical except for the provenance label on each receipt
    const unlabeled = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v: unknown) => (k === "source" ? undefined : v)));
    expect(unlabeled(replayed.grounded)).toEqual(unlabeled(recorded.grounded));
    expect(unlabeled(replayed.baseline)).toEqual(unlabeled(recorded.baseline));
    expect(replayed.grounded.receipts.every((r) => r.source === "replay")).toBe(true);
    expect(replayed.cities).toEqual(recorded.cities);
  });
});
