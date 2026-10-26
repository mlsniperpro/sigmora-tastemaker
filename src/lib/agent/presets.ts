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
 * The preset this brief comes from, by its own words (family, subject, product, goal), for the UI only: a permalink
 * to a preset run highlights that preset and offers "Re-run live". Shipping checks the whole brief (`isPresetBrief`).
 */
export function presetIdOf(brief: Pick<Brief, "family" | "subject" | "product" | "goal">): string | undefined {
  return PRESETS.find((p) => p.brief.family === brief.family && p.brief.subject === brief.subject && p.brief.product === brief.product && p.brief.goal === brief.goal)?.id;
}
