/**
 * Culture Miss Rate benchmark: run the same model on 30 briefs with and
 * without Qloo, audit both plans with the Qloo critic, ask a blind pairwise
 * LLM judge which plan is better, and write the report.
 *
 *   pnpm benchmark
 *
 * Raw runs go to benchmark/runs/ (gitignored). docs/benchmark.md and
 * benchmark/summary.json carry numbers only when the run is a valid
 * measurement (real LLM, live or recorded-live Qloo, no fallbacks, all briefs).
 * Judge replies are replayed from fixtures/judge/recorded.json when present
 * and recorded there when made live.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BRIEFS } from "../benchmark/briefs";
import { Brief } from "../src/lib/agent/brief";
import { runTastemaker } from "../src/lib/agent/run";
import type { RunResult } from "../src/lib/agent/types";
import { pct, renderReport, summarize, type BenchRow, type BenchSummary } from "../src/lib/benchmark/aggregate";
import { judgePair, seededRandom, summarizeJudgements, type PairJudgement } from "../src/lib/benchmark/judge";
import { judgeChatFromEnv, llmFromEnv } from "../src/lib/llm";
import { ReplayChat } from "../src/lib/llm/chat";
import { qlooFromEnv } from "../src/lib/qloo/client";

const JUDGE_FIXTURES = "fixtures/judge/recorded.json";
const zero = { picks: 0, hallucinations: 0, misses: 0, fading: 0, cultureMissRate: 0 };

const llm = llmFromEnv();
const liveJudge = judgeChatFromEnv();
const judgeFixtures: Record<string, string> = existsSync(JUDGE_FIXTURES) ? (JSON.parse(readFileSync(JUDGE_FIXTURES, "utf8")) as Record<string, string>) : {};
const recorder: Record<string, string> = {};
const judgeModel = liveJudge?.model ?? process.env.JUDGE_MODEL ?? process.env.LLM_MODEL;
const judge = judgeModel && (liveJudge || Object.keys(judgeFixtures).length) ? new ReplayChat(judgeModel, judgeFixtures, liveJudge, recorder) : undefined;

const rows: BenchRow[] = [];
const runs: RunResult[] = [];
const judgements: PairJudgement[] = [];
const judgeErrors: string[] = [];

for (const input of BRIEFS) {
  const brief = Brief.parse(input);
  try {
    // A fresh client per brief: the per-run Qloo call budget applies to each run, not to the whole benchmark.
    const r = await runTastemaker(brief, { qloo: qlooFromEnv(), llm });
    runs.push(r);
    rows.push({ subject: brief.subject, family: brief.family, grounded: r.metrics.grounded, baseline: r.metrics.baseline, sources: r.sources, fallbacks: r.qloo.fallbackCalls, qlooCalls: r.qloo.calls });
    if (judge) {
      try {
        judgements.push(await judgePair(judge, brief, r.grounded.draft, r.baseline.draft, seededRandom(brief.subject)));
      } catch (err) {
        judgeErrors.push(`${brief.subject}: ${(err as Error).message}`);
      }
    }
    console.log(`${brief.subject.padEnd(10)} done`);
  } catch (err) {
    rows.push({ subject: brief.subject, family: brief.family, grounded: zero, baseline: zero, sources: [], fallbacks: 0, qlooCalls: 0, error: (err as Error).message });
    console.error(`${brief.subject}: ${(err as Error).message}`);
  }
}

const ranAt = new Date().toISOString();
const summary: BenchSummary = summarize(rows, {
  briefs: BRIEFS.length,
  model: llm.id,
  modelScripted: llm.scripted,
  ranAt,
  judge:
    judge && judgements.length
      ? { ...summarizeJudgements(judgements), model: judge.model, sameAsGenerator: judge.model === llm.label, replayed: judge.replayed, live: judge.live, errors: judgeErrors }
      : undefined,
});

mkdirSync("benchmark/runs", { recursive: true });
writeFileSync(`benchmark/runs/${ranAt.replace(/[:.]/g, "-")}.json`, JSON.stringify({ summary, rows, judgements, judgeErrors, runs }, null, 1) + "\n");
if (Object.keys(recorder).length) {
  mkdirSync("fixtures/judge", { recursive: true });
  writeFileSync(JUDGE_FIXTURES, JSON.stringify({ ...judgeFixtures, ...recorder }, null, 1) + "\n");
}
writeFileSync("docs/benchmark.md", renderReport(summary));
if (summary.valid) writeFileSync("benchmark/summary.json", JSON.stringify(summary, null, 2) + "\n");
else rmSync("benchmark/summary.json", { force: true });

console.log(
  `\n${summary.valid ? "MEASUREMENT" : `NOT A MEASUREMENT (${summary.invalidReasons.join("; ")}) — numbers below are not published`}: ` +
    `Culture Miss Rate without Qloo ${pct(summary.baseline.cultureMissRate)} → with Qloo ${pct(summary.grounded.cultureMissRate)} (${summary.completed} briefs, ${summary.qlooCalls} Qloo requests)`,
);
if (summary.judge) console.log(`Judge ${summary.judge.model}: Tastemaker ${summary.judge.groundedWins} · without Qloo ${summary.judge.baselineWins} · ties ${summary.judge.ties} (${summary.judge.inconsistent} inconsistent)`);
else console.log("Judge: not run (no JUDGE_* / LLM_* model and no recorded verdicts).");
if (judgeErrors.length) console.log(`Judge errors: ${judgeErrors.length}\n- ${judgeErrors.join("\n- ")}`);
