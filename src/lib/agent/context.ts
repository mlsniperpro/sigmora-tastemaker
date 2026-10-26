/**
 * Shared state for one agent run (or one taste check): the resolved audience
 * signal, Qloo's candidate pool per role, trend readings, and memos so the
 * critic never re-resolves or re-scores an entity it has already seen.
 */
import { loadConfig } from "../config";
import type { QlooClient, QlooSource } from "../qloo/client";
import type { QlooParams } from "../qloo/params";
import { isQlooStop } from "../qloo/errors";
import { AGE_BUCKETS, explainabilityOf, latestTrend, type Entity, type EntityType } from "../qloo/types";
import type { Candidate } from "../llm/types";
import { FADING_BELOW } from "../vocab";
import { ROLE_SPEC, ROLES, type Brief, type PickType, type Role } from "./brief";
import type { Driver } from "./types";
import { isTitlePart, normName, sameName } from "./util";

/** Entity types whose titles carry subtitles, where a plan may name just the title or the subtitle. */
const TITLED: ReadonlySet<string> = new Set(["movie", "tv_show", "podcast", "video_game", "book"]);

/** Types /v2/trending takes as filter.type (its documented enum) among the ones we pick. */
export const TREND_TYPES: readonly EntityType[] = ["artist", "brand", "movie", "person", "place", "podcast", "tv_show"];
/** Trend readings are fetched for this many top candidates per fading-checked role (one /v2/trending call each; the grounding shows 6). */
export const TREND_POOL_TOP = 6;
/** Weeks of /v2/trending history asked for; the newest point is the reading. */
export const TREND_WEEKS = 6;

/** A Qloo-ranked candidate; `key` is the request that ranked it. */
export type RankedCandidate = Candidate & { entityId: string; key?: string; lat?: number; lon?: number };

export interface CriticSettings {
  /** A pick fails below this fraction of the role's median top-candidate affinity. */
  missRatio: number;
  /** Absolute affinity floor for a pass. */
  minAffinity: number;
  /**
   * A reference is fading when the newest /v2/trending point's
   * `population_percent_delta` is below this. Provisional: the docs give the
   * field's type and an example (1.15) but no scale, so the bar is re-set once
   * a live recording exists.
   */
  fadingBelow: number;
}

export const DEFAULT_CRITIC: CriticSettings = { missRatio: 0.7, minAffinity: 0.25, fadingBelow: FADING_BELOW };

/** Who the plan is for. */
export interface Audience {
  ages: Brief["ages"];
  gender?: Brief["gender"];
  /** A fixed market: the plan's city must be this one, and venues must be in it. */
  targetCity?: string;
}

export const audienceOf = (b: Brief): Audience => ({ ages: b.ages, gender: b.gender, targetCity: b.targetCity });

export interface Score {
  affinity: number;
  drivers: Driver[];
  key: string;
  source: QlooSource;
  /** Qloo's `query.explainability.warning`: it couldn't compute a driver split for this score (drivers stay empty). */
  explainabilityWarning?: string;
}

export interface Resolved {
  name: string;
  role: Role;
  type: PickType;
  entityId?: string;
  calls: string[];
  source?: QlooSource;
  /** Unresolved for this role, but Qloo has it under another type. */
  filedAs?: string;
  /** Resolved to a Qloo entity whose full title contains the name (the receipt says which). */
  matchedAs?: string;
}

/** How strongly candidate discovery leans toward trending entities (Qloo's bias.trends); "off" sends nothing. */
export type TrendBias = "off" | "low" | "medium" | "high";

/** How candidate pools are discovered (never how picks are scored). */
export interface Discovery {
  trendBias: TrendBias;
  /** diversify.by=subtype on the taste-vocabulary call (urn:tag), the only place the docs allow `subtype`. */
  diversify: boolean;
}

export const discoveryFromConfig = (): Discovery => {
  const c = loadConfig();
  return { trendBias: c.QLOO_BIAS_TRENDS, diversify: c.QLOO_DIVERSIFY === "on" };
};

export interface Ctx extends CriticSettings {
  audience: Audience;
  discovery: Discovery;
  qloo: QlooClient;
  seedIds: string[];
  seedNames: Map<string, string>;
  tagIds: string[];
  candidates: Partial<Record<Role, RankedCandidate[]>>;
  /** Newest population_percent_delta per entity; undefined = asked, but Qloo had no series for it. */
  trends: Map<string, number | undefined>;
  /** Entities a scoring call (filter.results.entities) asked about and Qloo left out: the request key that omitted them. */
  omitted: Map<string, string>;
  /** Critic memos for the run: affinity per entity, and resolution per role + name. */
  scores: Map<string, Score>;
  resolved: Map<string, Resolved>;
  /**
   * Venue-in-city checks, keyed by inCityKey(city, entity id): whether Qloo's location filter returns it there,
   * or why the check failed (e.g. a 400 when Qloo finds no locality for the city), so it isn't re-asked every pass.
   */
  inCity: Map<string, InCityCheck>;
  /** Launch city, when known; venues must be in it. */
  city?: string;
  /**
   * Set once any of this job's Qloo answers came from the offline simulator. Its numbers are placeholders,
   * so text the agent writes (trace details, replacement reasons) then names no affinity, score or verdict count.
   */
  sim: SimulatedWatch;
}

/** Watches a job's Qloo calls for simulated answers (shared by the run and its Ctx). */
export interface SimulatedWatch {
  on: boolean;
}

/** A watch that starts on when the client can only simulate, and turns on at the first simulated answer. Returns it and the unsubscribe. */
export function watchSimulated(qloo: QlooClient): { sim: SimulatedWatch; stop: () => void } {
  const sim: SimulatedWatch = { on: qloo.primarySource === "simulated" };
  const stop = qloo.observe((m) => {
    if (m.source === "simulated") sim.on = true;
  });
  return { sim, stop };
}

export type InCityCheck = { ok: boolean; key: string } | { error: string };

export const inCityKey = (city: string, entityId: string) => `${normName(city)}|${entityId}`;

export interface Seed {
  name: string;
  entityId?: string;
  type?: string;
  matched?: string;
}

/**
 * signal.demographics.age values. The docs' enum accepts the fine buckets the
 * brief uses (24_and_younger … 55_and_older), so they are sent as they are,
 * de-duplicated and in bucket order, rather than coarsened.
 */
export function signalAges(ages: readonly string[]): string[] {
  const wanted = new Set(ages);
  return AGE_BUCKETS.filter((b) => wanted.has(b));
}

/**
 * urn:demographics answers one row per input signal (each seed entity, each tag:
 * https://docs.qloo.com/reference/demographics-use-case). The audience is all
 * of them, so each bucket is the mean over the rows that carry it.
 */
export function aggregateDemographics(rows: readonly { query: { age?: Record<string, number>; gender?: Record<string, number> } }[]): {
  age: { bucket: string; value: number }[];
  gender: { bucket: string; value: number }[];
} {
  const mean = (pick: (r: (typeof rows)[number]) => Record<string, number> | undefined, order?: readonly string[]) => {
    const sums = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      for (const [k, v] of Object.entries(pick(r) ?? {})) {
        if (!Number.isFinite(v)) continue;
        const s = sums.get(k) ?? { sum: 0, n: 0 };
        sums.set(k, { sum: s.sum + v, n: s.n + 1 });
      }
    }
    const keys = order ? order.filter((k) => sums.has(k)) : [...sums.keys()];
    return keys.flatMap((bucket) => {
      const s = sums.get(bucket);
      return s ? [{ bucket, value: s.sum / s.n }] : [];
    });
  };
  return { age: mean((r) => r.query.age, AGE_BUCKETS), gender: mean((r) => r.query.gender) };
}

/** The audience signal every insights call is conditioned on. */
export function signalFor(ctx: Pick<Ctx, "audience" | "seedIds" | "tagIds">): QlooParams {
  return {
    "signal.interests.entities": ctx.seedIds,
    "signal.interests.tags": ctx.tagIds,
    "signal.demographics.age": signalAges(ctx.audience.ages),
    "signal.demographics.gender": ctx.audience.gender,
  };
}

/** True when a reading exists and is below the fading threshold. */
export const isFading = (ctx: Pick<Ctx, "trends" | "fadingBelow">, entityId: string) => (ctx.trends.get(entityId) ?? 0) < ctx.fadingBelow;

/** A ranked candidate, or none when Qloo returned the entity without an affinity (no score is ever made up). */
export function toCandidate(e: Entity, type: PickType, key?: string): RankedCandidate[] {
  const affinity = e.query?.affinity;
  return typeof affinity === "number" ? [{ name: e.name, type, affinity, entityId: e.entity_id, key }] : [];
}

export function entityTypesOf(e: Entity): string[] {
  return [e.subtype, ...(e.types ?? [])].filter((t): t is string => !!t).map((t) => t.replace("urn:entity:", ""));
}

/** The type to score a search hit as: the searched type, unless the hit is clearly another type the role allows. */
export function resolvedType(role: Role, searched: PickType, hit: Entity): PickType {
  const hitTypes = entityTypesOf(hit);
  if (hitTypes.includes(searched)) return searched;
  return ROLE_SPEC[role].types.find((t) => hitTypes.includes(t)) ?? searched;
}

/**
 * Look a name up in Qloo. `acceptTop` takes the best hit when no exact name
 * matches (for user-typed seeds and cities); the critic never does, because
 * search is fuzzy and returns *something* for invented names.
 */
export async function resolveByName(qloo: QlooClient, name: string, opts: { types?: readonly EntityType[]; take?: number; acceptTop?: boolean; titlePart?: boolean } = {}) {
  const r = await qloo.search(name, opts.types, opts.take ?? 5);
  const exact = r.data.results.find((e) => sameName(e.name, name));
  // `titlePart`: also accept a hit whose title contains the whole name ("Wakanda Forever" → "Black Panther: Wakanda Forever").
  // Only titled media have subtitles; a person, brand, place or artist never matches on part of a name.
  const part = exact || !opts.titlePart ? undefined : r.data.results.find((e) => entityTypesOf(e).some((t) => TITLED.has(t)) && isTitlePart(name, e.name));
  const hit = exact ?? part ?? (opts.acceptTop ? r.data.results[0] : undefined);
  return { hit, partOf: part?.name, key: r.meta.key, source: r.meta.source };
}

export function makeCtx(audience: Audience, qloo: QlooClient, seeds: Seed[], settings: Partial<CriticSettings> & { discovery?: Discovery; sim?: SimulatedWatch } = {}): Ctx {
  const resolved = seeds.flatMap((s) => (s.entityId ? [{ id: s.entityId, name: s.name }] : []));
  return {
    ...DEFAULT_CRITIC,
    ...settings,
    discovery: settings.discovery ?? { trendBias: "off", diversify: false },
    audience,
    qloo,
    seedIds: [...new Set(resolved.map((s) => s.id))],
    seedNames: new Map(resolved.map((s) => [s.id, s.name])),
    tagIds: [],
    candidates: {},
    trends: new Map(),
    omitted: new Map(),
    scores: new Map(),
    resolved: new Map(),
    inCity: new Map(),
    sim: settings.sim ?? { on: qloo.primarySource === "simulated" },
  };
}

export class NoSeedError extends Error {
  constructor() {
    super("None of the seeds resolved to a Qloo entity; try different names.");
    this.name = "NoSeedError";
  }
}

const SPOTIFY = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{10,30})(?:[/?#]|$)/;
const IMDB = /^https:\/\/(?:www\.|m\.)?imdb\.com\/(?:title|name)\/((?:tt|nm)\d{5,10})(?:[/?#]|$)/;

/** Pure: pull catalog IDs out of pasted links. Links are parsed, never fetched. */
export function parseSeedLinks(links: readonly string[]): { spotify: string[]; imdb: string[] } {
  const spotify: string[] = [];
  const imdb: string[] = [];
  for (const l of links) {
    const sp = SPOTIFY.exec(l)?.[1];
    if (sp) spotify.push(sp);
    const im = IMDB.exec(l)?.[1];
    if (im) imdb.push(im);
  }
  return { spotify: [...new Set(spotify)], imdb: [...new Set(imdb)] };
}

/**
 * Seeds from pasted catalog links. A failed lookup (a 400, a 5xx, a malformed reply) leaves the links
 * unresolved, like an id Qloo doesn't know: the brief's names still seed the run, and if none resolve the
 * run says so (NoSeedError). Only a budget or deadline stop ends it.
 */
async function resolveLinks(qloo: QlooClient, kind: "spotify" | "imdb", ids: string[]): Promise<Seed[]> {
  if (!ids.length) return [];
  const r = await qloo.entitiesByExternal(kind, ids).catch((err: unknown) => {
    if (isQlooStop(err)) throw err;
    console.warn(`[qloo] ${kind} link lookup failed, using the brief's names: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  });
  if (!r) return ids.map((id) => ({ name: `${kind}:${id}` }));
  if (!r.data.results.length) return ids.map((id) => ({ name: `${kind}:${id}` }));
  return r.data.results.map((e) => ({ name: e.name, entityId: e.entity_id, type: entityTypesOf(e)[0], matched: e.name }));
}

export async function resolveSeeds(qloo: QlooClient, seeds: Pick<Brief, "seeds" | "seedLinks">): Promise<Seed[]> {
  const links = parseSeedLinks(seeds.seedLinks);
  const groups = await Promise.all([
    resolveLinks(qloo, "spotify", links.spotify),
    resolveLinks(qloo, "imdb", links.imdb),
    ...seeds.seeds.map(async (name): Promise<Seed[]> => {
      const { hit } = await resolveByName(qloo, name, { acceptTop: true });
      return [{ name, entityId: hit?.entity_id, type: hit ? entityTypesOf(hit)[0] : undefined, matched: hit?.name }];
    }),
  ]);
  // A link and a name can resolve to the same entity: keep the first (links come first).
  const seen = new Set<string>();
  const all = groups.flat().filter((x) => {
    if (!x.entityId) return true;
    if (seen.has(x.entityId)) return false;
    seen.add(x.entityId);
    return true;
  });
  if (!all.some((x) => x.entityId)) throw new NoSeedError();
  return all;
}

/** Types where timing matters (hooks, collabs, pitches): discovery leans toward what's rising. */
const TREND_BIASED: readonly PickType[] = ["artist", "tv_show", "movie", "podcast"];
export const DIVERSIFY_TAKE = 5;

/**
 * Extra parameters for candidate-discovery calls (never for the critic's
 * scoring calls, which must measure plain affinity): bias.trends on
 * timing-sensitive types.
 *
 * No diversify.by on entities: the docs allow `subtype` on urn:tag only, and
 * the geocode groupings (properties.geocode.city / metro) don't apply to
 * brands, while venue discovery is already confined to one city, where a
 * per-city cap would only cut the pool to DIVERSIFY_TAKE.
 */
export function discoveryParams(type: PickType, d: Discovery): QlooParams {
  return TREND_BIASED.includes(type) && d.trendBias !== "off" ? { "bias.trends": d.trendBias } : {};
}

/** The taste-vocabulary call (urn:tag): at most DIVERSIFY_TAKE tags per tag subtype, so one subtype can't fill the list. */
export function tagDiscoveryParams(d: Discovery): QlooParams {
  return d.diversify ? { "diversify.by": "subtype", "diversify.take": DIVERSIFY_TAKE } : {};
}

/** The urn:tag signal: interests only (the docs list no signal.demographics.* for tags). */
export function tagSignalFor(ctx: Pick<Ctx, "seedIds" | "tagIds">): QlooParams {
  return { "signal.interests.entities": ctx.seedIds, "signal.interests.tags": ctx.tagIds };
}

/**
 * The critic's scoring call: plain affinity plus explainability for the given
 * entities, recorded in ctx.scores. Returns the entities Qloo scored.
 */
export async function scoreEntities(ctx: Ctx, type: PickType, ids: readonly string[]): Promise<Entity[]> {
  const res = await ctx.qloo.insights(`urn:entity:${type as EntityType}`, {
    ...signalFor(ctx),
    "filter.results.entities": [...ids],
    "feature.explainability": true,
    take: ids.length,
  });
  const entities = res.data.results.entities ?? [];
  // Asked for by id and left out: Qloo doesn't rank it for this audience (a miss), unlike a reply without an affinity.
  const returned = new Set(entities.map((e) => e.entity_id));
  for (const id of ids) if (!returned.has(id)) ctx.omitted.set(id, res.meta.key);
  for (const e of entities) {
    const affinity = e.query?.affinity;
    // No affinity in the reply means no score: the pick stays "unscored" rather than failing on a made-up 0.
    if (typeof affinity !== "number") continue;
    const ex = explainabilityOf(e.query?.explainability);
    ctx.scores.set(e.entity_id, {
      affinity,
      drivers: ex.drivers.map((d) => ({ name: d.name ?? ctx.seedNames.get(d.entity_id ?? "") ?? d.entity_id ?? "signal", score: d.score })),
      key: res.meta.key,
      source: res.meta.source,
      ...(ex.warning ? { explainabilityWarning: ex.warning } : {}),
    });
  }
  return entities;
}

/** The culture-map roles and the entity types they draw from. */
const CULTURE_ROLES: readonly Role[] = ROLES.filter((r) => r !== "venue" && r !== "city");

export interface Culture {
  /** The types that loaded, with their ranked candidates. */
  lists: (readonly [PickType, RankedCandidate[]])[];
  /** One line per type whose call failed ("tv_show: Qloo 500 on /v2/insights"); those roles have a smaller (or no) pool. */
  failures: string[];
}

/**
 * Load Qloo's ranked candidates for the given roles (all culture-map roles by
 * default), one insights call per type. A failed type is reported, not
 * thrown, so one bad call can't sink the run; only when every type fails
 * (or the run's budget/time stop hits) does it throw.
 */
export async function loadCulture(ctx: Ctx, roles: readonly Role[] = CULTURE_ROLES): Promise<Culture> {
  const wanted = roles.filter((r) => CULTURE_ROLES.includes(r));
  const types = [...new Set(wanted.flatMap((r) => ROLE_SPEC[r].types))];
  const settled = await Promise.allSettled(
    types.map(async (t) => {
      const params = discoveryParams(t, ctx.discovery);
      const r = await ctx.qloo.insights(`urn:entity:${t as EntityType}`, { ...signalFor(ctx), ...params, take: 10 });
      const found = (r.data.results.entities ?? []).flatMap((e) => toCandidate(e, t, r.meta.key));
      if (!params["bias.trends"] || !found.length) return [t, found] as const;
      // bias.trends picks *which* entities to consider; the pass bar must still be plain affinity,
      // the scale the critic scores picks on. Re-score the pool once (this also pre-scores pool picks).
      const scored = new Map((await scoreEntities(ctx, t, found.map((c) => c.entityId))).flatMap((e) => (typeof e.query?.affinity === "number" ? [[e.entity_id, e.query.affinity] as const] : [])));
      const plain = found.flatMap((c) => {
        const affinity = scored.get(c.entityId);
        return affinity === undefined ? [] : [{ ...c, affinity }];
      });
      return [t, plain] as const;
    }),
  );
  const lists: Culture["lists"] = [];
  const failures: string[] = [];
  const errors: unknown[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") lists.push(r.value);
    else {
      errors.push(r.reason);
      failures.push(`${types[i] ?? "?"}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });
  if (types.length && !lists.length) throw errors[0] instanceof Error ? errors[0] : new Error(failures.join("; "));
  const byType = new Map<PickType, RankedCandidate[]>(lists);
  for (const role of wanted) {
    ctx.candidates[role] = ROLE_SPEC[role].types.flatMap((t) => byType.get(t) ?? []).sort((a, b) => b.affinity - a.affinity);
  }
  return { lists, failures };
}

/** The venue pool for `city`. The previous city's pool is dropped first, so a failed load leaves no pool, never a stale one. */
export async function loadVenues(ctx: Ctx, city: string) {
  delete ctx.candidates.venue;
  const r = await ctx.qloo.insights("urn:entity:place", { ...signalFor(ctx), ...discoveryParams("place", ctx.discovery), "filter.location.query": city, take: 10 });
  ctx.candidates.venue = (r.data.results.entities ?? []).flatMap((e) => toCandidate(e, "place", r.meta.key));
}

/** The /v2/trending window ending at the most recent Monday (UTC), TREND_WEEKS long; weekly-stable, so cache keys repeat within a week. */
export function trendWindow(now: Date = new Date(), weeks = TREND_WEEKS): { start: string; end: string } {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  const end = day - sinceMonday * 86_400_000;
  const start = end - weeks * 7 * 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

/** One line per distinct message, with a count when it repeats. */
const grouped = (messages: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([msg, n]) => (n > 1 ? `${msg} (×${n})` : msg));
};

/**
 * Trend readings for fading-checked roles only (ROLE_SPEC.checkFading): one
 * /v2/trending call per entity not yet read (the endpoint returns one entity's
 * weekly series), keeping the newest point's population_percent_delta.
 * Nothing is thrown: `failures` groups the calls that failed (one line per
 * distinct reason), and `refused` names the entities whose call the run's
 * Qloo budget or time refused, so a caller can tell a cut from a failure.
 */
export async function readTrends(
  ctx: Ctx,
  items: readonly { entityId: string; type: string; role: Role }[],
  now: Date = new Date(),
): Promise<{ failures: string[]; refused: Map<string, string> }> {
  const todo = new Map<string, EntityType>();
  for (const { entityId, type, role } of items) {
    if (!ROLE_SPEC[role].checkFading || ctx.trends.has(entityId) || todo.has(entityId) || !TREND_TYPES.includes(type as EntityType)) continue;
    todo.set(entityId, type as EntityType);
  }
  const window = trendWindow(now);
  const ids = [...todo.keys()];
  const settled = await Promise.allSettled(
    [...todo].map(async ([id, type]) => {
      const r = await ctx.qloo.trending(type, id, window);
      ctx.trends.set(id, latestTrend(r.data.results.trending)?.population_percent_delta);
    }),
  );
  const failed: string[] = [];
  const refused = new Map<string, string>();
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") return;
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    const id = ids[i];
    if (isQlooStop(r.reason) && id !== undefined) refused.set(id, msg);
    else failed.push(msg);
  });
  return { failures: grouped(failed), refused };
}

/** readTrends, with every failed call (budget and time refusals included) as one line per distinct reason. */
export async function loadTrends(ctx: Ctx, items: readonly { entityId: string; type: string; role: Role }[], now: Date = new Date()): Promise<string[]> {
  const { failures, refused } = await readTrends(ctx, items, now);
  return [...failures, ...grouped([...refused.values()])];
}

/** Trend inputs for the top TREND_POOL_TOP candidates of every fading-checked role. */
export function trendItems(ctx: Pick<Ctx, "candidates">): { entityId: string; type: PickType; role: Role }[] {
  return ROLES.filter((r) => ROLE_SPEC[r].checkFading).flatMap((role) =>
    (ctx.candidates[role] ?? []).slice(0, TREND_POOL_TOP).map((c) => ({ entityId: c.entityId, type: c.type, role })),
  );
}

/** Memo key for a pick: same role + same normalised name = same entity. */
export const pickKey = (role: Role, name: string) => `${role}:${normName(name)}`;
