/**
 * Blind pairwise LLM judge for the Culture Miss Rate benchmark.
 *
 * The judge sees the brief and two plans labelled only "Plan 1" and "Plan 2":
 * no mention of Qloo, no receipts, no rationales (they can carry affinity
 * scores). Which plan is shown first is random (seeded per brief, so a rerun
 * asks the same prompts and replays from fixtures). Every pair is judged twice
 * with the positions swapped; a winner counts only if both orders agree,
 * otherwise the pair is a tie. That cancels position bias rather than
 * averaging it in.
 */
import { z } from "zod";
import type { Brief } from "../agent/brief";
import type { ChatClient } from "../llm/chat";
import { LLMOutputError, extractJson } from "../llm/coerce";
import type { Draft } from "../llm/types";
import { formatZodIssues } from "../zod";

export const CRITERIA = ["audienceFit", "specificity", "credibility", "freshness"] as const;

export const JUDGE_SYSTEM = `You are an impartial senior brand strategist judging two launch-campaign plans for the same brief.
Score each plan from 1 to 5 on four criteria:
- audienceFit: would this exact audience (ages, tastes named in the brief) recognise and love these artists, brands, shows, podcasts, venues, creators and city?
- specificity: are the cultural picks specific and well matched rather than famous-but-generic?
- credibility: are all named entities real, and is every claim plausible? Invented or doubtful names score low.
- freshness: are the references current for this audience rather than dated?
Then pick the better plan overall, or "tie" only if they are genuinely equivalent.
Ignore length, formatting and the order in which the plans appear.
Return ONLY JSON: {"scores": {"1": {"audienceFit": n, "specificity": n, "credibility": n, "freshness": n}, "2": {…}}, "winner": "1" | "2" | "tie", "reason": "<one sentence>"}`;

const Score = z.coerce.number().int().min(1).max(5);
const Scores = z.object(Object.fromEntries(CRITERIA.map((c) => [c, Score])) as Record<(typeof CRITERIA)[number], typeof Score>);
export const JudgeReply = z.object({
  scores: z.object({ "1": Scores, "2": Scores }),
  winner: z.enum(["1", "2", "tie"]),
  reason: z.string().max(1000).default(""),
});
export type JudgeReply = z.infer<typeof JudgeReply>;

export type Side = "grounded" | "baseline";
export type Outcome = Side | "tie";

const flip = (s: Side): Side => (s === "grounded" ? "baseline" : "grounded");

const SCORE = String.raw`(?:0?\.\d+|[01](?:\.\d+)?)`;
const TELLS = [
  // "Qloo-verified", "Qloo backed", …: the grounded plan's own badges.
  /\bqloo[-\s]?(?:verified|backed|grounded|preferred|scored|approved|checked|ranked)\b/gi,
  // "affinity 0.82", "affinity score of 1.0", "(affinity 0.9)"
  new RegExp(String.raw`\(?\s*\baffinity(?:\s+score)?(?:\s+of)?\s*:?\s*${SCORE}\b\s*\)?`, "gi"),
  // a bare score in parentheses: "(0.87)", "(1.00)"
  new RegExp(String.raw`\(\s*${SCORE}\s*\)`, "g"),
];
/** Removes what would tell the judge which plan had Qloo: the name, badges and inline scores. */
export const blind = (text: string) =>
  TELLS.reduce((t, re) => t.replace(re, ""), text)
    .replace(/\bqloo\b/gi, "data")
    .replace(/ {2,}/g, " ");

/** What the judge sees of a plan: the copy and the named picks, nothing that reveals how they were chosen. */
export function renderPlan(d: Draft): string {
  return blind([
    `Positioning: ${d.positioning}`,
    `Hooks:\n${d.hooks.map((h) => `- ${h}`).join("\n")}`,
    `30-second script: ${d.script}`,
    `Captions:\n${d.captions.map((c) => `- ${c.platform}: ${c.text}`).join("\n")}`,
    `Music & visual brief: ${d.musicBrief}`,
    `Named picks:\n${d.picks.map((p) => `- ${p.role}: ${p.name}`).join("\n")}`,
  ].join("\n"));
}

export function renderBrief(b: Brief): string {
  return [
    `${b.subject} is launching ${b.product}.`,
    `Goal: ${b.goal}`,
    `Audience: ages ${b.ages.map((a) => a.replace(/_/g, " ")).join(", ")}${b.gender ? `, ${b.gender}-skewed` : ""}; they already love ${b.seeds.join(", ")}.`,
    b.targetCity ? `Market: ${b.targetCity}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function judgePrompt(brief: Brief, first: Draft, second: Draft): string {
  return `Brief:\n${renderBrief(brief)}\n\n=== Plan 1 ===\n${renderPlan(first)}\n\n=== Plan 2 ===\n${renderPlan(second)}`;
}

/** Deterministic PRNG (mulberry32) seeded from a string, so the random order is reproducible. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h << 13) | (h >>> 19);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Maps the judge's "1" / "2" / "tie" back to which side was shown in that slot. */
export function sideOf(winner: JudgeReply["winner"], firstShown: Side): Outcome {
  if (winner === "tie") return "tie";
  const other = flip(firstShown);
  return winner === "1" ? firstShown : other;
}

/** Both orders must agree; disagreement is position bias, scored as a tie. */
export function combine(a: Outcome, b: Outcome): { final: Outcome; consistent: boolean } {
  return a === b ? { final: a, consistent: true } : { final: "tie", consistent: false };
}

async function ask(chat: ChatClient, user: string): Promise<JudgeReply> {
  const parse = (text: string) => {
    const r = JudgeReply.safeParse(extractJson(text));
    if (!r.success) throw new LLMOutputError(`judge reply is not a verdict: ${formatZodIssues(r.error, { max: 3 })}`);
    return r.data;
  };
  try {
    return parse(await chat.complete(JUDGE_SYSTEM, user));
  } catch (err) {
    if (!(err instanceof LLMOutputError)) throw err;
    // One repair attempt for an unusable verdict; transport errors were already retried by the client.
    return parse(await chat.complete(JUDGE_SYSTEM, `${user}\n\nYour previous answer was not valid JSON for the required shape. Return only the JSON object.`));
  }
}

export interface PairJudgement {
  /** Which side was shown as Plan 1 in the first ordering. */
  firstShown: Side;
  orders: { firstShown: Side; reply: JudgeReply; outcome: Outcome }[];
  final: Outcome;
  consistent: boolean;
}

export async function judgePair(chat: ChatClient, brief: Brief, grounded: Draft, baseline: Draft, random: () => number): Promise<PairJudgement> {
  const firstShown: Side = random() < 0.5 ? "grounded" : "baseline";
  const plan = (s: Side) => (s === "grounded" ? grounded : baseline);
  // The two orders are independent, so they're asked concurrently.
  const [a, b] = await Promise.all(
    [firstShown, flip(firstShown)].map(async (shown) => {
      const reply = await ask(chat, judgePrompt(brief, plan(shown), plan(flip(shown))));
      return { firstShown: shown, reply, outcome: sideOf(reply.winner, shown) };
    }) as [Promise<PairJudgement["orders"][number]>, Promise<PairJudgement["orders"][number]>],
  );
  return { firstShown, orders: [a, b], ...combine(a.outcome, b.outcome) };
}

export interface JudgeSummary {
  pairs: number;
  groundedWins: number;
  baselineWins: number;
  ties: number;
  /** Pairs whose two orderings disagreed (counted as ties). */
  inconsistent: number;
  /** Grounded wins / decided pairs; undefined when nothing was decided. */
  groundedWinRate?: number;
  /** Mean criterion scores per side, across both orderings. */
  meanScores: Record<Side, Record<(typeof CRITERIA)[number], number>>;
}

export function summarizeJudgements(js: readonly PairJudgement[]): JudgeSummary {
  const count = (o: Outcome) => js.filter((j) => j.final === o).length;
  const groundedWins = count("grounded");
  const baselineWins = count("baseline");
  const mean = (side: Side) =>
    Object.fromEntries(
      CRITERIA.map((c) => {
        const xs = js.flatMap((j) => j.orders.map((o) => o.reply.scores[o.firstShown === side ? "1" : "2"][c]));
        return [c, xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0];
      }),
    ) as Record<(typeof CRITERIA)[number], number>;
  const decided = groundedWins + baselineWins;
  return {
    pairs: js.length,
    groundedWins,
    baselineWins,
    ties: count("tie"),
    inconsistent: js.filter((j) => !j.consistent).length,
    groundedWinRate: decided ? Math.round((groundedWins / decided) * 1000) / 1000 : undefined,
    meanScores: { grounded: mean("grounded"), baseline: mean("baseline") },
  };
}
