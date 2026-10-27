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

describe("e2e: refused presets on a keyed deployment (audit 9)", () => {
  it("replay one simulated run per preset, label its permalink as a live-Qloo fallback, and keep it from real channels", async () => {
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_DAILY_CALL_CAP", "0");
    vi.stubEnv("SIGMORA_PUBLISH_MODE", "live");
    vi.stubEnv("SIGMORA_API_URL", "https://sigmora.example");
    vi.stubEnv("SIGMORA_API_TOKEN", "tok");
    vi.stubEnv("SIGMORA_OWNER_KEY", "kO9x2LmQp7zVb4nRt6yHw3sJd8fGc5aE");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", stubQloo());
    vi.resetModules();
    const { GET, POST } = await import("@/app/api/run/route");
    const { POST: ship } = await import("@/app/api/ship/route");
    const req = () => new Request("http://tm.example/api/run", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "5.5.7.1" }, body: JSON.stringify({ preset: "sports-club" }) });
    const first = must((await readStream(await POST(req()))).result, "first");
    const again = await POST(req());
    expect(again.headers.get("x-run-cache")).toBe("simulated");
    const second = await readStream(again);
    // The second refused click replays the first simulated run instead of simulating anew, still labelled as a fallback.
    expect(second.result?.id).toBe(first.id);
    expect((second.events.find((e) => e.type === "result") as Extract<RunEvent, { type: "result" }>).served?.from).toBe("simulated");
    const link = (await (await GET(new Request(`http://tm.example/api/run?id=${first.id}`))).json()) as { served?: { from: string; reason?: string } };
    expect(link.served).toMatchObject({ from: "simulated" });
    const shipReq = new Request("http://tm.example/api/ship", { method: "POST", headers: { "content-type": "application/json", "x-tastemaker-owner": "kO9x2LmQp7zVb4nRt6yHw3sJd8fGc5aE", "x-forwarded-for": "5.5.7.1" }, body: JSON.stringify({ runId: first.id, acceptFlagged: true }) });
    expect((await ship(shipReq)).status).toBe(409);
  }, 60_000);
});

describe("e2e: the owner running someone's shared ?b= brief (audit 14)", () => {
  it("never makes that run shippable to real channels, while the owner's own brief stays shippable", async () => {
    const owner = "kO9x2LmQp7zVb4nRt6yHw3sJd8fGc5aE";
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_RPS", "50");
    vi.stubEnv("SIGMORA_PUBLISH_MODE", "live");
    vi.stubEnv("SIGMORA_API_URL", "https://sigmora.example");
    vi.stubEnv("SIGMORA_API_TOKEN", "tok");
    vi.stubEnv("SIGMORA_OWNER_KEY", owner);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", stubQloo());
    vi.resetModules();
    const { POST } = await import("@/app/api/run/route");
    const { POST: ship } = await import("@/app/api/ship/route");
    // Two networks: each custom run reserves a network's whole daily share.
    const headers = (ip: string) => ({ "content-type": "application/json", "x-tastemaker-owner": owner, "x-forwarded-for": ip });
    const runOf = async (ip: string, body: unknown) =>
      must((await readStream(await POST(new Request("http://tm.example/api/run", { method: "POST", headers: headers(ip), body: JSON.stringify(body) })))).result, "result");
    const shipOf = (runId: string) => ship(new Request("http://tm.example/api/ship", { method: "POST", headers: headers("5.5.9.9"), body: JSON.stringify({ runId, acceptFlagged: true }) }));
    const shared = await runOf("5.5.9.1", { brief: { family: "music", subject: "Link Act", product: "single", goal: "Grow streams", seeds: ["Tems"], ages: ["25_to_29"] }, shared: true });
    expect((await shipOf(shared.id)).status).toBe(403);
    const own = await runOf("5.5.9.2", { brief: { family: "music", subject: "Own Act", product: "single", goal: "Grow streams", seeds: ["Rema"], ages: ["25_to_29"] } });
    // Past the owner check: it fails later only because the stub has no Sigmora host.
    expect((await shipOf(own.id)).status).not.toBe(403);
  }, 60_000);
});

describe("e2e: a judge's network on default budgets (audit 10)", () => {
  it("can audit the sample (cached for everyone after the day's first) and then its own plan", async () => {
    vi.stubEnv("QLOO_API_KEY", "qloo-secret");
    vi.stubEnv("QLOO_BASE_URL", QLOO);
    vi.stubEnv("QLOO_MODE", "live");
    vi.stubEnv("QLOO_RPS", "50");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", stubQloo());
    vi.resetModules();
    const { POST: audit } = await import("@/app/api/audit/route");
    const { AUDIT_SAMPLE, AUDIT_SAMPLE_AUDIENCE } = await import("@/lib/auditSample");
    const post = (text: string, ip = "6.1.2.3") =>
      new Request("http://tm.example/api/audit", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "tm.example" }, body: JSON.stringify({ text, ...AUDIT_SAMPLE_AUDIENCE }) });
    // The day's first visitor pays for the sample; everyone after gets it from the audit cache.
    expect((await audit(post(AUDIT_SAMPLE, "6.9.9.9"))).status).toBe(200);
    const sample = await audit(post(AUDIT_SAMPLE));
    expect(sample.status).toBe(200);
    expect(((await sample.json()) as { cached?: boolean }).cached).toBe(true);
    // An audit reserves 30 calls, not its worst case of 80, so the judge's own plan still fits their network's share.
    expect((await audit(post("Collab targets: Burna Boy, Ayra Starr, and Qorvax Blee\nBrand partners: Telfar"))).status).toBe(200);
    // And a second plan of theirs: with the worst case reserved up front, the first would have left no room for it.
    expect((await audit(post("Collab targets: Tems, Rema\nPodcast pitch: Zorvana Talks"))).status).toBe(200);
  }, 60_000);
});
