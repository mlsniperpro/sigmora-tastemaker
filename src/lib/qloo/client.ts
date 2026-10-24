import type { z } from "zod";
import recorded from "../../../fixtures/qloo/recorded.json";
import { defaultCache, type CacheStore } from "./cache";
import { assertParams, requestKey, type QlooParams, type QlooPath } from "./params";
import { simulate } from "./sim/simulator";
import {
  CompareResponse,
  InsightsResponse,
  SearchResponse,
  entityUrn,
  type EntityType,
  type InsightsFilterType,
} from "./types";

export type QlooSource = "live" | "replay" | "simulated";
export type QlooMode = "auto" | "live" | "replay";

export interface QlooCallMeta {
  path: QlooPath;
  params: QlooParams;
  key: string;
  source: QlooSource;
  cached: boolean;
  latencyMs: number;
  /** Validation problems (only non-empty in production, where we don't throw). */
  problems: string[];
  /** Set when a live call failed and we fell back. */
  fallbackReason?: string;
}

export interface QlooCall<T> {
  data: T;
  meta: QlooCallMeta;
}

export interface QlooClientOptions {
  mode?: QlooMode;
  apiKey?: string;
  baseUrl?: string;
  cache?: CacheStore;
  fixtures?: Record<string, unknown>;
  /** Called after every call; the agent uses it to build the trace. */
  onCall?: (meta: QlooCallMeta) => void;
  /** When set, live responses are written here (fixture recording). */
  recorder?: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const HACKATHON_HOST = "https://hackathon.api.qloo.com";
const TTL = 60 * 60 * 24 * 7;

export class QlooClient {
  readonly mode: QlooMode;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly cache: CacheStore;
  private readonly fixtures: Record<string, unknown>;
  private readonly fetchImpl: typeof fetch;
  onCall?: (meta: QlooCallMeta) => void;

  constructor(private readonly opts: QlooClientOptions = {}) {
    this.apiKey = opts.apiKey;
    this.mode = opts.mode ?? "auto";
    this.baseUrl = (opts.baseUrl ?? HACKATHON_HOST).replace(/\/$/, "");
    this.cache = opts.cache ?? defaultCache();
    this.fixtures = opts.fixtures ?? (recorded as Record<string, unknown>);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onCall = opts.onCall;
  }

  /** Where the next call would be answered from, before fallbacks. */
  get primarySource(): QlooSource {
    if (this.mode !== "replay" && this.apiKey) return "live";
    return Object.keys(this.fixtures).length ? "replay" : "simulated";
  }

  async get<S extends z.ZodTypeAny>(path: QlooPath, params: QlooParams, schema: S): Promise<QlooCall<z.infer<S>>> {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
    const problems = assertParams(path, clean);
    const key = requestKey(path, clean);
    const started = Date.now();
    let source: QlooSource = "simulated";
    let raw: unknown;
    let cached = false;
    let fallbackReason: string | undefined;

    const wantLive = this.mode !== "replay" && !!this.apiKey;
    if (wantLive) {
      const hit = await this.cache.get(key);
      if (hit !== undefined) {
        raw = hit;
        source = "live";
        cached = true;
      } else {
        try {
          raw = await this.fetchLive(path, clean);
          source = "live";
          await this.cache.set(key, raw, TTL);
          if (this.opts.recorder) this.opts.recorder[key] = raw;
        } catch (err) {
          if (this.mode === "live") throw err;
          fallbackReason = err instanceof Error ? err.message : String(err);
        }
      }
    }
    if (raw === undefined && key in this.fixtures) {
      raw = this.fixtures[key];
      source = "replay";
    }
    if (raw === undefined) {
      raw = simulate(path, clean);
      source = "simulated";
    }

    const data = schema.parse(raw);
    const meta: QlooCallMeta = { path, params: clean, key, source, cached, latencyMs: Date.now() - started, problems, fallbackReason };
    this.onCall?.(meta);
    return { data, meta };
  }

  private async fetchLive(path: QlooPath, params: QlooParams): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 12000);
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: { "X-Api-Key": this.apiKey!, Accept: "application/json" },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Qloo ${res.status} on ${path}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- typed helpers -----------------------------------------------------

  search(query: string, types?: EntityType[], take = 5) {
    return this.get("/search", { query, types: types?.map(entityUrn), take }, SearchResponse);
  }

  entitiesById(ids: string[]) {
    return this.get("/entities", { entity_ids: ids }, SearchResponse);
  }

  entitiesByExternal(kind: "spotify" | "imdb", ids: string[]) {
    return this.get("/entities", { [`external.${kind}.ids`]: ids }, SearchResponse);
  }

  insights(filterType: InsightsFilterType, params: QlooParams) {
    return this.get("/v2/insights", { "filter.type": filterType, ...params }, InsightsResponse);
  }

  trending(type: EntityType, entityIds: string[]) {
    return this.get("/v2/trending", { "filter.type": entityUrn(type), "signal.interests.entities": entityIds }, InsightsResponse);
  }

  compare(a: string[], b: string[], take = 10) {
    return this.get("/v2/analysis/compare", { "a.signal.interests.entities": a, "b.signal.interests.entities": b, take }, CompareResponse);
  }

  tags(query: string, take = 10) {
    return this.get("/v2/tags", { "filter.query": query, "feature.semantic_search": true, take }, InsightsResponse);
  }
}

export function qlooFromEnv(overrides: Partial<QlooClientOptions> = {}): QlooClient {
  return new QlooClient({
    apiKey: process.env.QLOO_API_KEY || undefined,
    baseUrl: process.env.QLOO_BASE_URL || undefined,
    mode: (process.env.QLOO_MODE as QlooMode | undefined) ?? "auto",
    ...overrides,
  });
}
