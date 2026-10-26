import { describe, it, vi, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { ConfigError, budgetProblems, loadConfig } from "@/lib/config";
import { KvCounter, MemoryCounter, ResilientCounter, incrDaily, incrPerMinute } from "@/lib/counter";
import { KvRest } from "@/lib/kv";
import { FREE_ROUTE_PER_MINUTE, UNMETERED_RUNS_PER_MINUTE, checkGuard, clientIp, floodGuard, ipKey, qlooBudget, unmeteredGuard } from "@/lib/guard";
import { sentJson } from "../must";

describe("MemoryCounter", () => {
  it("counts within a window and resets after it expires", async () => {
    let t = 0;
    const c = new MemoryCounter(100, () => t);
    expect(await c.incr("k", 60)).toBe(1);
    expect(await c.incr("k", 60)).toBe(2);
    t = 61_000;
    expect(await c.incr("k", 60)).toBe(1);
  });

  it("evicts the least recently updated key, never a busy long-lived count (audit 9)", async () => {
    const c = new MemoryCounter(3);
    await c.incr("day", 86_400, 480);
    for (let i = 0; i < 10; i++) {
      await c.incr(`ip:${String(i)}`, 86_400);
      await c.incr("day", 86_400, 0);
    }
    expect(await c.incr("day", 86_400, 0)).toBe(480);
  });

  test.prop([fc.array(fc.string({ maxLength: 6 }), { maxLength: 300 })])("stays within its size bound", async (keys) => {
    const c = new MemoryCounter(50);
    for (const k of keys) await c.incr(k, 60);
    expect(c.size).toBeLessThanOrEqual(50);
  });
});

describe("KvCounter", () => {
  it("creates the window with a TTL, then INCRBYs, in one pipeline call", async () => {
    const f = vi.fn(async () => Response.json([{ result: "OK" }, { result: 3 }]));
    const n = await new KvCounter(new KvRest("https://kv.example/", "tok", f)).incr("tm:k", 120);
    expect(n).toBe(3);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://kv.example/pipeline");
    expect(sentJson(init)).toEqual([
      ["SET", "tm:k", "0", "EX", 120, "NX"],
      ["INCRBY", "tm:k", 1],
    ]);
  });
  it("rejects a malformed KV reply instead of guessing", async () => {
    const f = vi.fn(async () => Response.json({ nope: true }));
    await expect(new KvCounter(new KvRest("https://kv.example", "tok", f as unknown as typeof fetch)).incr("k", 1)).rejects.toThrow();
  });
});

describe("ResilientCounter", () => {
  it("uses KV while it works and counts in-process (with a warning) when it doesn't", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let up = true;
    const kv = { incr: vi.fn(async () => (up ? 7 : Promise.reject(new Error("KV 503 on /pipeline")))) };
    const c = new ResilientCounter(kv);
    expect(await c.incr("k", 60)).toBe(7);
    up = false;
    expect(await c.incr("k", 60)).toBe(1);
    expect(await c.incr("k", 60)).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("window helpers", () => {
  it("key daily and per-minute windows by UTC date and minute", async () => {
    const keys: [string, number][] = [];
    const spy = { incr: async (k: string, ttl: number) => (keys.push([k, ttl]), 1) };
    const t = Date.parse("2026-10-24T23:59:30Z");
    await incrDaily(spy, "x", t);
    await incrPerMinute(spy, "y", t);
    expect(keys).toEqual([
      ["tm:x:2026-10-24", 93600],
      [`tm:y:${Math.floor(t / 60000)}`, 120],
    ]);
  });
});

describe("guard", () => {
  it("limits per IP per minute and lets other IPs through", async () => {
    const cfg = { perMinute: 2, perIpDaily: 100, dailyCap: 100 };
    const c = new MemoryCounter();
    const now = 0;
    expect((await checkGuard("a", cfg, c, { now })).ok).toBe(true);
    expect((await checkGuard("a", cfg, c, { now })).ok).toBe(true);
    const third = await checkGuard("a", cfg, c, { now });
    expect(third).toMatchObject({ ok: false, status: 429 });
    expect((await checkGuard("b", cfg, c, { now })).ok).toBe(true);
    expect((await checkGuard("a", cfg, c, { now: now + 60_000 })).ok).toBe(true);
  });
  it("enforces the daily cap across IPs; per-IP rejections don't spend it", async () => {
    const cfg = { perMinute: 2, perIpDaily: 100, dailyCap: 4 };
    const c = new MemoryCounter();
    for (const ip of ["a", "b", "a"]) expect((await checkGuard(ip, cfg, c, { now: 0 })).ok).toBe(true);
    expect(await checkGuard("a", cfg, c, { now: 0 })).toMatchObject({ ok: false, status: 429 });
    expect((await checkGuard("c", cfg, c, { now: 0 })).ok).toBe(true);
    expect(await checkGuard("d", cfg, c, { now: 0 })).toMatchObject({ ok: false, status: 503 });
  });
  it("lets presets skip the per-IP limit but not the daily cap", async () => {
    const c = new MemoryCounter();
    const cfg = { perMinute: 1, perIpDaily: 1, dailyCap: 3 };
    for (let i = 0; i < 3; i++) expect((await checkGuard("a", cfg, c, { now: 0, perIp: false })).ok).toBe(true);
    expect(await checkGuard("a", cfg, c, { now: 0, perIp: false })).toMatchObject({ ok: false, status: 503 });
  });

  it("caps one IP's runs per day, and fresh preset runs are not exempt", async () => {
    const c = new MemoryCounter();
    const cfg = { perMinute: 100, perIpDaily: 2, dailyCap: 100 };
    for (let m = 0; m < 2; m++) expect((await checkGuard("a", cfg, c, { now: m * 60_000 })).ok).toBe(true);
    expect(await checkGuard("a", cfg, c, { now: 5 * 60_000 })).toMatchObject({ ok: false, status: 429 });
    expect((await checkGuard("b", cfg, c, { now: 5 * 60_000 })).ok).toBe(true);
    expect((await checkGuard("a", cfg, c, { now: 86_400_000 })).ok).toBe(true);
  });

  it("reads the first forwarded IP", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("config", () => {
  it("re-parses only when a relevant variable changes", () => {
    const env: Record<string, string | undefined> = { QLOO_RPS: "3" };
    const a = loadConfig(env);
    expect(loadConfig(env)).toBe(a);
    env.QLOO_RPS = "5";
    expect(loadConfig(env).QLOO_RPS).toBe(5);
  });
  it("has safe defaults with an empty env", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ QLOO_MODE: "auto", QLOO_RPS: 4, SIGMORA_PUBLISH_MODE: "sandbox", RATE_LIMIT_PER_MINUTE: 4 });
    expect(c.QLOO_API_KEY).toBeUndefined();
  });
  it("coerces numbers and treats blank strings as unset", () => {
    const c = loadConfig({ QLOO_RPS: "5", QLOO_API_KEY: "  ", LLM_MODEL: " m " });
    expect(c.QLOO_RPS).toBe(5);
    expect(c.QLOO_API_KEY).toBeUndefined();
    expect(c.LLM_MODEL).toBe("m");
  });
  it("names bad variables without echoing their values", () => {
    const err = (() => {
      try {
        loadConfig({ QLOO_MODE: "yolo", QLOO_BASE_URL: "not a url secret-ish", QLOO_RPS: "-3" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err?.message).toMatch(/QLOO_MODE/);
    expect(err?.message).toMatch(/QLOO_RPS/);
    expect(err?.message).not.toContain("secret-ish");
  });
});

describe("blank env values", () => {
  it("count as unset: defaults apply instead of a crash or a zero budget", () => {
    const c = loadConfig({ SIGMORA_PUBLISH_MODE: "", QLOO_MODE: "  ", QLOO_DAILY_CALL_CAP: "", QLOO_BIAS_TRENDS: "", QLOO_API_KEY: " " });
    expect(c.SIGMORA_PUBLISH_MODE).toBe("sandbox");
    expect(c.QLOO_MODE).toBe("auto");
    expect(c.QLOO_DAILY_CALL_CAP).toBe(480);
    expect(c.QLOO_BIAS_TRENDS).toBe("medium");
    expect(c.QLOO_API_KEY).toBeUndefined();
  });
});

describe("client IP keys", () => {
  it("prefers the platform's header and keys IPv6 by its /64", () => {
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "5.6.7.8", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers())).toBe("unknown");
    expect(ipKey("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(ipKey("2001:db8:abcd:0012:ffff::1")).toBe("2001:db8:abcd:12::/64");
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(ipKey("[2001:db8:1:2::9]:443")).toBe("2001:db8:1:2::/64");
  });

  test.prop([fc.ipV6(), fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 4, maxLength: 4 })])(
    "every address in one /64 shares one key",
    (ip, tail) => {
      const key = ipKey(ip);
      if (!key.endsWith("::/64")) return; // fast-check also emits IPv4-embedded forms, which keep their own key
      const prefix = key.slice(0, -"::/64".length);
      expect(ipKey(`${prefix}:${tail.map((t) => t.toString(16)).join(":")}`)).toBe(key);
    },
  );
});

describe("qlooBudget", () => {
  it("draws cold presets from the presets' pool and custom runs from the custom pool and their network's share", () => {
    const env = { QLOO_DAILY_CALL_CAP: "1000", QLOO_PRESET_POOL: "300", QLOO_IP_DAILY_CALLS: "160", QLOO_PRESET_DAILY_CALLS: "240" };
    expect(qlooBudget({ presetId: "indie-release", fresh: false }, "1.2.3.4", env)).toEqual({ scopes: [{ key: "pool:presets", cap: 300 }, { key: "preset:indie-release", cap: 240 }] });
    expect(qlooBudget({ presetId: "indie-release", fresh: true }, "1.2.3.4", env)).toEqual({ scopes: [{ key: "pool:custom", cap: 700 }, { key: "ip:1.2.3.4", cap: 160 }] });
  });
});

describe("budget settings", () => {
  it("the defaults fit together", () => {
    expect(budgetProblems(loadConfig({}))).toEqual([]);
  });
  it("refuses settings that would refuse a kind of run all day, or let one network take the custom pool", () => {
    expect(() => loadConfig({ QLOO_DAILY_CALL_CAP: "300", QLOO_PRESET_POOL: "240" })).toThrow(/must cover one run/);
    expect(() => loadConfig({ QLOO_PRESET_POOL: "50" })).toThrow(/QLOO_PRESET_POOL \(50\) must cover one run/);
    expect(() => loadConfig({ QLOO_DAILY_CALL_CAP: "1000", QLOO_IP_DAILY_CALLS: "900" })).toThrow(/at most 1\/3 of the custom pool/);
    expect(budgetProblems(loadConfig({ QLOO_DAILY_CALL_CAP: "0" }))).toEqual([]);
  });
  test.prop([fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 10, max: 500 }), fc.integer({ min: 10, max: 2000 })])(
    "a config that loads always fits one run in every share it can reserve from",
    (cap, pool, estimate, ip) => {
      let c;
      try {
        c = loadConfig({ QLOO_DAILY_CALL_CAP: String(cap), QLOO_PRESET_POOL: String(pool), QLOO_RUN_ESTIMATE: String(estimate), QLOO_IP_DAILY_CALLS: String(ip) });
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        return;
      }
      if (c.QLOO_DAILY_CALL_CAP === 0) return;
      const customPool = c.QLOO_DAILY_CALL_CAP - c.QLOO_PRESET_POOL;
      expect(Math.min(customPool, c.QLOO_PRESET_POOL, c.QLOO_IP_DAILY_CALLS, c.QLOO_PRESET_DAILY_CALLS)).toBeGreaterThanOrEqual(c.QLOO_RUN_ESTIMATE);
      expect(c.QLOO_IP_DAILY_CALLS).toBeLessThanOrEqual(customPool);
    },
  );
});

describe("floodGuard", () => {
  it("lets a minute's worth of requests through, then 429s that network only", async () => {
    const at = Date.parse("2026-10-25T10:00:05Z");
    const req = (ip: string) => new Request("http://x/api/run?id=a", { headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < FREE_ROUTE_PER_MINUTE; i++) expect(await floodGuard(req("8.8.4.4"), at)).toBeUndefined();
    const refused = await floodGuard(req("8.8.4.4"), at);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("Retry-After")).toBe("55");
    expect(await floodGuard(req("8.8.8.8"), at)).toBeUndefined();
  });
});

describe("unmetered runs (audit 9)", () => {
  it("lets a network start a few unmetered runs a minute, then asks it to wait", async () => {
    const req = () => new Request("http://tm.example/api/run", { headers: { "x-forwarded-for": "9.8.7.6" } });
    const now = Date.UTC(2026, 9, 26, 12, 0, 5);
    for (let i = 0; i < UNMETERED_RUNS_PER_MINUTE; i++) expect(await unmeteredGuard(req(), now)).toBeUndefined();
    expect((await unmeteredGuard(req(), now))?.status).toBe(429);
    expect(await unmeteredGuard(req(), now + 60_000)).toBeUndefined();
  });
});
