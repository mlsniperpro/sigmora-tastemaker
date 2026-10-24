/**
 * Turn whatever JSON a model returned into a valid Draft: trim and truncate
 * strings, map common synonyms for types and roles ("film" → movie,
 * "partner" → sponsor), drop picks that still don't fit, and cap list
 * lengths. Only a plan with no usable hooks, captions or picks is rejected.
 */
import { PICK_TYPES, ROLES, type PickType, type Role } from "../agent/brief";
import { formatZodIssues } from "../zod";
import { Draft } from "./types";

export class LLMOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMOutputError";
  }
}

const key = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

const TYPE_ALIASES: Record<string, PickType> = {
  ...Object.fromEntries(PICK_TYPES.map((t) => [key(t), t])),
  musician: "artist",
  band: "artist",
  singer: "artist",
  rapper: "artist",
  dj: "artist",
  producer: "artist",
  company: "brand",
  label: "brand",
  tv: "tv_show",
  show: "tv_show",
  series: "tv_show",
  "tv series": "tv_show",
  "television show": "tv_show",
  film: "movie",
  venue: "place",
  "pop up": "place",
  restaurant: "place",
  bar: "place",
  creator: "person",
  influencer: "person",
  presenter: "person",
  host: "person",
  celebrity: "person",
  city: "locality",
  market: "locality",
};

const ROLE_ALIASES: Record<string, Role> = {
  ...Object.fromEntries(ROLES.map((r) => [key(r), r])),
  collaborator: "collab",
  collaboration: "collab",
  "collab target": "collab",
  partner: "sponsor",
  "brand partner": "sponsor",
  "hook reference": "reference",
  "cultural reference": "reference",
  "podcast pitch": "podcast",
  "pop up": "venue",
  location: "venue",
  host: "presenter",
  creator: "presenter",
  "presenter match": "presenter",
  "launch city": "city",
  market: "city",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max * 2) : []);

export function normalizeType(v: unknown): PickType | undefined {
  return typeof v === "string" ? TYPE_ALIASES[key(v)] : undefined;
}

export function normalizeRole(v: unknown): Role | undefined {
  return typeof v === "string" ? ROLE_ALIASES[key(v)] : undefined;
}

export function coerceDraft(raw: unknown): Draft {
  const o = isRecord(raw) ? raw : {};
  const candidate = {
    positioning: text(o.positioning, 400),
    hooks: list(o.hooks, 5)
      .map((h) => text(h, 280))
      .filter(Boolean)
      .slice(0, 5),
    script: text(o.script, 1500),
    captions: list(o.captions, 6)
      .filter(isRecord)
      .map((c) => ({ platform: text(c.platform, 30) || "Post", text: text(c.text, 500) }))
      .filter((c) => c.text)
      .slice(0, 6),
    musicBrief: text(o.musicBrief, 600),
    picks: list(o.picks, 20)
      .filter(isRecord)
      .map((p) => ({ name: text(p.name, 100), type: normalizeType(p.type), role: normalizeRole(p.role), rationale: text(p.rationale, 300) }))
      .filter((p): p is { name: string; type: PickType; role: Role; rationale: string } => !!p.name && !!p.type && !!p.role)
      .slice(0, 20),
  };
  const r = Draft.safeParse(candidate);
  if (!r.success) throw new LLMOutputError(`model output is not a usable plan: ${formatZodIssues(r.error, { root: "plan", max: 3 })}`);
  return r.data;
}

/** The first balanced-looking JSON object in a reply (models often wrap it in prose or fences). */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) throw new LLMOutputError("model returned no JSON object");
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new LLMOutputError("model returned malformed JSON");
  }
}
