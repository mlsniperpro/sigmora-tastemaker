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

/**
 * A label's words → the role its names play. A label counts only when every
 * word is a role noun or a plain qualifier ("Collab targets", "Brand partners",
 * "Launch city", "Podcast pitch"), so planning lines ("Brand voice",
 * "Partner KPIs", "Target market") are never read as picks. First match wins,
 * so "podcast host" is a podcast and "host city" a city.
 */
const LABELS: { re: RegExp; role: Role; type: PickType }[] = [
  { re: /\bpodcasts?\b/i, role: "podcast", type: "podcast" },
  { re: /\bcity\b|\bcities\b/i, role: "city", type: "locality" },
  { re: /\bcollabs?\b|\bcollaborators?\b|\bfeat(?:ures?|uring)?\b|\bartists?\b|\bmusicians?\b|\bduets?\b|\bsupport acts?\b/i, role: "collab", type: "artist" },
  { re: /\bsponsors?\b|\bbrands?\b|\bpartners?\b/i, role: "sponsor", type: "brand" },
  { re: /\bvenues?\b|\bpop-?ups?\b/i, role: "venue", type: "place" },
  { re: /\bpresenters?\b|\bhosts?\b|\bcreators?\b|\binfluencers?\b|\bambassadors?\b|\bface of\b/i, role: "presenter", type: "person" },
  { re: /\bfilms?\b|\bmovies?\b/i, role: "reference", type: "movie" },
  { re: /\breferences?\b|\btv shows?\b|\bseries\b|\btouchstones?\b|\bhooks?\b/i, role: "reference", type: "tv_show" },
];

/** Every word a pick label may contain: role nouns and qualifiers. Anything else ("voice", "KPIs", "market") makes the line prose. */
const LABEL_WORDS = new Set(
  (
    "podcast podcasts pitch pitches city cities collab collabs collaborator collaborators feat feature features featuring artist artists musician musicians duet duets support act acts " +
    "sponsor sponsors brand brands partner partners venue venues pop-up pop-ups popup popups presenter presenters host hosts creator creators influencer influencers ambassador ambassadors face of " +
    "film films movie movies reference references tv show shows series touchstone touchstones " +
    "target targets potential suggested proposed key primary secondary launch first featured guest guests lead main hero recommended top possible priority shortlist cultural culture hook hooks " +
    "and & / - the a for to our"
  ).split(" "),
);

/** The role a label names, or undefined when it isn't purely a pick label. */
export function labelRole(label: string): (typeof LABELS)[number] | undefined {
  const words = label.toLowerCase().split(/[\s/]+/).filter(Boolean);
  if (!words.length || !words.every((w) => LABEL_WORDS.has(w))) return undefined;
  return LABELS.find((l) => l.re.test(label));
}

/**
 * "- **Collab targets:** A, B" / "Brand partners: A and B" / "2. Podcast pitch – A" → its label and
 * value, or undefined. Only a short prefix before the first colon is ever matched against a pattern,
 * so no line, however long or odd, can make the scan slow.
 */
export function splitLabel(line: string): { label: string; value: string } | undefined {
  const colon = line.search(/[:：]/);
  if (colon < 1 || colon > 60) return undefined;
  const label = line
    .slice(0, colon)
    .replace(/\*\*|__/g, "")
    .replace(/^\s*(?:[-*•>]+|\d{1,2}[.)])?\s*/u, "")
    .trim();
  if (!/^[A-Za-z][A-Za-z /&'-]{1,40}$/.test(label)) return undefined;
  const value = line.slice(colon + 1).replace(/^\s*(?:\*\*|__)?/, "").trim();
  return value ? { label, value } : undefined;
}

/** Words that fill a slot without naming anything. */
const EMPTY = new Set(["tbd", "tba", "tbc", "pending", "none", "n/a", "na", "various", "etc", "other", "others", "to be confirmed", "to be announced", "to be decided"].map(normName));

/** Days, months and times of day fill schedule slots, never name a cultural entity. */
const CALENDAR = /^(?:mon|tues|wednes|thurs|fri|satur|sun)day|^(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|^(?:weekend|weekday|morning|evening|night|tonight|today|tomorrow)s?\b/i;

/** Runs of spaces and tabs become one space before any scan (pasted text can hold thousands). */
export const squashSpaces = (text: string) => text.replace(/[^\S\n]+/g, " ");

/** The names in one labelled line's value: up to the first explanation, split on commas, semicolons, "and", "or", "+" and " / ". */
export function namesIn(value: string): string[] {
  // Markdown links keep their text; asides in brackets go: "Fenty Beauty (inclusive shade range); Coors Light".
  const plain = value
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*\([^)]*\)/g, "");
  // "Ayra Starr — her alté edge fits" / "Insecure. It nails the tone"
  // "think Stranger Things meets Euphoria": a lead-in like "think" or "like" isn't part of a name.
  const lead = plain.replace(/^\s*(?:think|like|e\.g\.|eg|ie|i\.e\.|such as|imagine)\s+/i, "").replace(/\bvs\.\s/g, "vs ");
  const head = lead.split(/\s[—–-]\s|\s*\(|:\s|\.\s|\s+because\s|\s+for\s+(?:its|their|the)\s/u)[0] ?? "";
  return head
    // "/" splits only with spaces around it, so "AC/DC" stays one name.
    .split(/\s*[,;]\s*|\s+(?:\/|and|or|\+|meets|vs|x)\s+/u)
    .map((n) => n.trim().replace(/^["“”'‘’]+|["“”'‘’.!?]+$/gu, "").trim())
    .filter((n) => n.length >= 2 && n.length <= 60 && /^[\p{Lu}\p{N}]/u.test(n) && n.split(/\s+/).length <= 6 && !EMPTY.has(normName(n)) && !CALENDAR.test(n));
}

/**
 * Pure: picks from labelled lines, in order, plus the prose left over (every
 * line that isn't a labelled pick line) for the proper-noun scan.
 */
export function labelledPicks(text: string): { picks: NamedPick[]; prose: string } {
  const picks: NamedPick[] = [];
  const prose: string[] = [];
  const seen = new Set<string>();
  for (const line of squashSpaces(text).split(/\r?\n/)) {
    const m = splitLabel(line);
    const spec = m ? labelRole(m.label) : undefined;
    const names = spec && m ? namesIn(m.value) : [];
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
  /** Names the model listed that the text doesn't contain; never audited. */
  dropped?: string[];
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

/** The model gets this long to list the names; past it, the scanner's list is used so the Qloo checks still have time. */
export const EXTRACT_TIMEOUT_MS = 12_000;

/** Rejects after `ms`, so a slow model can't eat the audit's time. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Names the model listed that the text doesn't contain, word for word (a model that "corrects" or adds a name would hide an invention). */
export function notInText(picks: readonly NamedPick[], text: string): { kept: NamedPick[]; dropped: string[] } {
  const hay = ` ${normName(text)} `;
  const kept: NamedPick[] = [];
  const dropped: string[] = [];
  for (const p of picks) {
    const n = normName(p.name);
    if (n && hay.includes(` ${n} `)) kept.push(p);
    else dropped.push(p.name);
  }
  return { kept, dropped };
}

/**
 * The picks to audit: the live model's list when it has one (only names the text really contains,
 * plus the scanner's labelled picks, which cost nothing), else (or when it fails or is slow) the scanner's.
 */
export async function extractPicks(text: string, opts: { qloo: QlooClient; llm: LLMProvider; seeds: readonly string[]; timeoutMs?: number }): Promise<Extraction> {
  const { llm } = opts;
  if (!llm.scripted && llm.extract) {
    try {
      const listed = await within(llm.extract(text), opts.timeoutMs ?? EXTRACT_TIMEOUT_MS);
      const seeds = new Set(opts.seeds.map(normName));
      const { kept, dropped } = notInText(listed, text);
      const notes = dropped.length ? { dropped } : {};
      if (!kept.some((p) => !seeds.has(normName(p.name)))) return { ...(await scanPicks(opts.qloo, text, opts.seeds)), fallback: "the model listed no names from the text", ...notes };
      const seen = new Set<string>();
      const picks = [...kept, ...labelledPicks(text).picks].filter((p) => {
        const k = `${p.role}:${normName(p.name)}`;
        if (seeds.has(normName(p.name)) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { picks: picks.slice(0, MAX_AUDIT_PICKS), by: "model", model: llm.label, capped: picks.length > MAX_AUDIT_PICKS, ...notes };
    } catch (err) {
      return { ...(await scanPicks(opts.qloo, text, opts.seeds)), fallback: `the model's list failed (${err instanceof Error ? err.message : String(err)})` };
    }
  }
  return scanPicks(opts.qloo, text, opts.seeds);
}
