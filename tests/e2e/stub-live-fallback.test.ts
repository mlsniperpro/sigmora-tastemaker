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

describe("e2e: a burst of clicks on one cold preset shares one run", () => {
  it("joins the run in flight instead of reserving budget for each request", async () => {
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_RPS", "50");
    // Room for exactly one cold run of this preset today.
    vi.stubEnv("QLOO_PRESET_DAILY_CALLS", "80");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", stubQloo());
    const { POST } = await import("@/app/api/run/route");
    const req = (ip: string) => new Request("http://tm.example/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ preset: "dtc-city" }) });
    const responses = await Promise.all(["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].map((ip) => POST(req(ip))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const results = await Promise.all(responses.map(async (r) => must((await readStream(r)).result, "result").id));
    expect(new Set(results).size).toBe(1);
  }, 60_000);
});

describe("e2e: live Qloo down for a preset with nothing recorded", () => {
  it("shows the preset on the labelled offline simulator, never a blank first screen", async () => {
    vi.stubEnv("QLOO_API_KEY", "a-wrong-key");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_RPS", "50");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Every live call fails, as with a wrong key or a host outage.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const { POST } = await import("@/app/api/run/route");
    const res = await POST(new Request("http://tm.example/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "5.5.5.9" }, body: JSON.stringify({ preset: "indie-release" }) }));
    const { events, result } = await readStream(res);
    const r = must(result, "result");
    expect(r.sources).toEqual(["simulated"]);
    expect(r.llm.scripted).toBe(true);
    const served = (events.find((e) => e.type === "result") as Extract<RunEvent, { type: "result" }>).served;
    expect(served?.from).toBe("simulated");
    expect(served?.reason).toMatch(/the live run failed/);
  }, 60_000);
});

describe("e2e: a refused cold preset with nothing recorded and no earlier run", () => {
  it("shows the preset on the labelled offline simulator, and its permalink opens", async () => {
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_DAILY_CALL_CAP", "0");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const qloo = stubQloo();
    vi.stubGlobal("fetch", qloo);
    // Fresh module state: the burst test above left dtc-city cached.
    vi.resetModules();
    const { GET, POST } = await import("@/app/api/run/route");
    const res = await POST(new Request("http://tm.example/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "5.5.6.1" }, body: JSON.stringify({ preset: "dtc-city" }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-run-cache")).toBe("simulated");
    const { events, result } = await readStream(res);
    const r = must(result, "result");
    // Every call simulated: never recorded or live answers mixed in under a "placeholder data" label.
    expect(r.sources).toEqual(["simulated"]);
    expect(r.qloo.replay).toBe(0);
    const served = (events.find((e) => e.type === "result") as Extract<RunEvent, { type: "result" }>).served;
    expect(served?.from).toBe("simulated");
    expect(served?.reason).toMatch(/a new live run was refused \(Today's Qloo budget/);
    expect(qloo).not.toHaveBeenCalled();
    const link = await GET(new Request(`http://tm.example/api/run?id=${r.id}`));
    expect(link.status).toBe(200);
  }, 60_000);
});

describe("e2e: a burst on one custom brief whose first caller is over its network's share", () => {
  it("lets one of the others lead a new admission, and the rest join that run", async () => {
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_RPS", "50");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", stubQloo());
    vi.resetModules();
    const { POST } = await import("@/app/api/run/route");
    const { budgetCounter, incrDaily } = await import("@/lib/counter");
    const { QlooClient } = await import("@/lib/qloo/client");
    await incrDaily(budgetCounter(), "qloo-scope:ip:7.7.7.1", Date.now(), 10_000);
    const reserve = vi.spyOn(QlooClient.prototype, "reserve");
    const brief = { family: "music", subject: "Burst Act", product: "single", goal: "Grow streams in Lagos", seeds: ["Tems"], ages: ["25_to_29"] };
    const req = (ip: string) => new Request("http://tm.example/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ brief }) });
    const responses = await Promise.all(["7.7.7.1", "7.7.7.2", "7.7.7.3", "7.7.7.4"].map((ip) => POST(req(ip))));
    expect(responses.map((r) => r.status)).toEqual([429, 200, 200, 200]);
    const ids = await Promise.all(responses.slice(1).map(async (r) => must((await readStream(r)).result, "result").id));
    expect(new Set(ids).size).toBe(1);
    // The refused leader's reservation and one new one: the other two waiters reserved nothing.
    expect(reserve).toHaveBeenCalledTimes(2);
  }, 60_000);
});
