/**
 * Fixed-window counters for rate limits and daily budgets. With KV
 * configured they live in Redis (shared by every instance, so request
 * handlers stay stateless); without KV, or while KV is down, they fall back
 * to a bounded in-process map.
 */
import { z } from "zod";
import { KvRest, kvFromEnv } from "./kv";

export interface Counter {
  /** Adds `by` (default 1; 0 reads) to `key` and returns the new count; the key expires after `ttlSeconds`. */
  incr(key: string, ttlSeconds: number, by?: number): Promise<number>;
}

export class MemoryCounter implements Counter {
  private readonly map = new Map<string, { n: number; expires: number }>();
  constructor(
    private readonly max = 20000,
    private readonly now: () => number = Date.now,
  ) {}

  incr(key: string, ttlSeconds: number, by = 1) {
    const t = this.now();
    const cur = this.map.get(key);
    const entry = cur && cur.expires > t ? cur : { n: 0, expires: t + ttlSeconds * 1000 };
    entry.n += by;
    this.map.set(key, entry);
    if (this.map.size > this.max) {
      for (const [k, v] of this.map) if (v.expires <= t) this.map.delete(k);
      // still too big: drop the oldest insertions
      for (const k of this.map.keys()) {
        if (this.map.size <= this.max) break;
        this.map.delete(k);
      }
    }
    return Promise.resolve(entry.n);
  }

  get size() {
    return this.map.size;
  }
}

const Count = z.coerce.number().int();

export class KvCounter implements Counter {
  constructor(private readonly kv: KvRest) {}

  async incr(key: string, ttlSeconds: number, by = 1) {
    // One round trip: create the window with its TTL if absent, then INCRBY (which keeps the TTL).
    const [, n] = await this.kv.pipeline([
      ["SET", key, "0", "EX", ttlSeconds, "NX"],
      ["INCRBY", key, by],
    ]);
    return Count.parse(n);
  }
}

/** KV first; if KV fails, count in-process instead (and say so) so limits stay enforced per instance. */
export class ResilientCounter implements Counter {
  constructor(
    private readonly primary: Counter,
    private readonly fallback: Counter = new MemoryCounter(),
  ) {}

  async incr(key: string, ttlSeconds: number, by = 1) {
    try {
      return await this.primary.incr(key, ttlSeconds, by);
    } catch (err) {
      console.warn(`[counter] KV unavailable, counting in-process: ${(err as Error).message}`);
      return this.fallback.incr(key, ttlSeconds, by);
    }
  }
}

const DAY_TTL = 60 * 60 * 26;

/** Count one event in the current UTC day's window. */
export function incrDaily(counter: Counter, name: string, now = Date.now()) {
  return counter.incr(`tm:${name}:${new Date(now).toISOString().slice(0, 10)}`, DAY_TTL);
}

/** Read the current UTC day's count without changing it. */
export function readDaily(counter: Counter, name: string, now = Date.now()) {
  return counter.incr(`tm:${name}:${new Date(now).toISOString().slice(0, 10)}`, DAY_TTL, 0);
}

/** Count one event in the current minute's window. */
export function incrPerMinute(counter: Counter, name: string, now = Date.now()) {
  return counter.incr(`tm:${name}:${Math.floor(now / 60000)}`, 120);
}

let shared: Counter | undefined;
export function defaultCounter(): Counter {
  if (!shared) {
    const kv = kvFromEnv();
    shared = kv ? new ResilientCounter(new KvCounter(kv)) : new MemoryCounter();
  }
  return shared;
}
