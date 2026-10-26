/**
 * Response cache for Qloo calls and finished runs. Two layers: an in-process
 * LRU bounded by entries and by approximate size (always on) and, when KV is
 * configured, Redis over REST so every instance shares it. The cache is an
 * optimisation: a KV failure is logged and the request proceeds uncached.
 */
import { KvRest, kvFromEnv } from "../kv";

export interface CacheStore {
  /** Resolves to undefined on a miss. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Like get, but tells a store error apart from a miss (stores that can fail implement it). */
  lookup?(key: string): Promise<{ value: unknown; failed: boolean }>;
}

/** Approximate in-memory size of a JSON-able value (UTF-16 code units × 2). */
// JSON.stringify returns undefined for undefined/functions, despite its declared type.
const approxBytes = (value: unknown) => ((JSON.stringify(value) as string | undefined)?.length ?? 0) * 2;

export class MemoryCache implements CacheStore {
  private readonly map = new Map<string, { value: unknown; expires: number; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.read(key));
  }

  private read(key: string): unknown {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < this.now()) {
      this.remove(key);
      return undefined;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.write(key, value, ttlSeconds);
    return Promise.resolve();
  }

  private write(key: string, value: unknown, ttlSeconds: number) {
    const bytes = approxBytes(value);
    if (bytes > this.maxBytes) return;
    this.remove(key);
    this.map.set(key, { value, expires: this.now() + ttlSeconds * 1000, bytes });
    this.bytes += bytes;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  private remove(key: string) {
    const e = this.map.get(key);
    if (!e) return;
    this.bytes -= e.bytes;
    this.map.delete(key);
  }

  get size() {
    return this.map.size;
  }

  get approxBytes() {
    return this.bytes;
  }
}

export class KvCache implements CacheStore {
  constructor(
    private readonly kv: KvRest,
    private readonly prefix = "tm:cache:",
  ) {}

  async get(key: string) {
    return (await this.lookup(key)).value;
  }

  async lookup(key: string): Promise<{ value: unknown; failed: boolean }> {
    try {
      const raw = await this.kv.cmd(["GET", this.prefix + key]);
      return { value: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined, failed: false };
    } catch (err) {
      console.warn(`[cache] KV get failed: ${(err as Error).message}`);
      return { value: undefined, failed: true };
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await this.kv.cmd(["SET", this.prefix + key, JSON.stringify(value), "EX", ttlSeconds]);
    } catch (err) {
      console.warn(`[cache] KV set failed: ${(err as Error).message}`);
    }
  }
}

/** Seconds a value read from a slower layer stays in the faster ones. */
export const BACKFILL_TTL = 60;

/** A miss on these keys (run results by id: permalinks, Ship) is remembered briefly, so random-id probes can't each cost a store read. */
const NEGATIVE_PREFIXES = ["result:"];
export const NEGATIVE_TTL_MS = 10_000;
const NEGATIVE_MAX = 5000;

export class LayeredCache implements CacheStore {
  private readonly misses = new Map<string, number>();
  constructor(
    private readonly layers: CacheStore[],
    private readonly now: () => number = () => performance.now(),
  ) {}
  async get(key: string) {
    const missedUntil = this.misses.get(key);
    if (missedUntil !== undefined && missedUntil > this.now()) return undefined;
    let failed = false;
    for (const [i, layer] of this.layers.entries()) {
      const r = layer.lookup ? await layer.lookup(key) : { value: await layer.get(key), failed: false };
      failed ||= r.failed;
      const v = r.value;
      if (v !== undefined) {
        this.misses.delete(key);
        // Backfill faster layers briefly: the value's real TTL lives in the slower layer, and a long backfill
        // would keep a short-lived value (a degraded run's 10 minutes) alive past it.
        await Promise.all(this.layers.slice(0, i).map((l) => l.set(key, v, BACKFILL_TTL)));
        return v;
      }
    }
    // Only a definitive miss is remembered: a store error (a KV blip) says nothing about the key.
    if (!failed && NEGATIVE_PREFIXES.some((p) => key.startsWith(p))) {
      if (this.misses.size >= NEGATIVE_MAX) this.misses.clear();
      this.misses.set(key, this.now() + NEGATIVE_TTL_MS);
    }
    return undefined;
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    this.misses.delete(key);
    await Promise.all(this.layers.map((l) => l.set(key, value, ttlSeconds)));
  }
}

let shared: CacheStore | undefined;
export function defaultCache(): CacheStore {
  if (!shared) {
    const kv = kvFromEnv();
    shared = new LayeredCache(kv ? [new MemoryCache(), new KvCache(kv)] : [new MemoryCache()]);
  }
  return shared;
}
