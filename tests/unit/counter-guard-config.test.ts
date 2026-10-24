import { describe, it, vi, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { ConfigError, loadConfig } from "@/lib/config";
import { KvCounter, MemoryCounter, ResilientCounter, incrDaily, incrPerMinute, readDaily } from "@/lib/counter";
import { KvRest } from "@/lib/kv";
import { checkGuard, clientIp } from "@/lib/guard";
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

  it("refuses a run up front when today's Qloo budget can't cover a whole one", async () => {
    const c = new MemoryCounter();
    const cfg = { perMinute: 100, perIpDaily: 100, dailyCap: 100, qloo: { dailyCap: 300, runCap: 90 } };
    for (let i = 0; i < 210; i++) await incrDaily(c, "qloo-calls", 0);
    expect((await checkGuard("a", cfg, c, { now: 0 })).ok).toBe(true);
    await incrDaily(c, "qloo-calls", 0);
    const refused = await checkGuard("b", cfg, c, { now: 0 });
    expect(refused).toMatchObject({ ok: false, status: 503 });
    expect(refused.ok || refused.message).toMatch(/Qloo budget/);
    // Reading the budget never spends it, and a refusal counts no run.
    expect(await readDaily(c, "qloo-calls", 0)).toBe(211);
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
    expect(c.QLOO_DAILY_CALL_CAP).toBe(300);
    expect(c.QLOO_BIAS_TRENDS).toBe("medium");
    expect(c.QLOO_API_KEY).toBeUndefined();
  });
});
