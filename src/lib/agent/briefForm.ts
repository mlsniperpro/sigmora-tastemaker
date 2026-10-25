import type { BriefInput, Family } from "./brief";
import { PRESETS } from "./presets";
import type { AgeBucket } from "../vocab";

export interface FormFields {
  family: Family;
  subject: string;
  product: string;
  /** Comma-separated names. */
  seeds: string;
  link: string;
  vibe: string;
  ages: AgeBucket[];
  gender?: "male" | "female";
  goal: string;
  /** A fixed market; empty means "pick the city for me". */
  city: string;
  /** A comparable whose audience to position against; empty for none. */
  compareTo: string;
}

/** What stops the brief bar's fields from making a brief, in words for the reader; undefined when they're enough. */
export function briefFormProblem(f: FormFields): { field: "subject" | "seeds" | "link"; message: string } | undefined {
  // Required: every hook, caption and script line names who's launching, and a made-up stand-in name would read as a real one.
  if (!f.subject.trim()) return { field: "subject", message: "Say who's launching: the artist, brand or club the plan is for." };
  const link = f.link.trim();
  if (!link && !f.seeds.split(",").some((s) => s.trim())) return { field: "seeds", message: "Name at least one artist or brand your audience loves, or paste a Spotify artist or IMDb link." };
  if (link && !/^https?:\/\/\S+$/i.test(link)) return { field: "link", message: "Paste the full link, starting with https://." };
  return undefined;
}

/** Pure: the brief bar's fields → a brief (the server validates it; check `briefFormProblem` first). */
export function briefFromForm(f: FormFields): BriefInput {
  const seeds = [...new Set(f.seeds.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 5);
  const city = f.city.trim();
  return {
    family: f.family,
    subject: f.subject.trim(),
    product: f.product.trim() || "new release",
    seeds,
    seedLinks: f.link.trim() ? [f.link.trim()] : [],
    vibe: f.vibe.trim() || undefined,
    ages: f.ages,
    gender: f.gender,
    goal: f.goal.trim() || (city ? `Launch in ${city} to the right audience.` : "Launch to the right audience, and pick the first city."),
    ...(city ? { targetCity: city } : { candidateCities: PRESETS[0].brief.candidateCities }),
    compareTo: f.compareTo.trim() || undefined,
  };
}
