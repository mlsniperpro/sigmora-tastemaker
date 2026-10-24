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

/** Pure: the brief bar's fields → a brief (the server validates it). */
export function briefFromForm(f: FormFields): BriefInput {
  const seeds = [...new Set(f.seeds.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 5);
  const city = f.city.trim();
  return {
    family: f.family,
    subject: f.subject.trim() || "My launch",
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
