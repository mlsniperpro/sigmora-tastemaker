/**
 * Response cache for Qloo calls, keyed by the normalized request.
 *
 * Two layers: an in-process LRU (always on) and an optional Redis-over-REST
 * store (Upstash / Vercel KV compatible) when KV_REST_API_URL and
 * KV_REST_API_TOKEN are set. The REST store needs no SDK.
 */

export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export class MemoryCache implements CacheStore {
  private map = new Map<string, { value: unknown; expires: number }>();
  constructor(private readonly max = 500) {}

  async get(key: string) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    this.map.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

export class RestKvCache implements CacheStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly prefix = "tm:qloo:",
  ) {}

  private async cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`KV ${res.status}`);
    const body = (await res.json()) as { result?: unknown };
    return body.result;
  }

  async get(key: string) {
    try {
      const raw = await this.cmd(["GET", this.prefix + key]);
      return typeof raw === "string" ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await this.cmd(["SET", this.prefix + key, JSON.stringify(value), "EX", ttlSeconds]);
    } catch {
      // cache is best-effort
    }
  }
}

export class LayeredCache implements CacheStore {
  constructor(private readonly layers: CacheStore[]) {}
  async get(key: string) {
    for (let i = 0; i < this.layers.length; i++) {
      const v = await this.layers[i].get(key);
      if (v !== undefined) {
        // backfill faster layers
        await Promise.all(this.layers.slice(0, i).map((l) => l.set(key, v, 3600)));
        return v;
      }
    }
    return undefined;
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    await Promise.all(this.layers.map((l) => l.set(key, value, ttlSeconds)));
  }
}

let shared: CacheStore | undefined;
export function defaultCache(): CacheStore {
  if (shared) return shared;
  const layers: CacheStore[] = [new MemoryCache()];
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) layers.push(new RestKvCache(url, token));
  shared = new LayeredCache(layers);
  return shared;
}
