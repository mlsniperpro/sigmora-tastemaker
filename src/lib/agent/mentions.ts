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
import { isQlooStop } from "../qloo/errors";
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

/**
 * Where people listen, watch, follow or buy: named in calls to action ("pre-save on Spotify"), never a
 * cultural pick, so never added for the critic (and never swapped out of the copy).
 */
const CHANNELS = new Set(
  [
    "Spotify", "Apple Music", "Apple Podcasts", "YouTube", "YouTube Music", "Amazon", "Amazon Music", "Tidal", "Deezer", "SoundCloud",
    "Audiomack", "Boomplay", "Bandcamp", "Shazam", "Pandora", "Instagram", "Facebook", "Snapchat", "Threads", "TikTok", "X", "Twitter",
    "Reels", "Shorts", "Twitch", "Discord", "WhatsApp", "Telegram", "Reddit", "LinkedIn", "Pinterest", "Netflix", "Hulu", "Disney+",
    "Prime Video", "Peacock", "Max", "Ticketmaster", "Eventbrite", "Dice", "Shopify", "Google", "Apple", "Linktree",
  ].map(normName),
);

/** Runs of capitalised words (joined by "&", "of", "the" or "and"), e.g. "Love Island USA", "Men in Blazers". */
// Words join on spaces only (never across a line break), and a "." only inside an abbreviation like "F.C.".
const WORD = String.raw`\p{Lu}[\p{L}\p{N}'’-]*(?:\.\p{L}[\p{L}\p{N}'’-]*)*`;
const RUN = new RegExp(String.raw`(?<![\p{L}\p{N}])${WORD}(?:[ \t]+(?:(?:&|of|the|and|in|de|la)[ \t]+)?${WORD}){0,4}`, "gu");

/** Does name `a` contain name `b` as whole words ("burna boy" contains "boy", "remastered" doesn't contain "rema")? Both normalised. */
const hasWords = (a: string, b: string) => ` ${a} `.includes(` ${b} `);

/** Is this match the first word of a sentence (or of a line)? Its first word may then be an ordinary word: "Like Burna Boy". */
function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  return !before || /[.!?;(—–]$/u.test(before) || text.slice(0, index).endsWith("\n");
}

/**
 * Pure: proper-noun runs in the copy that aren't already a pick, a seed, the
 * brief's own subject/product/cities, or a caption platform, best first.
 * `alsoKnown` adds names the run already holds (seeds resolved from a link).
 */
export function candidateMentions(
  draft: Draft,
  brief: Pick<Brief, "subject" | "product" | "seeds" | "targetCity" | "candidateCities">,
  alsoKnown: readonly string[] = [],
): string[] {
  const text = [draft.positioning, ...draft.hooks, draft.script, ...draft.captions.map((c) => c.text), draft.musicBrief].join("\n");
  const norm = (xs: readonly string[]) => xs.map(normName).filter(Boolean);
  // A run that contains a known name ("Like Ayra Starr") is that name; one that contains a city or the product ("Atlanta Braves") is not.
  const names = norm([...draft.picks.map((p) => p.name), ...brief.seeds, ...alsoKnown, brief.subject]);
  const other = norm([brief.product, brief.targetCity ?? "", ...brief.candidateCities]);
  // Platforms are skipped by exact name only: "X" must not hide every name with an x in it.
  const platforms = new Set([...CHANNELS, ...draft.captions.map((c) => normName(c.platform))]);
  const priority = new Map<string, { name: string; rank: number }>();
  const add = (name: string, rank: number) => {
    const key = normName(name);
    // "Spotify and Apple Music" is only platforms too.
    const onlyPlatforms = name.split(/\s+(?:and|&)\s+/).every((part) => platforms.has(normName(part)));
    if (!key || onlyPlatforms || names.some((k) => hasWords(k, key) || hasWords(key, k)) || other.some((k) => hasWords(k, key))) return;
    const prev = priority.get(key);
    if (!prev || prev.rank < rank) priority.set(key, { name, rank });
  };
  for (const m of text.matchAll(RUN)) {
    // "Nia Sol's" is Nia Sol.
    const run = m[0].replace(/['’]s$/u, "").replace(/[.'’-]+$/, "").trim();
    const words = run.split(/\s+/);
    const opener = atSentenceStart(text, m.index);
    if (opener && words.length > 1) {
      // "Tonight Ayra Starr": the opener may be an ordinary word, so the run without it is tried right after the whole run.
      add(run, words.length - 0.5);
      add(words.slice(1).join(" "), words.length - 1);
    } else if (opener) {
      // A lone capitalised word opening a sentence ("We", "First") is the least likely name of all.
      add(run, 0.5);
    } else {
      add(run, words.length);
    }
    // "Burna Boy and Insecure" is two names, "Mumford & Sons" one: try the whole run and its parts; Qloo decides.
    if (/\s(?:and|&)\s/.test(run)) for (const part of run.split(/\s+(?:and|&)\s+/)) add(part, part.split(/\s+/).length);
  }
  // Multi-word names are likelier than a lone capitalised word, so they get the capped searches first.
  return [...priority.values()].sort((a, b) => b.rank - a.rank).map((c) => c.name);
}

/** Unlisted names that Qloo knows by exactly that name, as picks for the critic to check (searches capped). */
export async function unlistedMentions(ctx: Ctx, draft: Draft, brief: Brief): Promise<PlanPick[]> {
  const found = await Promise.all(
    candidateMentions(draft, brief, [...ctx.seedNames.values()])
      .slice(0, MAX_MENTION_SEARCHES)
      .map(async (name) => {
        // Out of Qloo budget or time: the name goes unchecked rather than failing the plan.
        const found = await resolveByName(ctx.qloo, name, { take: 3 }).catch((err: unknown) => {
          if (isQlooStop(err)) return undefined;
          throw err;
        });
        const hit = found?.hit;
        if (!hit || !sameName(hit.name, name)) return [];
        const type = entityTypesOf(hit).find((t): t is PickType => t in ROLE_FOR);
        const role = type ? ROLE_FOR[type] : undefined;
        return type && role ? [{ name, type, role, rationale: "Named in the copy but not listed as a pick; added so the critic checks it." }] : [];
      }),
  );
  return found.flat();
}
