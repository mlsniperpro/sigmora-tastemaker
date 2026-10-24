/**
 * Plain constants shared by the server and the browser. No zod here, so
 * importing them doesn't pull the schema library into the client bundle.
 */
export const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const FAMILIES = ["music", "dtc", "sports"] as const;

export const ROLES = ["collab", "sponsor", "reference", "podcast", "venue", "presenter", "city"] as const;
export type Role = (typeof ROLES)[number];

export const PICK_TYPES = ["artist", "brand", "tv_show", "movie", "podcast", "place", "person", "locality"] as const;
export type PickType = (typeof PICK_TYPES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  collab: "Collab target",
  sponsor: "Brand partner",
  reference: "Hook reference",
  podcast: "Podcast pitch",
  venue: "Venue / pop-up",
  presenter: "Presenter match",
  city: "Launch city",
};

/** Run ids and publisher campaign ids appear in URLs, so their charsets are tight. */
export const RUN_ID_RE = /^[a-z0-9]{1,40}$/;
export const CAMPAIGN_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
