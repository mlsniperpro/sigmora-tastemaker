/**
 * Measure → re-query: after a campaign has run, the verified picks that
 * appeared in the best-performing posts become the taste seeds
 * (signal.interests.entities) of the next run.
 *
 * Pure. The numbers come from the publisher's measured post performance;
 * there is no estimate or default anywhere, and too little data yields no
 * new brief.
 */
import type { Brief } from "./brief";
import type { RunResult } from "./types";
import { median, normName } from "./util";

export interface PostPerformance {
  /** What was actually posted (as the publisher reports it). */
  text: string;
  impressions: number;
  engagements: number;
}

export interface Winner {
  name: string;
  /** Mean engagement rate of the measured posts that mention this pick. */
  rate: number;
  posts: number;
}

export type Requery =
  | { ok: true; winners: Winner[]; medianRate: number; brief: Brief }
  | { ok: false; reason: string };

/** Posts below this many impressions are too noisy to rank. */
export const MIN_IMPRESSIONS = 500;
const MAX_SEEDS = 5;
const MAX_WINNERS = 3;

/** Normalized and space-padded, so a name matches only on word boundaries. */
const padded = (s: string) => ` ${normName(s)} `;

export function requeryBrief(run: Pick<RunResult, "brief" | "grounded">, performance: readonly PostPerformance[], minImpressions = MIN_IMPRESSIONS): Requery {
  const measured = performance.flatMap((p) => (p.impressions >= minImpressions ? [{ text: padded(p.text), rate: p.engagements / p.impressions }] : []));
  if (measured.length < 2) {
    return { ok: false, reason: `Need at least 2 posts with ${minImpressions}+ impressions to compare; have ${measured.length}.` };
  }
  const medianRate = median(measured.map((m) => m.rate));
  const verified = run.grounded.receipts.filter((r) => r.verdict === "pass" && r.role !== "city" && r.role !== "venue");
  const winners = verified
    .flatMap((r): Winner[] => {
      const name = padded(r.name);
      const rates = measured.filter((m) => m.text.includes(name)).map((m) => m.rate);
      if (!rates.length) return [];
      const rate = rates.reduce((a, x) => a + x, 0) / rates.length;
      return rate > medianRate ? [{ name: r.name, rate: Math.round(rate * 10000) / 10000, posts: rates.length }] : [];
    })
    .sort((a, b) => b.rate - a.rate)
    .slice(0, MAX_WINNERS);
  if (!winners.length) return { ok: false, reason: "No verified pick appears in a post that beat the median engagement rate." };

  const seen = new Set<string>();
  const seeds = [...winners.map((w) => w.name), ...run.brief.seeds].filter((s) => {
    const k = normName(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // A custom brief now, no longer the preset it may have started from.
  return { ok: true, winners, medianRate: Math.round(medianRate * 10000) / 10000, brief: { ...run.brief, preset: undefined, seeds: seeds.slice(0, MAX_SEEDS) } };
}
