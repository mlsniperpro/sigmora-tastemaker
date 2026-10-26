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
  { re: /\bcollabs?\b|\bcollaborat(?:ors?|ions?)\b|\bfeat(?:ures?|uring)?\b|\bartists?\b|\bmusicians?\b|\bduets?\b|\bsupport acts?\b|\bproducers?\b|\bdjs?\b/i, role: "collab", type: "artist" },
  { re: /\bsponsors?\b|\bbrands?\b|\bpartners?\b/i, role: "sponsor", type: "brand" },
  { re: /\bvenues?\b|\bpop-?ups?\b/i, role: "venue", type: "place" },
  { re: /\bpresenters?\b|\bhosts?\b|\bcreators?\b|\binfluencers?\b|\bambassadors?\b|\bface of\b/i, role: "presenter", type: "person" },
  { re: /\bfilms?\b|\bmovies?\b/i, role: "reference", type: "movie" },
  // "Hook:" lines are usually copy ("Hook: Pre-save now"), so they're read as prose: only names Qloo knows exactly come out of them.
  { re: /\breferences?\b|\btv shows?\b|\bseries\b|\btouchstones?\b/i, role: "reference", type: "tv_show" },
];

/** Every word a pick label may contain: role nouns and qualifiers. Anything else ("voice", "KPIs", "market") makes the line prose. */
const LABEL_WORDS = new Set(
  (
    "podcast podcasts pitch pitches appearance appearances city cities collab collabs collaborator collaborators collaboration collaborations feat feature features featuring artist artists musician musicians duet duets support act acts producer producers dj djs " +
    "sponsor sponsors brand brands partner partners venue venues pop-up pop-ups popup popups presenter presenters host hosts creator creators influencer influencers ambassador ambassadors face of " +
    "film films movie movies reference references tv show shows series touchstone touchstones " +
    "target targets potential suggested proposed key primary secondary launch first featured guest guests lead main hero recommended top possible priority shortlist cultural culture hook hooks option options pick picks name names list " +
    "and & / - the a for to our"
  ).split(" "),
);

/** The role a label names, or undefined when it isn't purely a pick label. */
export function labelRole(label: string): (typeof LABELS)[number] | undefined {
  // "Top 3 creators", "Venue (primary)": numbers and brackets qualify a label without changing its role.
  const words = label.toLowerCase().replace(/[()]/g, " ").split(/[\s/]+/).filter((w) => w && !/^\d+$/.test(w));
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
  if (!/^[A-Za-z][A-Za-z0-9 /&'()-]{1,40}$/.test(label)) return undefined;
  const value = line.slice(colon + 1).replace(/^\s*(?:\*\*|__)?/, "").trim();
  return value ? { label, value } : undefined;
}

/** Words that fill a slot without naming anything. */
const EMPTY = new Set(["tbd", "tba", "tbc", "pending", "none", "n/a", "na", "various", "etc", "other", "others", "to be confirmed", "to be announced", "to be decided"].map(normName));

/** Days, months and times of day fill schedule slots, never name a cultural entity. */
const CALENDAR = /^(?:mon|tues|wednes|thurs|fri|satur|sun)day|^(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|^(?:weekend|weekday|morning|evening|night|tonight|today|tomorrow)s?\b/i;

/** Slot fillers that aren't names: "Our agency", "Legal team", "N/A for now", "Coming soon", "Season 1". */
const PLACEHOLDER = /^(?:our|my|your|their|his|her|its|an?)\s|\bteam$|^coming soon\b|^season\s+\d|^n\/?a\b|^tb[acd]\b|^none\b|^various\b|^for now\b/i;

/** Descriptions, not names: "5 micro-influencers in Lagos", "Three TikTok dance creators", "Local Coffee Shops", "Pop-up in Lagos". */
function isDescription(n: string): boolean {
  // A count then a lowercase word ("5 micro-influencers"); "50 Cent" and "5 Seconds of Summer" are names.
  if (/^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|a few|several|some|many)\s/i.test(n) && /^\S+\s+\p{Ll}/u.test(n)) return true;
  return /^pop-?ups?\b|\s(?:creators|influencers|micro-influencers|shops|stores|labels|brands|venues|bars|cafes|restaurants|challenge|accounts|pages|students|campuses|startups|businesses|artists|musicians|djs|podcasters|streamers|athletes|spots)$/i.test(n);
}

/** Countries and regions that follow a city ("Lagos, Nigeria") rather than name another one. */
const REGIONS = new Set(
  ["nigeria", "kenya", "ghana", "south africa", "uganda", "rwanda", "senegal", "tanzania", "usa", "united states", "uk", "united kingdom", "england", "canada", "france", "germany", "brazil", "mexico", "india", "japan", "australia", "california", "texas", "georgia", "new york state", "florida"].map(normName),
);

/** Cities that follow a venue ("Madison Square Garden, New York") rather than name another venue. */
const CITIES = new Set(
  ["new york", "new york city", "nyc", "manhattan", "harlem", "hollywood", "los angeles", "la", "chicago", "houston", "atlanta", "washington", "washington dc", "dc", "miami", "dallas", "seattle", "boston", "nashville", "minneapolis", "philadelphia", "san francisco", "detroit", "denver", "phoenix", "london", "paris", "berlin", "toronto", "lagos", "nairobi", "accra", "johannesburg", "kampala", "kigali", "dakar", "brooklyn"].map(normName),
);

/** A place name as the lists above hold it: "Washington, D.C." and "Washington DC" read the same. */
const placeKey = (n: string) => normName(n.replace(/\./g, ""));
/** A state or country code after a place ("GA", "MD", "D.C."). */
const isCode = (n: string) => /^[A-Z]{2,3}$/.test(n.replace(/\./g, ""));

/** Could this fragment be a name at all (not a placeholder, a date, a description)? A lowercase "the" may lead ("the Weeknd"). */
export function nameLike(n: string): boolean {
  const bare = n.replace(/^the\s+(?=[\p{Lu}\p{N}])/u, "");
  return n.length >= 2 && n.length <= 60 && /^[\p{Lu}\p{N}]/u.test(bare) && n.split(/\s+/).length <= 6 && !EMPTY.has(normName(n)) && !CALENDAR.test(bare) && !PLACEHOLDER.test(bare) && !isDescription(bare);
}

/** Small words a title keeps lowercase ("Into the Spider-Verse"). */
const TITLE_SMALL = new Set(["of", "the", "and", "in", "a", "an", "to", "for", "on", "at", "with", "&", "vs", "vs."]);
/** Stands in for a title's own colon while a value is split ("Black Panther: Wakanda Forever"). */
const TITLE_COLON = "\u241F";

/**
 * A titled work's subtitle stays on it: "Black Panther: Wakanda Forever", "Law & Order: SVU". The first ": "
 * is kept when what follows, up to the next comma, reads as a title (at most 6 words, each capitalised or small);
 * "Insecure: it nails the tone" is a title and its explanation.
 */
function keepSubtitle(text: string): string {
  const i = text.indexOf(": ");
  if (i < 0) return text;
  const words = (text.slice(i + 2).split(/[,;]/)[0] ?? "").trim().split(" ");
  const titled = words.length <= 6 && words.every((w) => /^[\p{Lu}\p{N}]/u.test(w) || TITLE_SMALL.has(w)) && /^[\p{Lu}\p{N}]/u.test(words[0] ?? "");
  return titled ? `${text.slice(0, i)}${TITLE_COLON} ${text.slice(i + 2)}` : text;
}

/** Runs of spaces and tabs become one space before any scan (pasted text can hold thousands). */
export const squashSpaces = (text: string) => text.replace(/[^\S\n]+/g, " ");

/** The names in one labelled line's value: up to the first explanation, split on commas, semicolons, "and", "or", "+" and " / ". */
export function namesIn(value: string, role?: Role): string[] {
  // Markdown links keep their text; asides in brackets go: "Fenty Beauty (inclusive shade range); Coors Light".
  const plain = value
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*\([^)]*\)/g, "")
    // "Dr. Dre", "Burna Boy feat. Ayra Starr": an abbreviation's dot doesn't end the sentence.
    .replace(/\b(Dr|Mr|Mrs|Ms|St|Jr|Sr|Vol|Pt|feat|ft|vs)\.\s/g, "$1 ");
  // "think Stranger Things meets Euphoria": a lead-in like "think" or "like" isn't part of a name.
  const lead0 = plain.replace(/^\s*(?:think|like|e\.g\.|eg|ie|i\.e\.|such as|imagine)\s+/i, "");
  const lead = role === "reference" || role === "podcast" ? keepSubtitle(lead0) : lead0;
  // "Ayra Starr — her alté edge fits" / "Insecure. It nails the tone"
  const head = lead.split(/\s[—–-]\s|\s*\(|:\s|\.\s|\s+because\s|\s+for\s+(?:its|their|the)\s/u)[0] ?? "";
  const split = head
    // "/" splits only with spaces around it, so "AC/DC" stays one name; "feat" joins two artists.
    .split(/\s*[,;]\s*|\s+(?:\/|and|or|\+|plus|as well as|meets|vs|x|feat|ft|featuring)\s+/u)
    // "A, B, and C" / "A, B & C": the list's last joiner isn't part of the last name.
    .map((n) => n.trim().replace(/^(?:and|or|&|plus)\s+/, "").replace(/^["“”'‘’]+|["“”'‘’.!?]+$/gu, "").replaceAll(TITLE_COLON, ":").trim());
  // "Tyler, the Creator" / "Florence + the Machine": a lowercase "the …" part belongs to the name before it, as written.
  const parts: string[] = [];
  for (const n of split) {
    const prev = parts.at(-1);
    if (prev !== undefined && /^the\s/.test(n)) {
      const from = head.indexOf(prev);
      const to = head.indexOf(n, from + prev.length);
      parts[parts.length - 1] = from >= 0 && to >= 0 ? head.slice(from, to + n.length) : `${prev} ${n}`;
    } else parts.push(n);
  }
  return (
    parts
      // "Atlanta, GA" / "Lagos, Nigeria": the region after a city isn't another city; "Madison Square Garden, New York": nor is the city after a venue.
      .filter((n, i) => !(role === "city" && i > 0 && (isCode(n) || REGIONS.has(placeKey(n)))))
      .filter((n, i) => !(role === "venue" && i > 0 && (isCode(n) || REGIONS.has(placeKey(n)) || CITIES.has(placeKey(n)))))
      .filter((n) => /^[\p{Lu}\p{N}]/u.test(n) && nameLike(n))
  );
}

/**
 * Pure: picks from labelled lines, in order, plus the prose left over (every
 * line that isn't a labelled pick line) for the proper-noun scan.
 */
/** Two adjacent names from one labelled line, joined back as written ("Earth, Wind & Fire"), in case the split broke one name. */
export interface Join {
  /** Indexes of the two fragments in `picks`. */
  a: number;
  b: number;
  name: string;
}

/**
 * One labelled name that may be two ("Burna Boy & Wizkid", "Drake, the Weeknd"): kept whole only when
 * Qloo knows it by that exact name ("Simon & Garfunkel", "Tyler, the Creator"), else read as its parts.
 */
export interface Split {
  /** Index of the name in `picks`. */
  at: number;
  parts: string[];
}

/** The names inside one that an "&" or a lowercase "the …" may have run together, or [] when it can't be two. */
export function partsOf(name: string): string[] {
  const parts = name
    .split(/\s+&\s+|\s*,\s*(?=the\s)|\s+(?:\/|and|or|\+|plus|meets|vs|x|feat|ft|featuring)\s+(?=the\s)/u)
    .map((n) => n.trim())
    .filter(Boolean);
  return parts.length > 1 && parts.every(nameLike) ? parts : [];
}

export function labelledPicks(text: string): { picks: NamedPick[]; prose: string; joins: Join[]; splits: Split[] } {
  const picks: NamedPick[] = [];
  const prose: string[] = [];
  const joins: Join[] = [];
  const splits: Split[] = [];
  const seen = new Set<string>();
  for (const line of squashSpaces(text).split(/\r?\n/)) {
    const m = splitLabel(line);
    const spec = m ? labelRole(m.label) : undefined;
    const names = spec && m ? namesIn(m.value, spec.role) : [];
    if (!spec || !names.length) {
      prose.push(line);
      continue;
    }
    let prevIndex = -1;
    let prevName = "";
    for (const name of names) {
      const key = `${spec.role}:${normName(name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ name, type: spec.type, role: spec.role });
      const at = picks.length - 1;
      const parts = partsOf(name);
      if (parts.length) splits.push({ at, parts });
      // The two names exactly as the line wrote them together, separator and all.
      const from = m?.value.indexOf(prevName) ?? -1;
      const to = from >= 0 ? (m?.value.indexOf(name, from + prevName.length) ?? -1) : -1;
      const joined = prevIndex >= 0 && from >= 0 && to >= 0 ? (m?.value.slice(from, to + name.length) ?? "") : "";
      // Only where a split plausibly broke one name: a one-word side ("Earth, Wind & Fire", "Marks and Spencer")
      // or a capitalised "The …" ("Tyler, The Creator"); two full names in a list aren't worth a search.
      // City lists never hold a name with a comma in it ("Lagos, Abuja"), so they spend no searches on joins.
      const plausible = spec.role !== "city" && (!prevName.includes(" ") || !name.includes(" ") || /^The\s/.test(name));
      if (joined && plausible && to - (from + prevName.length) <= 5) joins.push({ a: prevIndex, b: at, name: joined });
      prevIndex = at;
      prevName = name;
    }
  }
  return { picks, prose: prose.join("\n"), joins, splits };
}

/** At most this many joined or split names are looked up per text (out of MAX_AUDIT_SEARCHES). */
export const MAX_JOIN_SEARCHES = 6;

/**
 * Reads each labelled name the way Qloo does, in one batch of searches:
 * - where Qloo knows two adjacent fragments joined, exactly as written ("Earth, Wind & Fire",
 *   "Marks and Spencer"), the joined name replaces them;
 * - a name that may be two ("Burna Boy & Wizkid", "Drake, the Weeknd") becomes its parts unless
 *   Qloo knows it whole ("Simon & Garfunkel", "Tyler, the Creator"). A failed search keeps it whole.
 */
export async function rejoin(qloo: QlooClient, picks: readonly NamedPick[], joins: readonly Join[], splits: readonly Split[] = []): Promise<NamedPick[]> {
  const tried = joins.slice(0, MAX_JOIN_SEARCHES);
  const triedSplits = splits.slice(0, MAX_JOIN_SEARCHES - tried.length);
  if (!tried.length && !triedSplits.length) return [...picks];
  const wholes = triedSplits.flatMap((sp) => (picks[sp.at] ? [picks[sp.at]?.name ?? ""] : []));
  const known = await knownNames(qloo, [...tried.map((j) => j.name), ...wholes], "");
  const exact = new Set(known.picks.map((p) => normName(p.name)));
  // A name Qloo knows whole as any type (a book, a place) is one name, not two.
  const whole = new Set([...exact, ...known.otherTypes.map((o) => normName(o.name))]);
  const failed = new Set([...known.failed.values()].flat());
  const drop = new Set<number>();
  const replace = new Map<number, NamedPick[]>();
  for (const j of tried) {
    const first = picks[j.a];
    if (!first || drop.has(j.a) || drop.has(j.b) || !exact.has(normName(j.name))) continue;
    replace.set(j.a, [{ ...first, name: j.name }]);
    drop.add(j.b);
  }
  for (const sp of triedSplits) {
    const p = picks[sp.at];
    if (!p || drop.has(sp.at) || replace.has(sp.at) || whole.has(normName(p.name)) || failed.has(p.name)) continue;
    replace.set(sp.at, sp.parts.map((name) => ({ ...p, name })));
  }
  const seen = new Set<string>();
  return picks.flatMap((p, i) => (drop.has(i) ? [] : (replace.get(i) ?? [p]))).filter((p) => {
    const k = `${p.role}:${normName(p.name)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface Extraction {
  picks: NamedPick[];
  /** "model": the configured LLM listed them; "scanner": the deterministic scanner did. */
  by: "model" | "scanner";
  /** The model's label when `by` is "model". */
  model?: string;
  /** More names than the cap were found; the first MAX_AUDIT_PICKS are audited. */
  capped: boolean;
  /** Searches that failed (Qloo error, budget or time): their names went unchecked. */
  failedSearches?: number;
  /** Scanner only: unlabelled capitalised phrases past the search cap, never looked up. */
  unsearched?: number;
  /** Why the model's list wasn't used, when it failed. */
  fallback?: string;
  /** Names the model listed that the text doesn't contain; never audited. */
  dropped?: string[];
  /** Scanner only: names Qloo knows exactly, but as a type this audit doesn't check (a city in prose, a book). */
  otherTypes?: { name: string; type: string }[];
  /** Scanner only: capitalised phrases in the prose that Qloo has no entity for by that exact name; not audited (from prose alone an invention can't be told from an ordinary phrase). */
  unmatched?: string[];
}

/** The deterministic scanner: labelled picks first, then unlabelled names Qloo knows exactly (searches capped). */
export async function scanPicks(qloo: QlooClient, text: string, seeds: readonly string[]): Promise<Extraction> {
  const lines = labelledPicks(text);
  const labelled = await rejoin(qloo, lines.picks, lines.joins, lines.splits);
  const prose = lines.prose;
  const draft = { positioning: prose, hooks: [], script: "", captions: [], musicBrief: "", picks: labelled.map((p) => ({ ...p, rationale: "" })) };
  // The audience's own seeds are who the plan is for, not picks in it.
  const candidates = candidateMentions(draft, { subject: "", product: "", seeds: [...seeds], candidateCities: [] });
  // Most proper-noun runs aren't names Qloo knows ("Week", "Drop"), so the searches aren't cut to the picks' room.
  // Joined-name lookups and prose searches share one search budget, so the audit's reservation holds.
  const room = MAX_AUDIT_SEARCHES - Math.min(lines.joins.length + lines.splits.length, MAX_JOIN_SEARCHES);
  const searched = labelled.length < MAX_AUDIT_PICKS ? candidates.slice(0, room) : [];
  const known = await knownNames(qloo, searched, "");
  // A failed search leaves its name unchecked, the same as one past the cap.
  const failed = [...known.failed.values()].reduce((n, names) => n + names.length, 0);
  const all = [...labelled, ...known.picks.map(({ name, type, role }) => ({ name, type, role }))];
  const failedNames = new Set([...known.failed.values()].flat());
  const found = new Set(known.picks.map((p) => normName(p.name)));
  const known2 = new Set(known.otherTypes.map((o) => normName(o.name)));
  // Only plausible names are listed as not audited: two or more words, not an "A and B" chain (a lone capitalised word is usually ordinary English).
  const unmatched = searched.filter((n) => !found.has(normName(n)) && !known2.has(normName(n)) && !failedNames.has(n) && n.split(/\s+/).length >= 2 && !/\s(?:and|&)\s/.test(n));
  return { picks: all.slice(0, MAX_AUDIT_PICKS), by: "scanner", capped: all.length > MAX_AUDIT_PICKS, unsearched: candidates.length - searched.length + failed, failedSearches: failed, unmatched, otherTypes: known.otherTypes };
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
      const lines = labelledPicks(text);
      const labelled = await rejoin(opts.qloo, lines.picks, lines.joins, lines.splits);
      // Labelled picks first: they cost nothing and are the plan's own slots, so the cap never cuts them for the model's extras.
      const picks = [...labelled, ...kept].filter((p) => {
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
