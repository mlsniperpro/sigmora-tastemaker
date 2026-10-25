/**
 * A refused cold preset with no recording shows its last finished run, labelled
 * with why, through the real /api/run in live mode (global fetch plays the Qloo
 * host, answered by the simulator). In its own file so the route's module state
 * (caches, counters, throttle) starts empty.
 */
import { describe, expect, it, vi } from "vitest";
import type { RunEvent, RunResult } from "@/lib/agent/types";
import type { QlooPath } from "@/lib/qloo/params";
import { simulate } from "@/lib/qloo/sim/simulator";
import { must } from "../must";

const QLOO = "https://qloo.stub";

function stubQloo() {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.origin !== QLOO) return new Response("unexpected host", { status: 599 });
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    return Response.json(simulate(url.pathname as QlooPath, params));
  });
}

async function readStream(res: Response) {
  const events = (await res.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as RunEvent);
  return { events, result: (events.find((e) => e.type === "result") as { result: RunResult } | undefined)?.result };
}

describe("e2e: a refused cold preset shows its last finished run", () => {
  it("serves the last run, labelled with why, when the presets' budget is spent and there's no recording", async () => {
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_RPS", "50");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-26T09:00:05Z") });
    try {
      vi.stubGlobal("fetch", stubQloo());
      const { POST } = await import("@/app/api/run/route");
      const { budgetCounter, incrDaily } = await import("@/lib/counter");
      const req = () => new Request("http://tm.example/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" }, body: JSON.stringify({ preset: "sports-club" }) });
      const first = await readStream(await POST(req()));
      const original = must(first.result, "first run");
      // Two days later the brief's day-long pointer has expired, and today's presets pool is already spent.
      vi.setSystemTime(new Date("2026-10-28T09:00:05Z"));
      await incrDaily(budgetCounter(), "qloo-scope:pool:presets", Date.now(), 10_000);
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(res.headers.get("x-run-cache")).toBe("cache");
      const { events, result } = await readStream(res);
      expect(result?.id).toBe(original.id);
      const served = (events.find((e) => e.type === "result") as Extract<RunEvent, { type: "result" }>).served;
      expect(served?.from).toBe("cache");
      expect(served?.reason).toMatch(/a new live run was refused \(Today's Qloo budget/);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);
});
