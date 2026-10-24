import { z } from "zod";
import { AGE_BUCKETS, FAMILIES, type PickType, type Role } from "../vocab";

export const Family = z.enum(FAMILIES);
export type Family = z.infer<typeof Family>;

/** The brief's fields, without the cross-field rule (for reuse by other schemas). */
export const BriefFields = z.object({
  /** Preset id, when the brief came from a preset. */
  preset: z.string().max(40).optional(),
  family: Family,
  /** Who is launching: an artist, brand or club. */
  subject: z.string().min(1).max(80),
  /** What is launching. */
  product: z.string().min(1).max(120),
  /** Comparable names the audience already loves ("sounds like", "competes with"). A link alone is enough. */
  seeds: z.array(z.string().min(1).max(80)).max(5),
  /** Optional Spotify / IMDb links to seed from catalog IDs. */
  seedLinks: z.array(z.url().max(200)).max(3).default([]),
  /** Free-text description of the sound or feel; mapped to Qloo tags. */
  vibe: z.string().max(200).optional(),
  ages: z.array(z.enum(AGE_BUCKETS)).min(1).max(6),
  gender: z.enum(["male", "female"]).optional(),
  goal: z.string().min(1).max(200),
  /** Candidate metros for the "where to launch" heatmap. */
  candidateCities: z.array(z.string().min(1).max(40)).max(14).default([]),
  /** Fixed market (e.g. a DTC brand entering Atlanta). Skips the city pick. */
  targetCity: z.string().max(40).optional(),
  /** A comparable whose audience we position against (analysis/compare). */
  compareTo: z.string().max(80).optional(),
});

export const Brief = BriefFields.refine((b) => b.seeds.length + b.seedLinks.length > 0, {
  message: "Give at least one name the audience loves, or a Spotify/IMDb link",
  path: ["seeds"],
});
export type Brief = z.infer<typeof Brief>;
export type BriefInput = z.input<typeof Brief>;

/** A run is requested by preset id or by a full brief (shared by the server and the browser). */
export const RunRequest = z.union([
  // `fresh`: run the preset live even when a recorded run exists ("Re-run live").
  z.object({ preset: z.string().max(40), fresh: z.boolean().optional() }).strict(),
  z.object({ brief: Brief }).strict(),
]);
export type RunRequest = z.input<typeof RunRequest>;

export { ROLES, PICK_TYPES, ROLE_LABEL, type Role, type PickType } from "../vocab";



export interface RoleSpec {
  /** Qloo entity type(s) the role is drawn from. */
  types: readonly [PickType, ...PickType[]];
  /** How many picks of this role a plan carries. */
  count: number;
  /** "median": pass at ≥ missRatio × median candidate affinity; "top3": pass if within the top 3 of the candidate pool. */
  bar: "median" | "top3";
  /** Scored from the candidate pool's ranking call rather than a separate critic call. */
  scoreFromPool: boolean;
  /** Must be inside the launch city (checked with Qloo's location filter). */
  inCity: boolean;
  /** Rejected when its trend is falling (hooks on fading references age badly). */
  checkFading: boolean;
}

const role = (types: readonly [PickType, ...PickType[]], count: number, extra: Partial<RoleSpec> = {}): RoleSpec => ({
  types,
  count,
  bar: "median",
  scoreFromPool: false,
  inCity: false,
  checkFading: false,
  ...extra,
});

/** Everything the agent and the critic need to know about each role, in one place. */
export const ROLE_SPEC: Record<Role, RoleSpec> = {
  collab: role(["artist"], 2),
  sponsor: role(["brand"], 2),
  reference: role(["tv_show", "movie"], 2, { checkFading: true }),
  podcast: role(["podcast"], 1),
  venue: role(["place"], 1, { inCity: true }),
  presenter: role(["person"], 1),
  city: role(["locality"], 1, { bar: "top3", scoreFromPool: true }),
};

