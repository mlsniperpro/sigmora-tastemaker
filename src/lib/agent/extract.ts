/**
 * The cultural entities a pasted campaign names (anyone's plan: ChatGPT,
 * Claude, an agency deck), for the Qloo audit.
 *
 * With a live model configured, the model lists them (name, type, role).
 * Otherwise, and whenever the model fails, a deterministic scanner reads the
 * text: labelled lines ("Collab targets: A, B") give picks in that role, kept
 * even when the name is invented, so Qloo can say it isn't in its catalogue;
 * every other proper-noun run is kept only when Qloo knows that exact name
 * (the same check as names a draft leaves out of its picks, ./mentions.ts).
 */
import type { QlooClient } from "../qloo/client";
import type { LLMProvider, NamedPick } from "../llm/types";
import type { PickType, Role } from "./brief";
import { candidateMentions, knownNames } from "./mentions";
import { normName } from "./util";

/** At most this many picks are audited from one text. */
export const MAX_AUDIT_PICKS = 15;
/** At most this many /search calls to find the unlabelled names Qloo knows. */
export const MAX_AUDIT_SEARCHES = 10;
/** Longest text accepted. */
export const MAX_AUDIT_CHARS = 4000;

/** A label's words → the role its names play (first match wins, so "podcast host" is a podcast, "brand partner" a sponsor). */
const LABELS: { re: RegExp; role: Role; type: PickType }[] = [
  { re: /\bpodcasts?\b/i, role: "podcast", type: "podcast" },
  { re: /\bcollab|\bfeat(?:ures?|uring)?\b|\bartists?\b|\bmusicians?\b|\bduets?\b|\bsupport acts?\b/i, role: "collab", type: "artist" },
  { re: /\bsponsors?\b|\bbrands?\b|\bpartners?\b/i, role: "sponsor", type: "brand" },
  { re: /\bvenues?\b|\bpop-?ups?\b/i, role: "venue", type: "place" },
  { re: /\bpresenters?\b|\bhosts?\b|\bcreators?\b|\binfluencers?\b|\bambassadors?\b|\bface of\b/i, role: "presenter", type: "person" },
  { re: /\bfilms?\b|\bmovies?\b/i, role: "reference", type: "movie" },
  { re: /\breferences?\b|\bshows?\b|\bseries\b|\btv\b|\btouchstones?\b/i, role: "reference", type: "tv_show" },
  { re: /\bcity\b|\bcities\b|\bmarket\b/i, role: "city", type: "locality" },
];

// "- **Collab targets:** A, B" / "Brand partners: A and B" / "2. Podcast pitch – A". Labels are short and wordy.
const LABELLED = /^\s*(?:[-*•>]+|\d+[.)])?\s*(?:\*\*|__)?\s*([A-Za-z][A-Za-z /&'-]{1,40}?)\s*(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.+)$/u;

/** Words that fill a slot without naming anything. */
const EMPTY = new Set(["tbd", "tba", "none", "n/a", "na", "various", "etc", "other", "others"].map(normName));

/** The names in one labelled line's value: up to the first explanation, split on commas, semicolons, "and", "or", "+" and " / ". */
export function namesIn(value: string): string[] {
  // Markdown links keep their text; asides in brackets go: "Fenty Beauty (inclusive shade range); Coors Light".
  const plain = value
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*\([^)]*\)/g, "");
  // "Ayra Starr — her alté edge fits" / "Insecure. It nails the tone"
  const head = plain.split(/\s[—–-]\s|\s*\(|:\s|\.\s|\s+because\s|\s+for\s+(?:its|their|the)\s/u)[0] ?? "";
  return head
    // "/" splits only with spaces around it, so "AC/DC" stays one name.
    .split(/\s*[,;]\s*|\s+(?:\/|and|or|\+)\s+/u)
    .map((n) => n.trim().replace(/^["“”'‘’]+|["“”'‘’.!?]+$/gu, "").trim())
    .filter((n) => n.length >= 2 && n.length <= 60 && /^[\p{Lu}\p{N}]/u.test(n) && n.split(/\s+/).length <= 6 && !EMPTY.has(normName(n)));
}

/**
 * Pure: picks from labelled lines, in order, plus the prose left over (every
 * line that isn't a labelled pick line) for the proper-noun scan.
 */
export function labelledPicks(text: string): { picks: NamedPick[]; prose: string } {
  const picks: NamedPick[] = [];
  const prose: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = LABELLED.exec(line);
    const label = m?.[1] ?? "";
    const spec = m ? LABELS.find((l) => l.re.test(label)) : undefined;
    const names = spec && m?.[2] ? namesIn(m[2]) : [];
    if (!spec || !names.length) {
      prose.push(line);
      continue;
    }
    for (const name of names) {
      const key = `${spec.role}:${normName(name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ name, type: spec.type, role: spec.role });
    }
  }
  return { picks, prose: prose.join("\n") };
}

export interface Extraction {
  picks: NamedPick[];
  /** "model": the configured LLM listed them; "scanner": the deterministic scanner did. */
  by: "model" | "scanner";
  /** The model's label when `by` is "model". */
  model?: string;
  /** More names than the cap were found; the first MAX_AUDIT_PICKS are audited. */
  capped: boolean;
  /** Scanner only: unlabelled capitalised phrases past the search cap, never looked up. */
  unsearched?: number;
  /** Why the model's list wasn't used, when it failed. */
  fallback?: string;
}

/** The deterministic scanner: labelled picks first, then unlabelled names Qloo knows exactly (searches capped). */
export async function scanPicks(qloo: QlooClient, text: string, seeds: readonly string[]): Promise<Extraction> {
  const { picks: labelled, prose } = labelledPicks(text);
  const draft = { positioning: prose, hooks: [], script: "", captions: [], musicBrief: "", picks: labelled.map((p) => ({ ...p, rationale: "" })) };
  // The audience's own seeds are who the plan is for, not picks in it.
  const candidates = candidateMentions(draft, { subject: "", product: "", seeds: [...seeds], candidateCities: [] });
  // Most proper-noun runs aren't names Qloo knows ("Week", "Drop"), so the searches aren't cut to the picks' room.
  const searched = labelled.length < MAX_AUDIT_PICKS ? candidates.slice(0, MAX_AUDIT_SEARCHES) : [];
  const known = await knownNames(qloo, searched, "");
  // A failed search leaves its name unchecked, the same as one past the cap.
  const failed = [...known.failed.values()].reduce((n, names) => n + names.length, 0);
  const all = [...labelled, ...known.picks.map(({ name, type, role }) => ({ name, type, role }))];
  return { picks: all.slice(0, MAX_AUDIT_PICKS), by: "scanner", capped: all.length > MAX_AUDIT_PICKS, unsearched: candidates.length - searched.length + failed };
}

/** The picks to audit: the live model's list when it has one, else (or when it fails) the scanner's. */
export async function extractPicks(text: string, opts: { qloo: QlooClient; llm: LLMProvider; seeds: readonly string[] }): Promise<Extraction> {
  const { llm } = opts;
  if (!llm.scripted && llm.extract) {
    try {
      const listed = await llm.extract(text);
      const seeds = new Set(opts.seeds.map(normName));
      const picks = listed.filter((p) => !seeds.has(normName(p.name)));
      if (picks.length) return { picks: picks.slice(0, MAX_AUDIT_PICKS), by: "model", model: llm.label, capped: picks.length > MAX_AUDIT_PICKS };
      return { ...(await scanPicks(opts.qloo, text, opts.seeds)), fallback: "the model listed no names" };
    } catch (err) {
      return { ...(await scanPicks(opts.qloo, text, opts.seeds)), fallback: `the model's list failed (${err instanceof Error ? err.message : String(err)})` };
    }
  }
  return scanPicks(opts.qloo, text, opts.seeds);
}
