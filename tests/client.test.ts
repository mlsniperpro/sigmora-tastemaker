import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "@/lib/qloo/cache";
import { QlooClient } from "@/lib/qloo/client";
import { requestKey } from "@/lib/qloo/params";

const fresh = (o: ConstructorParameters<typeof QlooClient>[0] = {}) => new QlooClient({ cache: new MemoryCache(), fixtures: {}, ...o });

describe("QlooClient", () => {
  it("runs with zero credentials on the simulator and labels it", async () => {
    const r = await fresh().search("Tems", ["artist"]);
    expect(r.meta.source).toBe("simulated");
    expect(r.data.results[0]?.name).toBe("Tems");
  });

  it("prefers a recorded fixture over the simulator", async () => {
    const key = requestKey("/search", { query: "Tems", types: ["urn:entity:artist"], take: 5 });
    const fixtures = { [key]: { results: [{ name: "Tems", entity_id: "REAL-ID" }] } };
    const r = await fresh({ fixtures }).search("Tems", ["artist"]);
    expect(r.meta.source).toBe("replay");
    expect(r.data.results[0].entity_id).toBe("REAL-ID");
  });

  it("calls the hackathon host with X-Api-Key, caches, and records", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [{ name: "Rema", entity_id: "R1" }] })));
    const recorder: Record<string, unknown> = {};
    const c = fresh({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch, recorder });
    const a = await c.search("Rema");
    const b = await c.search("Rema");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://hackathon.api.qloo.com/search?query=Rema&take=5");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
    expect(a.meta.source).toBe("live");
    expect(b.meta.cached).toBe(true);
    expect(Object.keys(recorder)).toHaveLength(1);
  });

  it("falls back (and says why) when the live call fails in auto mode", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const r = await fresh({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch }).search("Tems");
    expect(r.meta.source).toBe("simulated");
    expect(r.meta.fallbackReason).toMatch(/429/);
  });

  it("throws in strict live mode", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(fresh({ apiKey: "k", mode: "live", fetchImpl: fetchImpl as unknown as typeof fetch }).search("x")).rejects.toThrow(/500/);
  });

  it("never sends the key outside the header", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    const r = await fresh({ apiKey: "secret-key", fetchImpl: fetchImpl as unknown as typeof fetch }).search("x");
    expect(JSON.stringify(r.meta)).not.toContain("secret-key");
  });
});
