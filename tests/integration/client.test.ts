/** QlooClient against a stubbed HTTP layer: the live path, its failure modes, and the labeled fallbacks. */
import { describe, expect, it, vi } from "vitest";
import { type Counter, MemoryCounter, incrDaily } from "@/lib/counter";
import { HttpError, TimeoutError, type RetryPolicy } from "@/lib/net";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient, type QlooClientOptions } from "@/lib/qloo/client";
import { QlooBudgetError, QlooDeadlineError, QlooSchemaError } from "@/lib/qloo/errors";
import { requestKey } from "@/lib/qloo/params";
import { must } from "../must";

const fastRetry: RetryPolicy = { retries: 2, baseMs: 1, maxMs: 5, sleep: async () => undefined };
const ok = (body: unknown) => Response.json(body);
const results = { results: [{ name: "Rema", entity_id: "R1" }] };

function client(fetchImpl?: (url: URL, init: RequestInit) => Promise<Response>, o: Partial<QlooClientOptions> = {}) {
  return new QlooClient({
    cache: new MemoryCache(),
    fixtures: {},
    retry: fastRetry,
    ...(fetchImpl ? { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch } : {}),
    ...o,
  });
}

describe("QlooClient: offline", () => {
  it("runs with zero credentials on the simulator and labels it", async () => {
    const r = await client().search("Tems", ["artist"]);
    expect(r.meta.source).toBe("simulated");
    expect(r.meta.fallbackReason).toBeUndefined();
    expect(r.data.results[0]?.name).toBe("Tems");
  });

  it("prefers a recorded fixture over the simulator", async () => {
    const key = requestKey("/search", { query: "Tems", types: ["urn:entity:artist"], take: 5 });
    const r = await client(undefined, { fixtures: { [key]: { results: [{ name: "Tems", entity_id: "REAL-ID" }] } } }).search("Tems", ["artist"]);
    expect(r.meta.source).toBe("replay");
    expect(r.data.results[0]?.entity_id).toBe("REAL-ID");
  });

  it("refuses a malformed fixture with a typed schema error", async () => {
    const key = requestKey("/search", { query: "x", take: 5 });
    await expect(client(undefined, { fixtures: { [key]: { results: [{ nope: 1 }] } } }).search("x")).rejects.toBeInstanceOf(QlooSchemaError);
  });
});

describe("QlooClient: live", () => {
  it("calls the hackathon host with X-Api-Key, caches, and records", async () => {
    const f = vi.fn(async () => ok(results));
    const recorder: Record<string, unknown> = {};
    const c = client(f, { recorder });
    const a = await c.search("Rema");
    const b = await c.search("Rema");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://hackathon.api.qloo.com/search?query=Rema&take=5");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
    expect(a.meta).toMatchObject({ source: "live", cached: false });
    expect(b.meta).toMatchObject({ source: "live", cached: true });
    expect(Object.keys(recorder)).toEqual([a.meta.key]);
  });

  it("retries a 429 (honouring Retry-After) and succeeds", async () => {
    let n = 0;
    const f = vi.fn(async () => (n++ === 0 ? new Response("slow", { status: 429, headers: { "retry-after": "0" } }) : ok(results)));
    const r = await client(f).search("Rema");
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.meta).toMatchObject({ source: "live" });
    expect(r.meta.fallbackReason).toBeUndefined();
  });

  it("after bounded retries, serves a recorded live response and says why", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const key = requestKey("/search", { query: "Tems", take: 5 });
    const r = await client(f, { fixtures: { [key]: results } }).search("Tems");
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.meta).toMatchObject({ source: "replay", fallbackReason: "Qloo 429 on /search" });
    expect(warn).toHaveBeenCalled();
  });

  it("never mixes simulator data into a live run: with no recording, the live error surfaces", async () => {
    const f = vi.fn(async () => new Response("rate limited", { status: 429 }));
    await expect(client(f).search("Tems")).rejects.toMatchObject({ name: "HttpError", status: 429 });
  });

  it("does not retry a 4xx that won't change", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(client(f).search("Tems")).rejects.toMatchObject({ status: 400 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("treats an unexpected live response shape as an error, not data", async () => {
    await expect(client(async () => ok({ results: "not a list" })).search("Tems")).rejects.toBeInstanceOf(QlooSchemaError);
    // A malformed 200 is neither cached nor recorded: the next call fetches again and gets the good reply.
    const cache = new MemoryCache();
    const recorder: Record<string, unknown> = {};
    let n = 0;
    const flaky = vi.fn(async () => (n++ === 0 ? ok({ results: "not a list" }) : ok(results)));
    await expect(client(flaky, { cache, recorder }).search("Tems")).rejects.toBeInstanceOf(QlooSchemaError);
    expect(Object.keys(recorder)).toEqual([]);
    const second = await client(flaky, { cache, recorder }).search("Tems");
    expect(second.meta.cached).toBe(false);
    expect(Object.keys(recorder)).toHaveLength(1);
  });

  it("enforces the per-run call budget, counting every attempt including retries", async () => {
    const f = vi.fn(async () => ok(results));
    const c = client(f, { runCallCap: 2 });
    await c.search("a");
    await c.search("b");
    await expect(c.search("c")).rejects.toBeInstanceOf(QlooBudgetError);
    expect(f).toHaveBeenCalledTimes(2);
    let n = 0;
    const flaky = vi.fn(async () => (n++ < 2 ? new Response("busy", { status: 503 }) : ok(results)));
    await expect(client(flaky, { runCallCap: 2 }).search("x")).rejects.toBeInstanceOf(QlooBudgetError);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("reserves budget before awaiting, so parallel calls can't overshoot the cap", async () => {
    const f = vi.fn(async () => ok(results));
    const c = client(f, { runCallCap: 3, daily: { counter: new MemoryCounter(), cap: 100 } });
    const settled = await Promise.allSettled(["a", "b", "c", "d", "e"].map((q) => c.search(q)));
    expect(f).toHaveBeenCalledTimes(3);
    expect(settled.filter((s) => s.status === "rejected")).toHaveLength(2);
  });

  it("enforces the shared daily budget across clients", async () => {
    const f = vi.fn(async () => ok(results));
    const daily = { counter: new MemoryCounter(), cap: 1 };
    await client(f, { daily }).search("a");
    await expect(client(f, { daily }).search("b")).rejects.toThrow(/Today's Qloo call budget/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reserves a job's calls atomically: concurrent jobs can't all start and then run dry", async () => {
    const f = vi.fn(async () => ok(results));
    const counter = new MemoryCounter();
    const daily = { counter, cap: 100 };
    const jobs = Array.from({ length: 5 }, () => client(f, { daily }));
    const admitted = await Promise.all(jobs.map((c) => c.reserve(40)));
    expect(admitted.filter(Boolean)).toHaveLength(2);
    // An admitted job's calls come out of its reservation, not the shared count.
    const [a] = jobs;
    await must(a).search("a");
    await must(a).search("b");
    expect(await incrDaily(counter, "qloo-calls", Date.now(), 0)).toBe(80);
    // What it didn't spend goes back, and a refused job took nothing.
    await must(a).release();
    expect(await incrDaily(counter, "qloo-calls", Date.now(), 0)).toBe(42);
    expect(await jobs[4]?.reserve(58)).toBe(true);
  });

  it("caps each share, keeps the preset and custom pools apart, and refunds every counter", async () => {
    const f = vi.fn(async () => ok(results));
    const counter = new MemoryCounter();
    const daily = { counter, cap: 400 };
    const custom = (ip: string) => ({ scopes: [{ key: "pool:custom", cap: 160 }, { key: `ip:${ip}`, cap: 160 }] });
    const preset = (id: string) => ({ scopes: [{ key: "pool:presets", cap: 240 }, { key: `preset:${id}`, cap: 160 }] });
    const n = (name: string) => incrDaily(counter, name, Date.now(), 0);
    // The presets spend their whole pool…
    for (const id of ["a", "a", "b"]) expect(await client(f, { daily }).reserve(80, preset(id))).toBe(true);
    expect(await client(f, { daily }).reserve(80, preset("c"))).toBe(false);
    // …and a preset's own share caps it (two cold runs a day).
    expect(await client(f, { daily }).reserve(80, preset("a"))).toBe(false);
    // Custom briefs still have their own pool, shared fairly: one network fills its share, another still gets in.
    const a = client(f, { daily });
    expect(await a.reserve(80, custom("1.1.1.1"))).toBe(true);
    expect(await client(f, { daily }).reserve(80, custom("1.1.1.1"))).toBe(true);
    expect(await client(f, { daily }).reserve(80, custom("2.2.2.2"))).toBe(false);
    // A refused reservation took nothing from any counter.
    expect([await n("qloo-calls"), await n("qloo-scope:pool:custom"), await n("qloo-scope:ip:2.2.2.2")]).toEqual([400, 160, 0]);
    // Releasing returns the unspent calls to every counter it took from.
    await a.search("x");
    await a.release();
    expect([await n("qloo-calls"), await n("qloo-scope:pool:custom"), await n("qloo-scope:ip:1.1.1.1")]).toEqual([321, 81, 81]);
  });

  it("charges calls past the reservation to the reserved shares too, so overruns can't eat another pool", async () => {
    const f = vi.fn(async () => ok(results));
    const counter = new MemoryCounter();
    const c = client(f, { daily: { counter, cap: 400 } });
    expect(await c.reserve(2, { scopes: [{ key: "pool:custom", cap: 3 }] })).toBe(true);
    await c.search("a");
    await c.search("b");
    // The third call is past the reservation: it is charged to the pool, which now has 3 of 3.
    await c.search("c");
    expect(await incrDaily(counter, "qloo-scope:pool:custom", Date.now(), 0)).toBe(3);
    await expect(c.search("d")).rejects.toBeInstanceOf(QlooBudgetError);
    // The refused call took nothing.
    expect([await incrDaily(counter, "qloo-calls", Date.now(), 0), await incrDaily(counter, "qloo-scope:pool:custom", Date.now(), 0)]).toEqual([3, 3]);
  });

  it("refuses a just-spent share again without asking the store, until a refund makes room", async () => {
    const f = vi.fn(async () => ok(results));
    const store = new MemoryCounter();
    const incr = vi.spyOn(store, "incr");
    const daily = { counter: store, cap: 400 };
    const pool = { scopes: [{ key: "pool:custom", cap: 100 }] };
    const a = client(f, { daily });
    expect(await a.reserve(80, pool)).toBe(true);
    expect(await client(f, { daily }).reserve(80, pool)).toBe(false);
    const before = incr.mock.calls.length;
    const refused = client(f, { daily });
    expect(await refused.reserve(80, pool)).toBe(false);
    expect(refused.refusedBy).toBe("pool:custom");
    expect(incr.mock.calls.length).toBe(before);
    // A refund to that share clears the memo: the next reservation is asked for real, and fits.
    await a.release();
    expect(await client(f, { daily }).reserve(80, pool)).toBe(true);
  });

  it("doesn't remember a refusal when a refund landed while it was being refused", async () => {
    const f = vi.fn(async () => ok(results));
    const store = new MemoryCounter();
    // One counter for every client (the refusal memo is per counter), with a race armed after A's reservation.
    let armed = false;
    const hook: { release?: () => Promise<void> } = {};
    const racing: Counter = {
      incr: async (k, ttl, by) => {
        const n = await store.incr(k, ttl, by);
        if (armed && k.includes("ip:1.1.1.1") && (by ?? 1) > 0) {
          armed = false;
          // B's count of the share is over the cap; A refunds right now, before B records the refusal.
          await hook.release?.();
        }
        return n;
      },
    };
    const daily = { counter: racing, cap: 400 };
    const share = { scopes: [{ key: "ip:1.1.1.1", cap: 80 }] };
    const a = client(f, { daily });
    expect(await a.reserve(80, share)).toBe(true);
    hook.release = () => a.release();
    armed = true;
    expect(await client(f, { daily }).reserve(80, share)).toBe(false);
    // The share is free again, and no stale memo refuses the next caller.
    expect(await client(f, { daily }).reserve(80, share)).toBe(true);
  });

  it("fails closed when the budget store is down: no run starts, nothing half-taken stays taken", async () => {
    const f = vi.fn(async () => ok(results));
    const store = new MemoryCounter();
    let down = false;
    const flaky: Counter = { incr: (k, ttl, by) => (down && k.includes("pool") ? Promise.reject(new Error("KV down")) : store.incr(k, ttl, by)) };
    const daily = { counter: flaky, cap: 400 };
    down = true;
    expect(await client(f, { daily }).reserve(80, { scopes: [{ key: "pool:custom", cap: 160 }] })).toBe(false);
    down = false;
    expect(await incrDaily(store, "qloo-calls", Date.now(), 0)).toBe(0);
    // A call past the reservation while the store is down is refused as a spent budget (the critic then degrades to unscored).
    const broken: Counter = { incr: () => Promise.reject(new Error("KV down")) };
    await expect(client(f, { daily: { counter: broken, cap: 400 } }).search("y")).rejects.toBeInstanceOf(QlooBudgetError);
  });

  it("gives unspent calls back to the day they were reserved from, across midnight", async () => {
    const f = vi.fn(async () => ok(results));
    const counter = new MemoryCounter();
    const daily = { counter, cap: 300 };
    const before = Date.parse("2026-10-25T23:59:30Z");
    vi.useFakeTimers({ toFake: ["Date"], now: before });
    try {
      const c = client(f, { daily });
      expect(await c.reserve(80)).toBe(true);
      vi.setSystemTime(Date.parse("2026-10-26T00:00:30Z"));
      await c.release();
      expect(await incrDaily(counter, "qloo-calls", before, 0)).toBe(0);
      // The new day was never pushed below zero, so it grants no extra budget.
      expect(await incrDaily(counter, "qloo-calls", Date.now(), 0)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends no call after its deadline, so a crowded Qloo phase can't outlast the route", async () => {
    const f = vi.fn(async () => ok(results));
    const c = client(f);
    c.setDeadline(Date.now() - 1);
    await expect(c.search("late")).rejects.toBeInstanceOf(QlooDeadlineError);
    expect(f).not.toHaveBeenCalled();
  });

  it("reserves nothing when it makes no live calls", async () => {
    const counter = new MemoryCounter();
    expect(await client(undefined, { daily: { counter, cap: 1 } }).reserve(500)).toBe(true);
    expect(await incrDaily(counter, "qloo-calls", Date.now(), 0)).toBe(0);
  });

  it("never puts the key in metadata, keys or error messages", async () => {
    const c = new QlooClient({ apiKey: "secret-key", cache: new MemoryCache(), fixtures: {}, retry: fastRetry, fetchImpl: (async () => new Response("x", { status: 503 })) as unknown as typeof fetch });
    const err = await c.search("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("secret-key");
    const okc = new QlooClient({ apiKey: "secret-key", cache: new MemoryCache(), fixtures: {}, fetchImpl: (async () => ok(results)) as unknown as typeof fetch });
    expect(JSON.stringify(await okc.search("x"))).not.toContain("secret-key");
  });

  it("times out a hung request with a typed error in strict live mode", async () => {
    const hang = (_u: URL, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await expect(client(hang, { mode: "live", timeoutMs: 15, retry: { ...fastRetry, retries: 1 } }).search("x")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("throws typed HTTP errors in strict live mode, even when a recording exists", async () => {
    const key = requestKey("/search", { query: "x", take: 5 });
    await expect(client(async () => new Response("no", { status: 500 }), { mode: "live", fixtures: { [key]: results } }).search("x")).rejects.toBeInstanceOf(HttpError);
  });

  it("shares one network call between identical requests in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = vi.fn(async () => {
      await gate;
      return ok(results);
    });
    const c = client(f);
    const both = Promise.all([c.search("Rema"), c.search("Rema")]);
    release();
    const [a, b] = await both;
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual(b.data);
  });

  it("applies host quirks before keying: set params sorted, no demographics on person queries", async () => {
    const f = vi.fn(async () => ok({ results: { entities: [] } }));
    const c = client(f);
    const a = await c.insights("urn:entity:artist", { "filter.results.entities": ["b", "a"] });
    const b = await c.insights("urn:entity:artist", { "filter.results.entities": ["a", "b"] });
    expect(a.meta.key).toBe(b.meta.key);
    expect(f).toHaveBeenCalledTimes(1);
    const person = await c.insights("urn:entity:person", { "signal.interests.entities": ["x"], "signal.demographics.age": ["35_and_younger"], "signal.demographics.gender": "female" });
    expect(person.meta.key).not.toMatch(/demographics/);
    const brand = await c.insights("urn:entity:brand", { "signal.interests.entities": ["x"], "signal.demographics.age": ["35_and_younger"] });
    expect(brand.meta.key).toMatch(/signal.demographics.age/);
  });

  it("notifies observers until they unsubscribe", async () => {
    const c = client();
    const seen: string[] = [];
    const stop = c.observe((m) => seen.push(m.path));
    await c.search("Tems");
    stop();
    await c.search("Rema");
    expect(seen).toEqual(["/search"]);
  });

  it("validates parameters before any network call", async () => {
    const f = vi.fn(async () => ok({}));
    await expect(client(f).insights("urn:entity:artist", { "filter.price_level.min": 2 })).rejects.toThrow(/not supported/);
    expect(f).not.toHaveBeenCalled();
  });
});
