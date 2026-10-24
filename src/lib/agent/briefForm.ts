import type { BriefInput, Family } from "./brief";
import { PRESETS } from "./presets";
import type { AgeBucket } from "../qloo/types";

export interface BriefFields {
  family: Family;
  subject: string;
  product: string;
  /** Comma-separated names. */
  seeds: string;
  link: string;
  vibe: string;
  ages: AgeBucket[];
  goal: string;
}

/** Pure: the custom-brief form's fields → a brief (the server validates it). */
export function briefFromForm(f: BriefFields): BriefInput {
  const seeds = [...new Set(f.seeds.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 5);
  return {
    family: f.family,
    subject: f.subject.trim() || "My launch",
    product: f.product.trim() || "new release",
    seeds,
    seedLinks: f.link.trim() ? [f.link.trim()] : [],
    vibe: f.vibe.trim() || undefined,
    ages: f.ages,
    goal: f.goal.trim() || "Launch to the right audience.",
    candidateCities: PRESETS[0].brief.candidateCities,
  };
}
