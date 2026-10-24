import { z } from "zod";
import { AGE_BUCKETS } from "../qloo/types";

export const Family = z.enum(["music", "dtc", "sports"]);
export type Family = z.infer<typeof Family>;

export const Brief = z.object({
  /** Preset id, when the brief came from a preset. */
  preset: z.string().max(40).optional(),
  family: Family,
  /** Who is launching: an artist, brand or club. */
  subject: z.string().min(1).max(80),
  /** What is launching. */
  product: z.string().min(1).max(120),
  /** Comparable names the audience already loves ("sounds like", "competes with"). */
  seeds: z.array(z.string().min(1).max(80)).min(1).max(5),
  /** Optional Spotify / IMDb links to seed from catalog IDs. */
  seedLinks: z.array(z.string().url().max(200)).max(3).default([]),
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
export type Brief = z.infer<typeof Brief>;
export type BriefInput = z.input<typeof Brief>;

export const ROLES = ["collab", "sponsor", "reference", "podcast", "venue", "presenter", "city"] as const;
export type Role = (typeof ROLES)[number];

export const PICK_TYPES = ["artist", "brand", "tv_show", "movie", "podcast", "place", "person", "locality"] as const;
export type PickType = (typeof PICK_TYPES)[number];

/** Which Qloo type(s) a role is drawn from. */
export const ROLE_TYPES: Record<Role, PickType[]> = {
  collab: ["artist"],
  sponsor: ["brand"],
  reference: ["tv_show", "movie"],
  podcast: ["podcast"],
  venue: ["place"],
  presenter: ["person"],
  city: ["locality"],
};

/** How many picks of each role a plan carries. */
export const ROLE_COUNTS: Record<Role, number> = {
  collab: 2,
  sponsor: 2,
  reference: 2,
  podcast: 1,
  venue: 1,
  presenter: 1,
  city: 1,
};

export const ROLE_LABEL: Record<Role, string> = {
  collab: "Collab target",
  sponsor: "Brand partner",
  reference: "Hook reference",
  podcast: "Podcast pitch",
  venue: "Venue / pop-up",
  presenter: "Presenter match",
  city: "Launch city",
};
