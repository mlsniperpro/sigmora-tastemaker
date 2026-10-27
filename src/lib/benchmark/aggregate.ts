/** Pure aggregation for the Culture Miss Rate benchmark (scripts/benchmark.ts does the I/O). */
import type { Family } from "../agent/brief";
import { DEFAULT_CRITIC } from "../agent/context";
import type { Metrics, Receipt } from "../agent/types";
import type { JudgeSummary } from "./judge";

/** What the sensitivity analysis needs from a receipt. */
export type SensReceipt = Pick<Receipt, "verdict" | "affinity" | "poolMedian">;

export interface BenchRow {
  subject: string;
  family: Family;
  grounded: Metrics;
  baseline: Metrics;
  /** The receipts behind the metrics, for re-scoring at other pass bars. */
  receipts?: { grounded: SensReceipt[]; baseline: SensReceipt[] };
  sources: string[];
  fallbacks: number;
  qlooCalls: number;
  error?: string;
}

export interface Totals {
  picks: number;
  /** Picks Qloo couldn't score; excluded from every rate's denominator. */
  unscored: number;
  hallucinations: number;
  misses: number;
  fading: number;
  hallucinationRate: number;
  cultureMissRate: number;
  fadingRate: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function totals(ms: readonly Metrics[]): Totals {
  const t = ms.reduce(
    (a, m) => ({ picks: a.picks + m.picks, unscored: a.unscored + m.unscored, hallucinations: a.hallucinations + m.hallucinations, misses: a.misses + m.misses, fading: a.fading + m.fading }),
    { picks: 0, unscored: 0, hallucinations: 0, misses: 0, fading: 0 },
  );
  const judged = t.picks - t.unscored;
  // 0 when nothing was judged; summarize() then marks the run invalid, so it is never published.
  const rate = (n: number) => (judged ? r3(n / judged) : 0);
  return { ...t, hallucinationRate: rate(t.hallucinations), cultureMissRate: rate(t.hallucinations + t.misses), fadingRate: rate(t.fading) };
}

/** Pass-bar multipliers the report re-scores at (the critic uses 0.7 × the pool median). */
export const SENSITIVITY_RATIOS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

/**
 * The Culture Miss Rate if the bar were `ratio` × the pool median instead.
 * Only median-bar picks move; not-found picks, city ranks and venue-in-city
 * checks keep their verdicts; unscored picks stay out of the denominator.
 */
export function missRateAt(receipts: readonly SensReceipt[], ratio: number, minAffinity = DEFAULT_CRITIC.minAffinity): number {
  let judged = 0;
  let missed = 0;
  for (const r of receipts) {
    if (r.verdict === "unscored") continue;
    judged++;
    if (r.verdict === "hallucination") missed++;
    else if (r.affinity !== undefined && r.poolMedian !== undefined) {
      if (r.affinity < Math.max(minAffinity, ratio * r.poolMedian)) missed++;
    } else if (r.verdict === "miss") missed++;
  }
  return judged ? r3(missed / judged) : 0;
}

export interface BenchSummary {
  /** True only for a measurement that may be quoted. */
  valid: boolean;
  /** Why it isn't a measurement, when it isn't. */
  invalidReasons: string[];
  ranAt: string;
  model: string;
  modelScripted: boolean;
  qlooSources: string[];
  qlooFallbacks: number;
  qlooCalls: number;
  briefs: number;
  completed: number;
  baseline: Totals;
  grounded: Totals;
  byFamily: Record<Family, { baseline: Totals; grounded: Totals }>;
  /** Briefs that didn't complete, and why. */
  failures: { subject: string; error: string }[];
  /** Culture Miss Rate at other pass bars (empty when the rows carry no receipts). */
  sensitivity: { ratio: number; baseline: number; grounded: number }[];
  judge?: JudgeSummary & { model: string; sameAsGenerator: boolean; replayed: number; live: number; errors: string[] };
}

const FAMILIES: Family[] = ["music", "dtc", "sports"];

export function summarize(
  rows: readonly BenchRow[],
  meta: { briefs: number; model: string; modelScripted: boolean; ranAt: string; judge?: BenchSummary["judge"] },
): BenchSummary {
  const ok = rows.filter((r) => !r.error);
  const qlooSources = [...new Set(ok.flatMap((r) => r.sources))].sort();
  const qlooFallbacks = ok.reduce((n, r) => n + r.fallbacks, 0);
  const invalidReasons = [
    ...(ok.length < meta.briefs ? [`${meta.briefs - ok.length} of ${meta.briefs} briefs failed`] : []),
    ...(meta.modelScripted ? ["drafts came from the scripted offline model, not an LLM"] : []),
    ...(qlooSources.some((s) => s !== "live" && s !== "replay") ? [`Qloo answers came from: ${qlooSources.join(", ")}`] : []),
    ...(qlooFallbacks ? [`${qlooFallbacks} Qloo calls fell back after a live failure`] : []),
    // A rate over a sliver of the picks (or none) would read as a real number it isn't.
    ...(["baseline", "grounded"] as const).flatMap((side) => {
      const t = totals(ok.map((r) => r[side]));
      return (t.picks - t.unscored) * 2 < t.picks ? [`Qloo judged only ${t.picks - t.unscored} of the ${side} plans' ${t.picks} picks`] : [];
    }),
  ];
  return {
    valid: invalidReasons.length === 0,
    invalidReasons,
    ranAt: meta.ranAt,
    model: meta.model,
    modelScripted: meta.modelScripted,
    qlooSources,
    qlooFallbacks,
    qlooCalls: rows.reduce((n, r) => n + r.qlooCalls, 0),
    briefs: meta.briefs,
    completed: ok.length,
    baseline: totals(ok.map((r) => r.baseline)),
    grounded: totals(ok.map((r) => r.grounded)),
    byFamily: Object.fromEntries(
      FAMILIES.map((f) => [f, { baseline: totals(ok.filter((r) => r.family === f).map((r) => r.baseline)), grounded: totals(ok.filter((r) => r.family === f).map((r) => r.grounded)) }]),
    ) as BenchSummary["byFamily"],
    failures: rows.flatMap((r) => (r.error ? [{ subject: r.subject, error: r.error }] : [])),
    sensitivity: ok.every((r) => r.receipts)
      ? SENSITIVITY_RATIOS.map((ratio) => ({
          ratio,
          baseline: missRateAt(ok.flatMap((r) => r.receipts?.baseline ?? []), ratio),
          grounded: missRateAt(ok.flatMap((r) => r.receipts?.grounded ?? []), ratio),
        }))
      : [],
    judge: meta.judge,
  };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const row = (name: string, t: Totals) => `| ${name} | ${t.picks} | ${t.unscored} | ${pct(t.hallucinationRate)} | ${pct(t.cultureMissRate)} | ${pct(t.fadingRate)} |`;

const METHOD = (briefs: number) => `## Method

- ${briefs} briefs (benchmark/briefs.ts): 10 music releases, 10 DTC city launches, 10 sports-club fan markets.
- For each brief the **same model** drafts two plans: one with Qloo grounding and the Qloo critic loop, one with no Qloo access.
- Every cultural entity each plan names is resolved with Qloo \`/search\` and scored with \`/v2/insights\` + \`filter.results.entities\` + \`feature.explainability\` against the brief's audience signal, with no trend bias or diversification on scoring calls.
- **Not-found ("hallucination") rate:** named entities with no match in a typed or an untyped Qloo \`/search\`. Real entities outside Qloo's catalogue land here too, so this is an upper bound on invention. A real entity Qloo files under another type counts as a miss for its role.
- **Unscored:** picks Qloo returned no affinity for (or whose role had no candidate pool); they are excluded from every rate's denominator and shown in the Unscored column.
- **Culture Miss Rate:** hallucinations plus resolved picks scoring below the pass bar (max(0.25, 0.7 × the median plain affinity of the candidates Qloo returned for that role: up to 10, trend-biased lists re-scored without the bias); launch city: outside the top 3 ranked metros; venues: outside the launch city's boundary, checked with \`filter.location.radius=0\` so Qloo doesn't pad it).
- **Fading-reference rate:** hook references that clear the bar but whose newest /v2/trending reading (a 6-week window) has \`population_percent_delta\` below −3 (provisional until the first live recording).
- The grounded plan is scored after the critic loop (up to 2 revise rounds), so it measures the shipped plan. The pass bar is the one the critic uses, so this measures what the product ships, not an independent judgment of taste — which is what the judge below is for.
- **Blind pairwise preference (LLM judge).** A separate judge model (\`JUDGE_*\` env, falling back to \`LLM_*\`) sees the brief and both plans as "Plan 1" / "Plan 2", with Qloo mentions and affinity scores removed, and scores audience fit, specificity, credibility and freshness (src/lib/benchmark/judge.ts). The first order is random (seeded per brief); every pair is judged again with positions swapped, and a winner counts only if both orders agree, otherwise it's a tie. This is an LLM judge, disclosed as such; when the judge is the same model as the generator, self-preference is possible and the report says so. Judge replies are recorded in fixtures/judge/recorded.json and replayed on reruns.`;

const failureList = (s: BenchSummary) =>
  s.failures.length ? `\n### Failed briefs\n\n${s.failures.map((f) => `- ${f.subject}: ${f.error}`).join("\n")}\n` : "";

const sensitivityTable = (s: BenchSummary) =>
  s.sensitivity.length
    ? `
### How much the pass bar matters

The critic's bar is 0.7 × the median affinity of Qloo's candidates for the role. The same receipts re-scored at other multipliers (only median-bar picks move; the grounded plan is drafted from those candidates, so it passes most bars by construction, which is why the blind judge below exists):

| Bar (× pool median) | Without Qloo | Tastemaker |
|---|---|---|
${s.sensitivity.map((x) => `| ${x.ratio.toFixed(1)}${x.ratio === DEFAULT_CRITIC.missRatio ? " (used)" : ""} | ${pct(x.baseline)} | ${pct(x.grounded)} |`).join("\n")}
`
    : "";

/** docs/benchmark.md. Numbers appear only for a valid measurement (the playbook's no-placeholder-numbers rule). */
export function renderReport(s: BenchSummary): string {
  if (!s.valid) {
    return `# Culture Miss Rate benchmark

> **No measurement yet.** The last run does not count: ${s.invalidReasons.join("; ")}. Its numbers are not published here. A measurement needs a real LLM, live (or recorded-live) Qloo responses with no fallbacks, and all ${s.briefs} briefs completed. Run \`pnpm benchmark\` with \`QLOO_API_KEY\`, \`LLM_PROVIDER\`, \`LLM_MODEL\`, \`LLM_API_KEY\` (and optionally \`JUDGE_*\`) set and \`QLOO_DAILY_CALL_CAP\` above ${s.qlooCalls}, the request count of that run.
${failureList(s)}
${METHOD(s.briefs)}
`;
  }
  const j = s.judge;
  const judge = j
    ? `
## Blind pairwise preference (LLM judge: \`${j.model}\`${j.sameAsGenerator ? ", the same model as the generator — self-preference possible" : ""})

| Pairs | Tastemaker wins | Without-Qloo wins | Ties | Of which inconsistent across orders | Tastemaker win rate (decided pairs) |
|---|---|---|---|---|---|
| ${j.pairs} | ${j.groundedWins} | ${j.baselineWins} | ${j.ties} | ${j.inconsistent} | ${j.groundedWinRate === undefined ? "—" : pct(j.groundedWinRate)} |

Mean criterion scores (1–5, both orders): Tastemaker ${Object.entries(j.meanScores.grounded).map(([k, v]) => `${k} ${v}`).join(", ")}; without Qloo ${Object.entries(j.meanScores.baseline).map(([k, v]) => `${k} ${v}`).join(", ")}.
${
  j.errors.length
    ? `\n**Incomplete:** ${j.errors.length} of ${j.pairs + j.errors.length} pairs could not be judged, so these figures cover ${j.pairs} pairs only:\n\n${j.errors.map((e) => `- ${e}`).join("\n")}\n`
    : ""
}`
    : `
## Blind pairwise preference

Not run: no judge model configured (\`JUDGE_*\` or \`LLM_*\`).
`;
  return `# Culture Miss Rate benchmark

Generated by \`pnpm benchmark\` (scripts/benchmark.ts) at ${s.ranAt} with model \`${s.model}\`, Qloo sources \`${s.qlooSources.join(", ")}\`. Summary: [benchmark/summary.json](../benchmark/summary.json).

${METHOD(s.briefs)}

## Results (${s.completed}/${s.briefs} briefs)

| Plan | Picks | Unscored | Not-found rate | Culture Miss Rate | Fading-reference rate |
|---|---|---|---|---|---|
${row("Without Qloo", s.baseline)}
${row("Tastemaker (with Qloo)", s.grounded)}
${failureList(s)}${sensitivityTable(s)}

### By family

| Family / plan | Picks | Unscored | Not-found rate | Culture Miss Rate | Fading-reference rate |
|---|---|---|---|---|---|
${FAMILIES.flatMap((f) => [row(`${f}: without Qloo`, s.byFamily[f].baseline), row(`${f}: with Qloo`, s.byFamily[f].grounded)]).join("\n")}
${judge}`;
}
