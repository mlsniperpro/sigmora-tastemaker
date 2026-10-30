import { z } from "zod";
import { PICK_TYPES, ROLES, type Brief, type PickType, type Role } from "../agent/brief";

export const Pick = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(PICK_TYPES),
  role: z.enum(ROLES),
  rationale: z.string().max(300).default(""),
});
export type Pick = z.infer<typeof Pick>;

export const Draft = z.object({
  positioning: z.string().max(400),
  hooks: z.array(z.string().max(280)).min(1).max(5),
  script: z.string().max(1500),
  captions: z.array(z.object({ platform: z.string().max(30), text: z.string().max(500) })).min(1).max(6),
  musicBrief: z.string().max(600),
  /** Every cultural entity the plan names. Text fields may only mention these. */
  picks: z.array(Pick).min(1).max(20),
});
export type Draft = z.infer<typeof Draft>;

export interface Candidate {
  name: string;
  type: PickType;
  affinity: number;
}

/** What Qloo hands the model before it drafts. Absent = "Without Qloo". */
export interface Grounding {
  /** Taste descriptors that over-index for this audience (urn:tag). */
  tags: string[];
  /** Age buckets that over-index (urn:demographics). */
  overIndexAges: string[];
  /** Qloo-ranked candidates per role, best first. */
  candidates: Partial<Record<Role, Candidate[]>>;
  /** Positioning gap vs. the comparable's audience (analysis/compare). */
  positioningTags?: string[];
}

export interface Replacement {
  from: string;
  to: string;
  type: PickType;
  role: Role;
  reason: string;
  /** Every Qloo-approved option for this swap, best first (`to` is the first until the model chooses); `own` marks the model's own idea that Qloo passed. */
  options?: { name: string; type: PickType; affinity: number; own?: boolean }[];
}

/**
 * The model's answer for one swap, with its reason: one of the swap's
 * Qloo-approved options, or (`own`) its own idea, which Qloo then scores and
 * code keeps only if it clears the same bar.
 */
export interface Choice {
  from: string;
  to: string;
  why: string;
  own?: boolean;
}

export interface DraftInput {
  brief: Brief;
  grounding?: Grounding;
}

export interface LLMProvider {
  /** e.g. "deterministic" or "openai-compatible:gpt-x" */
  id: string;
  /** Human label for the UI and receipts. */
  label: string;
  /** True when outputs come from a scripted stand-in rather than a model. */
  scripted: boolean;
  draft(input: DraftInput): Promise<Draft>;
  /** Polish the copy of a draft whose picks the critic already swapped (the caller keeps the pick list). */
  revise(draft: Draft, replacements: Replacement[], input: DraftInput): Promise<Draft>;
  /** For each swap, choose one of its Qloo-approved options or propose an own idea. The caller verifies every answer with Qloo. */
  choose(replacements: Replacement[], input: DraftInput): Promise<Choice[]>;
  /**
   * List the cultural entities someone else's campaign text names, each with the role it plays there.
   * Optional: the scripted model has none, and the deterministic scanner reads the text instead.
   * The caller checks every name with Qloo, so an invented one comes back "not found".
   */
  extract?(text: string): Promise<NamedPick[]>;
}

/** A cultural entity named in a plan, without a rationale (what an audit checks). */
export type NamedPick = Omit<Pick, "rationale">;

/**
 * Swap names in every text field and in the pick list, in one pass: whole
 * names only, case-insensitive, longest first, never cascading (A→B, B→C
 * leaves "B" from the first swap alone). Code owns the picks; this is the
 * deterministic half of every revise.
 */
export function applyReplacements(draft: Draft, replacements: readonly Replacement[]): Draft {
  if (!replacements.length) return draft;
  const to = new Map(replacements.map((r) => [r.from.toLowerCase(), r.to]));
  const names = [...new Set([...draft.picks.map((p) => p.name), ...replacements.map((r) => r.from)])].sort((a, b) => b.length - a.length);
  const alternatives = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Whole names only: replacing "Rema" must not touch "Remarkable".
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "giu");
  const swap = (s: string) => s.replace(re, (m) => to.get(m.toLowerCase()) ?? m);
  const byPick = new Map(replacements.map((r) => [`${r.role}:${r.from.toLowerCase()}`, r]));
  return {
    positioning: swap(draft.positioning),
    hooks: draft.hooks.map(swap),
    script: swap(draft.script),
    captions: draft.captions.map((c) => ({ ...c, text: swap(c.text) })),
    musicBrief: swap(draft.musicBrief),
    picks: draft.picks.map((p) => {
      const r = byPick.get(`${p.role}:${p.name.toLowerCase()}`);
      return r ? { ...p, name: r.to, type: r.type, rationale: r.reason } : p;
    }),
  };
}
