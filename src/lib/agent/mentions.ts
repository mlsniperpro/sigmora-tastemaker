/**
 * Cultural names a draft writes into its copy but leaves out of `picks`.
 *
 * The model is told to list every entity it names, but nothing forces it to.
 * Candidates are proper-noun runs in the copy; a candidate counts only when
 * Qloo has an entity with that exact name, so ordinary capitalised words
 * ("Launch", "Saturday") drop out without a word list deciding.
 */
import type { Draft, Pick as PlanPick } from "../llm/types";
import type { Brief, PickType, Role } from "./brief";
import { entityTypesOf, resolveByName, type Ctx } from "./context";
import { normName, sameName } from "./util";

/** At most this many /search calls per draft for unlisted names. */
export const MAX_MENTION_SEARCHES = 6;

/** Which role an unlisted mention is checked as, by the type Qloo files it under. */
const ROLE_FOR: Partial<Record<PickType, Role>> = {
  artist: "collab",
  brand: "sponsor",
  tv_show: "reference",
  movie: "reference",
  podcast: "podcast",
  place: "venue",
  person: "presenter",
};

/** Runs of capitalised words (joined by "&", "of", "the" or "and"), e.g. "Love Island USA", "Men in Blazers". */
// Words join on spaces only (never across a line break), and a "." only inside an abbreviation like "F.C.".
const WORD = String.raw`\p{Lu}[\p{L}\p{N}'’-]*(?:\.\p{L}[\p{L}\p{N}'’-]*)*`;
const RUN = new RegExp(String.raw`(?<![\p{L}\p{N}])${WORD}(?:[ \t]+(?:(?:&|of|the|and|in|de|la)[ \t]+)?${WORD}){0,4}`, "gu");

/** Pure: proper-noun runs in the copy that aren't already a pick, the brief's own subject/product, or a platform. */
export function candidateMentions(draft: Draft, brief: Pick<Brief, "subject" | "product" | "targetCity" | "candidateCities">): string[] {
  const text = [draft.positioning, ...draft.hooks, draft.script, ...draft.captions.map((c) => c.text), draft.musicBrief].join("\n");
  const known = [...draft.picks.map((p) => p.name), brief.subject, brief.product, brief.targetCity ?? "", ...brief.candidateCities, ...draft.captions.map((c) => c.platform)]
    .map(normName)
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(RUN)) {
    const run = m[0].replace(/[.'’-]+$/, "").trim();
    // "Burna Boy and Insecure" is two names, "Mumford & Sons" one: try the whole run and its parts; Qloo decides.
    for (const name of [run, ...run.split(/\s+(?:and|&)\s+/)]) {
      const key = normName(name);
      if (!key || seen.has(key) || known.some((k) => k === key || k.includes(key) || key.includes(k))) continue;
      seen.add(key);
      out.push(name);
    }
  }
  // Multi-word runs are likelier names than a capitalised sentence start, so they get the capped searches first.
  return out.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
}

/** Unlisted names that Qloo knows by exactly that name, as picks for the critic to check (searches capped). */
export async function unlistedMentions(ctx: Ctx, draft: Draft, brief: Brief): Promise<PlanPick[]> {
  const found = await Promise.all(
    candidateMentions(draft, brief)
      .slice(0, MAX_MENTION_SEARCHES)
      .map(async (name) => {
        const { hit } = await resolveByName(ctx.qloo, name, { take: 3 });
        if (!hit || !sameName(hit.name, name)) return [];
        const type = entityTypesOf(hit).find((t): t is PickType => t in ROLE_FOR);
        const role = type ? ROLE_FOR[type] : undefined;
        return type && role ? [{ name, type, role, rationale: "Named in the copy but not listed as a pick; added so the critic checks it." }] : [];
      }),
  );
  return found.flat();
}
