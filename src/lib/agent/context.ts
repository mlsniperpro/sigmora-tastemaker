/**
 * Shared state for one agent run (or one taste check): the resolved audience
 * signal, Qloo's candidate pool per role, trend readings, and memos so the
 * critic never re-resolves or re-scores an entity it has already seen.
 */
import type { QlooClient, QlooSource } from "../qloo/client";
import type { QlooParams } from "../qloo/params";
import type { Entity, EntityType } from "../qloo/types";
import type { Candidate } from "../llm/types";
import { ROLE_SPEC, ROLES, type Brief, type PickType, type Role } from "./brief";
import type { Driver } from "./types";
import { normName, sameName } from "./util";

export const TREND_TYPES: readonly EntityType[] = ["artist", "tv_show", "movie", "podcast"];

/** A Qloo-ranked candidate; `key` is the request that ranked it. */
export type RankedCandidate = Candidate & { entityId: string; key?: string; lat?: number; lon?: number };

export interface CriticSettings {
  /** A pick fails below this fraction of the role's median top-candidate affinity. */
  missRatio: number;
  /** Absolute affinity floor for a pass. */
  minAffinity: number;
  /** Trend velocity below which a reference counts as fading. */
  fadingBelow: number;
}

export const DEFAULT_CRITIC: CriticSettings = { missRatio: 0.7, minAffinity: 0.25, fadingBelow: -0.3 };

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
}

export interface Resolved {
  name: string;
  role: Role;
  type: PickType;
  entityId?: string;
  calls: string[];
  source?: QlooSource;
}

export interface Ctx extends CriticSettings {
  audience: Audience;
  qloo: QlooClient;
  seedIds: string[];
  seedNames: Map<string, string>;
  tagIds: string[];
  candidates: Partial<Record<Role, RankedCandidate[]>>;
  trends: Map<string, number>;
  /** Critic memos for the run: affinity per entity, and resolution per role + name. */
  scores: Map<string, Score>;
  resolved: Map<string, Resolved>;
  /** Venue-in-city checks: entity id → whether Qloo's location filter returns it in `city`. */
  inCity: Map<string, { ok: boolean; key: string }>;
  /** Launch city, when known; venues must be in it. */
  city?: string;
}

export interface Seed {
  name: string;
  entityId?: string;
  type?: string;
  matched?: string;
}

/** signal.demographics.age takes coarse buckets; the output buckets are finer. */
export function signalAges(ages: readonly string[]): string[] {
  const out = new Set<string>();
  for (const a of ages) {
    if (a === "24_and_younger" || a === "25_to_29" || a === "30_to_34") out.add("35_and_younger");
    else if (a === "35_to_44" || a === "45_to_54") out.add("36_to_55");
    else if (a === "55_and_older") out.add("55_and_older");
  }
  return [...out];
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

export function toCandidate(e: Entity, type: PickType, key?: string): RankedCandidate {
  return { name: e.name, type, affinity: e.query?.affinity ?? 0, entityId: e.entity_id, key };
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
export async function resolveByName(qloo: QlooClient, name: string, opts: { types?: readonly EntityType[]; take?: number; acceptTop?: boolean } = {}) {
  const r = await qloo.search(name, opts.types, opts.take ?? 5);
  const hit = r.data.results.find((e) => sameName(e.name, name)) ?? (opts.acceptTop ? r.data.results[0] : undefined);
  return { hit, key: r.meta.key, source: r.meta.source };
}

export function makeCtx(audience: Audience, qloo: QlooClient, seeds: Seed[], settings: Partial<CriticSettings> = {}): Ctx {
  const resolved = seeds.filter((s) => s.entityId);
  return {
    ...DEFAULT_CRITIC,
    ...settings,
    audience,
    qloo,
    seedIds: [...new Set(resolved.map((s) => s.entityId!))],
    seedNames: new Map(resolved.map((s) => [s.entityId!, s.name])),
    tagIds: [],
    candidates: {},
    trends: new Map(),
    scores: new Map(),
    resolved: new Map(),
    inCity: new Map(),
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
    const sp = l.match(SPOTIFY);
    if (sp) spotify.push(sp[1]);
    const im = l.match(IMDB);
    if (im) imdb.push(im[1]);
  }
  return { spotify: [...new Set(spotify)], imdb: [...new Set(imdb)] };
}

async function resolveLinks(qloo: QlooClient, kind: "spotify" | "imdb", ids: string[]): Promise<Seed[]> {
  if (!ids.length) return [];
  const r = await qloo.entitiesByExternal(kind, ids);
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
  const all = groups.flat();
  if (!all.some((x) => x.entityId)) throw new NoSeedError();
  return all;
}

/** The culture-map roles and the entity types they draw from. */
const CULTURE_ROLES: readonly Role[] = ROLES.filter((r) => r !== "venue" && r !== "city");

/** Load Qloo's ranked candidates for the given roles (all culture-map roles by default), one insights call per type. */
export async function loadCulture(ctx: Ctx, roles: readonly Role[] = CULTURE_ROLES) {
  const wanted = roles.filter((r) => CULTURE_ROLES.includes(r));
  const types = [...new Set(wanted.flatMap((r) => ROLE_SPEC[r].types))];
  const lists = await Promise.all(
    types.map(async (t) => {
      const r = await ctx.qloo.insights(`urn:entity:${t as EntityType}`, { ...signalFor(ctx), take: 10 });
      return [t, (r.data.results.entities ?? []).map((e) => toCandidate(e, t, r.meta.key))] as const;
    }),
  );
  const byType = new Map<PickType, RankedCandidate[]>(lists);
  for (const role of wanted) {
    ctx.candidates[role] = ROLE_SPEC[role].types.flatMap((t) => byType.get(t) ?? []).sort((a, b) => b.affinity - a.affinity);
  }
  return lists;
}

export async function loadVenues(ctx: Ctx, city: string) {
  const r = await ctx.qloo.insights("urn:entity:place", { ...signalFor(ctx), "filter.location.query": city, take: 10 });
  ctx.candidates.venue = (r.data.results.entities ?? []).map((e) => toCandidate(e, "place", r.meta.key));
}

/** Trend velocity for the given entities, grouped by type; failures are returned, not thrown. */
export async function loadTrends(ctx: Ctx, items: { entityId: string; type: string }[]): Promise<string[]> {
  const groups = new Map<EntityType, Set<string>>();
  for (const { entityId, type } of items) {
    if (ctx.trends.has(entityId) || !TREND_TYPES.includes(type as EntityType)) continue;
    groups.set(type as EntityType, (groups.get(type as EntityType) ?? new Set()).add(entityId));
  }
  const failures: string[] = [];
  await Promise.all(
    [...groups].map(async ([type, ids]) => {
      try {
        const r = await ctx.qloo.trending(type, [...ids]);
        for (const e of r.data.results.entities ?? []) {
          const v = e.query?.population_rank_velocity;
          if (typeof v === "number") ctx.trends.set(e.entity_id, v);
        }
      } catch (err) {
        failures.push(`${type}: ${(err as Error).message}`);
      }
    }),
  );
  return failures;
}

/** Memo key for a pick: same role + same normalised name = same entity. */
export const pickKey = (role: Role, name: string) => `${role}:${normName(name)}`;
