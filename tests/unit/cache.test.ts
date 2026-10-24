import { describe, expect, vi } from "vitest";
import { fc, it } from "@fast-check/vitest";
import { KvRest } from "@/lib/kv";
import { KvCache, LayeredCache, MemoryCache } from "@/lib/qloo/cache";

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

  it.prop([fc.array(fc.tuple(fc.string({ maxLength: 4 }), fc.integer()), { maxLength: 200 }), fc.integer({ min: 1, max: 30 })])("never holds more than its bound and returns the latest write", async (writes, max) => {
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
      const [cmd, key, value] = JSON.parse(String(init.body)) as string[];
      if (cmd === "SET") store.set(key, value);
      return Response.json({ result: cmd === "GET" ? (store.get(key) ?? null) : "OK" });
    });
    const c = new KvCache(new KvRest("https://kv.example", "tok", f as unknown as typeof fetch), "p:");
    await c.set("k", { a: 1 }, 99);
    expect(await c.get("k")).toEqual({ a: 1 });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual(["SET", "p:k", '{"a":1}', "EX", 99]);
    expect(await c.get("missing")).toBeUndefined();
  });

  it("logs and degrades to a miss when KV is down (the cache is an optimisation)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const c = new KvCache(new KvRest("https://kv.example", "tok", (async () => new Response("down", { status: 500 })) as unknown as typeof fetch), "p:");
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
});
