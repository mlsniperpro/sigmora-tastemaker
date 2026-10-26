import type { Brief, BriefInput } from "./brief";

export interface Preset {
  id: string;
  title: string;
  blurb: string;
  brief: BriefInput;
}

const US_METROS = [
  "Houston",
  "Atlanta",
  "Washington, DC",
  "New York",
  "Chicago",
  "Los Angeles",
  "Dallas",
  "Minneapolis",
  "Seattle",
  "Nashville",
  "Miami",
  "Boston",
];

/** Non-empty: PRESETS[0] is the hero. */
export const PRESETS: readonly [Preset, ...Preset[]] = [
  {
    id: "indie-release",
    title: "Indie artist: single launch",
    blurb: "An independent Afro-fusion artist drops a single and picks the first city to play.",
    brief: {
      preset: "indie-release",
      family: "music",
      subject: "Nia Sol",
      product: "debut single “Harmattan Love”",
      seeds: ["Tems", "Rema", "Asake"],
      // Seeds from a catalogue id too (/entities?external.spotify.ids); the names cover it if the id doesn't resolve.
      seedLinks: ["https://open.spotify.com/artist/687cZJR45JO7jhk1LHIbgq"],
      vibe: "warm late-night Afro-fusion with alté edges",
      ages: ["25_to_29", "30_to_34"],
      goal: "Launch my single to 25–34-year-olds and pick the first city to play outside my home town.",
      candidateCities: US_METROS,
      compareTo: "Burna Boy",
    },
  },
  {
    id: "dtc-city",
    title: "DTC brand: new city",
    blurb: "A clean-skincare brand opens its first pop-up in Atlanta.",
    brief: {
      preset: "dtc-city",
      family: "dtc",
      subject: "Dune & Dew",
      product: "Atlanta pop-up and city launch",
      seeds: ["Glossier", "Topicals", "Fenty Beauty"],
      ages: ["25_to_29", "30_to_34"],
      gender: "female",
      goal: "Enter Atlanta with a pop-up, local partners and creator content that feels native.",
      candidateCities: [],
      targetCity: "Atlanta",
      compareTo: "The Ordinary",
    },
  },
  {
    id: "sports-club",
    title: "Sports club: new fan market",
    blurb: "A football club grows a US supporters' base and picks its watch-party city.",
    brief: {
      preset: "sports-club",
      family: "sports",
      subject: "Southbank FC",
      product: "US supporters' club launch",
      seeds: ["Men in Blazers", "Ted Lasso", "Arsenal F.C."],
      ages: ["25_to_29", "30_to_34", "35_to_44"],
      goal: "Grow a US fan base: pick the first city for official watch parties, matchday content and sponsors.",
      candidateCities: US_METROS,
      compareTo: "Premier League",
    },
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/**
 * The preset this brief is, exactly: every field the preset sets is the same, and every other field is empty. For the
 * UI (a permalink to a preset run highlights it and offers "Re-run live"); an edited preset is a custom brief.
 */
export function presetIdOf(brief: Brief): string | undefined {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const empty = (v: unknown) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  return PRESETS.find((p) => {
    const set = p.brief as Record<string, unknown>;
    return Object.entries(brief).every(([k, v]) => (k in set ? same(set[k], v) : empty(v)));
  })?.id;
}
