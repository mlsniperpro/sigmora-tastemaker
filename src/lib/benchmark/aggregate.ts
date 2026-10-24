/** Pure aggregation for the Culture Miss Rate benchmark (scripts/benchmark.ts does the I/O). */
import type { Family } from "../agent/brief";
import type { Metrics } from "../agent/types";
import type { JudgeSummary } from "./judge";

export interface BenchRow {
  subject: string;
  family: Family;
  grounded: Metrics;
  baseline: Metrics;
  sources: string[];
  fallbacks: number;
  qlooCalls: number;
  error?: string;
}

export interface Totals {
  picks: number;
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
    (a, m) => ({ picks: a.picks + m.picks, hallucinations: a.hallucinations + m.hallucinations, misses: a.misses + m.misses, fading: a.fading + m.fading }),
    { picks: 0, hallucinations: 0, misses: 0, fading: 0 },
  );
  const rate = (n: number) => (t.picks ? r3(n / t.picks) : 0);
  return { ...t, hallucinationRate: rate(t.hallucinations), cultureMissRate: rate(t.hallucinations + t.misses), fadingRate: rate(t.fading) };
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
    judge: meta.judge,
  };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const row = (name: string, t: Totals) => `| ${name} | ${t.picks} | ${pct(t.hallucinationRate)} | ${pct(t.cultureMissRate)} | ${pct(t.fadingRate)} |`;

const METHOD = (briefs: number) => `## Method

- ${briefs} briefs (benchmark/briefs.ts): 10 music releases, 10 DTC city launches, 10 sports-club fan markets.
- For each brief the **same model** drafts two plans: one with Qloo grounding and the Qloo critic loop, one with no Qloo access.
- Every cultural entity each plan names is resolved with Qloo \`/search\` and scored with \`/v2/insights\` + \`filter.results.entities\` + \`feature.explainability\` against the brief's audience signal, with no trend bias or diversification on scoring calls.
- **Hallucination rate:** named entities that do not resolve to any Qloo entity.
- **Culture Miss Rate:** hallucinations plus resolved picks scoring below the pass bar (max(0.25, 0.7 × the median plain affinity of the candidates Qloo returned for that role: up to 10, brand and venue lists diversified by subtype, trend-biased lists re-scored without the bias); launch city: outside the top 3 ranked metros; venues: not in the launch city).
- **Fading-reference rate:** hook references that clear the bar but have /v2/trending velocity below −0.3.
- The grounded plan is scored after the critic loop (up to 2 revise rounds), so it measures the shipped plan. The pass bar is the one the critic uses, so this measures what the product ships, not an independent judgment of taste — which is what the judge below is for.
- **Blind pairwise preference (LLM judge).** A separate judge model (\`JUDGE_*\` env, falling back to \`LLM_*\`) sees the brief and both plans as "Plan 1" / "Plan 2", with Qloo mentions and affinity scores removed, and scores audience fit, specificity, credibility and freshness (src/lib/benchmark/judge.ts). The first order is random (seeded per brief); every pair is judged again with positions swapped, and a winner counts only if both orders agree, otherwise it's a tie. This is an LLM judge, disclosed as such; when the judge is the same model as the generator, self-preference is possible and the report says so. Judge replies are recorded in fixtures/judge/recorded.json and replayed on reruns.`;

const failureList = (s: BenchSummary) =>
  s.failures.length ? `\n### Failed briefs\n\n${s.failures.map((f) => `- ${f.subject}: ${f.error}`).join("\n")}\n` : "";

/** docs/benchmark.md. Numbers appear only for a valid measurement (the playbook's no-placeholder-numbers rule). */
export function renderReport(s: BenchSummary): string {
  if (!s.valid) {
    return `# Culture Miss Rate benchmark

> **No measurement yet.** The last run (${s.ranAt}) does not count: ${s.invalidReasons.join("; ")}. Its numbers are not published here. A measurement needs a real LLM, live (or recorded-live) Qloo responses with no fallbacks, and all ${s.briefs} briefs completed. Run \`pnpm benchmark\` with \`QLOO_API_KEY\`, \`LLM_PROVIDER\`, \`LLM_MODEL\`, \`LLM_API_KEY\` (and optionally \`JUDGE_*\`) set and \`QLOO_DAILY_CALL_CAP\` above ${s.qlooCalls}, the request count of that run.
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

| Plan | Picks | Hallucination rate | Culture Miss Rate | Fading-reference rate |
|---|---|---|---|---|
${row("Without Qloo", s.baseline)}
${row("Tastemaker (with Qloo)", s.grounded)}
${failureList(s)}

### By family

| Family / plan | Picks | Hallucination rate | Culture Miss Rate | Fading-reference rate |
|---|---|---|---|---|
${FAMILIES.flatMap((f) => [row(`${f}: without Qloo`, s.byFamily[f].baseline), row(`${f}: with Qloo`, s.byFamily[f].grounded)]).join("\n")}
${judge}`;
}
