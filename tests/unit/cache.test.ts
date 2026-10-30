import { describe, it, vi, expect } from "vitest";
import { fc, test } from "@fast-check/vitest";
import { KvRest } from "@/lib/kv";
import { BACKFILL_TTL, KvCache, LayeredCache, MemoryCache, NEGATIVE_TTL_MS } from "@/lib/qloo/cache";
import { sentJson } from "../must";

describe("MemoryCache", () => {
  it("expires entries after their TTL", async () => {
    let t = 0;
    const c = new MemoryCache(10, () => t);
    await c.set("k", 1, 10);
    expect(await c.get("k")).toBe(1);
    t = 10_001;
    expect(await c.get("k")).toBeUndefined();
  });

  it("evicts the least recently used entry", async () => {
    const c = new MemoryCache(2);
    await c.set("a", 1, 60);
    await c.set("b", 2, 60);
    await c.get("a");
    await c.set("c", 3, 60);
    expect(await c.get("a")).toBe(1);
    expect(await c.get("b")).toBeUndefined();
  });

  test.prop([fc.array(fc.tuple(fc.string({ maxLength: 4 }), fc.integer()), { maxLength: 200 }), fc.integer({ min: 1, max: 30 })])("never holds more than its bound and returns the latest write", async (writes, max) => {
    const c = new MemoryCache(max);
    const last = new Map<string, number>();
    for (const [k, v] of writes) {
      await c.set(k, v, 60);
      last.set(k, v);
    }
    expect(c.size).toBeLessThanOrEqual(max);
    for (const [k, v] of last) {
      const got = await c.get(k);
      expect(got === undefined || got === v).toBe(true);
    }
  });
});

describe("KvCache", () => {
  it("round-trips JSON through GET/SET with a TTL and a key prefix", async () => {
    const store = new Map<string, string>();
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const [cmd, key = "", value = ""] = sentJson(init) as string[];
      if (cmd === "SET") store.set(key, value);
      return Response.json({ result: cmd === "GET" ? (store.get(key) ?? null) : "OK" });
    });
    const c = new KvCache(new KvRest("https://kv.example", "tok", f as unknown as typeof fetch), "p:");
    await c.set("k", { a: 1 }, 99);
    expect(await c.get("k")).toEqual({ a: 1 });
    expect(sentJson((f.mock.calls[0] as unknown as [string, RequestInit])[1])).toEqual(["SET", "p:k", '{"a":1}', "EX", 99]);
    expect(await c.get("missing")).toBeUndefined();
  });

  it("logs and degrades to a miss when KV is down (the cache is an optimisation)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const c = new KvCache(new KvRest("https://kv.example", "tok", async () => new Response("down", { status: 500 })), "p:");
    expect(await c.get("k")).toBeUndefined();
    await expect(c.set("k", 1, 1)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("MemoryCache size bound", () => {
  it("evicts the oldest entries to stay under its byte budget and skips values bigger than the budget", async () => {
    const c = new MemoryCache(1000, Date.now, 1000);
    for (let i = 0; i < 10; i++) await c.set(`k${i}`, "x".repeat(100), 60);
    expect(c.approxBytes).toBeLessThanOrEqual(1000);
    expect(await c.get("k9")).toBeDefined();
    expect(await c.get("k0")).toBeUndefined();
    await c.set("huge", "y".repeat(5000), 60);
    expect(await c.get("huge")).toBeUndefined();
  });
});

describe("LayeredCache", () => {
  it("reads through to slower layers and backfills faster ones", async () => {
    const fast = new MemoryCache();
    const slow = new MemoryCache();
    await slow.set("k", "v", 60);
    const c = new LayeredCache([fast, slow]);
    expect(await c.get("k")).toBe("v");
    expect(await fast.get("k")).toBe("v");
  });

  it("backfills only briefly, so a short-lived value can't outlive its TTL in the fast layer", async () => {
    let t = 0;
    const fast = new MemoryCache(10, () => t);
    const slow = new MemoryCache(10, () => t);
    await slow.set("k", "degraded", 600);
    await new LayeredCache([fast, slow]).get("k");
    t = (BACKFILL_TTL + 1) * 1000;
    expect(await fast.get("k")).toBeUndefined();
    t = 601_000;
    expect(await new LayeredCache([fast, slow]).get("k")).toBeUndefined();
  });

  it("remembers a run-result miss briefly, so random-id probes don't each reach the store", async () => {
    let t = 0;
    const slow = new MemoryCache();
    const get = vi.spyOn(slow, "get");
    const c = new LayeredCache([slow], () => t);
    expect(await c.get("result:v5:nope")).toBeUndefined();
    expect(await c.get("result:v5:nope")).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
    // Other keys are always asked (a brief's pointer may appear any moment from another instance).
    await c.get("run:v5:x");
    await c.get("run:v5:x");
    expect(get).toHaveBeenCalledTimes(3);
    // Setting the key clears the miss at once; and a miss expires on its own.
    await c.set("result:v5:nope", "v", 60);
    expect(await c.get("result:v5:nope")).toBe("v");
    expect(await c.get("result:v5:gone")).toBeUndefined();
    t = NEGATIVE_TTL_MS + 1;
    await slow.set("result:v5:gone", "later", 60);
    expect(await c.get("result:v5:gone")).toBe("later");
  });

  it("never remembers a store error as a miss: the next read after a KV blip reaches the store", async () => {
    let calls = 0;
    const f = async () => (++calls === 1 ? new Response("down", { status: 503 }) : Response.json({ result: JSON.stringify({ ok: 1 }) }));
    const c = new LayeredCache([new MemoryCache(), new KvCache(new KvRest("https://kv.example", "tok", f), "p:")], () => 0);
    expect(await c.get("result:v5:abc")).toBeUndefined();
    expect(await c.get("result:v5:abc")).toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });
});
