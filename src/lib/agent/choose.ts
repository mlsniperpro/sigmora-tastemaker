/**
 * The model chooses among Qloo-approved options, or proposes its own idea,
 * which Qloo scores first; code accepts only listed options and own ideas
 * that passed. A choice outside a swap's options, or one another swap already
 * took, falls back to Qloo's next option, so a hallucination can't re-enter
 * through a choice.
 */
import type { Choice, Pick, Replacement } from "../llm/types";
import type { Receipt } from "./types";
import { normName } from "./util";

/** At most this many own ideas are scored per round (each costs a resolve and a score call). */
export const MAX_OWN_IDEAS = 2;

export interface Chosen {
  replacements: Replacement[];
  /** One line per swap for the trace: what was chosen from what, and why. */
  notes: string[];
}

/** The model's own ideas worth a Qloo check, as picks: one per swap, new names only, capped. */
export function ownProposals(offered: readonly Replacement[], choices: readonly Choice[], taken: ReadonlySet<string>): { from: string; pick: Pick }[] {
  const out: { from: string; pick: Pick }[] = [];
  const seen = new Set(taken);
  for (const c of choices) {
    if (!c.own || out.length >= MAX_OWN_IDEAS) continue;
    const r = offered.find((o) => normName(o.from) === normName(c.from));
    const key = normName(c.to);
    if (!r || !key || seen.has(key) || out.some((p) => p.from === r.from)) continue;
    seen.add(key);
    out.push({ from: r.from, pick: { name: c.to, type: r.type, role: r.role, rationale: c.why } });
  }
  return out;
}

/** Offers back the own ideas Qloo passed, as each swap's first option, with Qloo's score. */
export function withOwnIdeas(offered: readonly Replacement[], proposals: readonly { from: string; pick: Pick }[], verdicts: readonly Receipt[]): Replacement[] {
  return offered.map((r) => {
    const p = proposals.find((x) => x.from === r.from);
    const v = p && verdicts.find((x) => x.role === p.pick.role && normName(x.name) === normName(p.pick.name));
    if (!p || v?.verdict !== "pass") return r;
    const options = r.options?.length ? r.options : [{ name: r.to, type: r.type, affinity: Number.NaN }];
    return { ...r, options: [{ name: v.name, type: p.pick.type, affinity: v.affinity ?? Number.NaN, own: true }, ...options] };
  });
}

export function applyChoices(replacements: readonly Replacement[], choices: readonly Choice[], verdicts: readonly Receipt[] = []): Chosen {
  const taken = new Set<string>();
  const notes: string[] = [];
  const out: Replacement[] = [];
  for (const r of replacements) {
    const options = r.options?.length ? r.options : [{ name: r.to, type: r.type, affinity: Number.NaN }];
    const choice = choices.find((c) => normName(c.from) === normName(r.from));
    const wanted = choice ? options.find((o) => normName(o.name) === normName(choice.to)) : undefined;
    const pick = [wanted, ...options].find((o) => o && !taken.has(normName(o.name)));
    if (!pick) continue;
    taken.add(normName(pick.name));
    const byModel = wanted !== undefined && pick === wanted;
    const own = byModel && "own" in pick && pick.own === true;
    const list = options.filter((o) => !("own" in o && o.own)).map((o) => o.name).join(", ");
    const score = Number.isNaN(pick.affinity) ? "" : ` (affinity ${pick.affinity.toFixed(2)})`;
    const failed = choice?.own && !byModel ? verdicts.find((v) => normName(v.name) === normName(choice.to)) : undefined;
    notes.push(
      own
        ? `${r.from} → ${pick.name} (the model's own idea, which passed Qloo's check${score}: ${choice?.why ?? ""})`
        : byModel
          ? `${r.from} → ${pick.name} (model's choice from ${list}: ${choice?.why ?? ""})`
          : choice?.own
            ? `${r.from} → ${pick.name} (Qloo's top option: the model's own idea "${choice.to}" ${failed ? `came back ${failed.verdict}` : "wasn't checked"})`
            : `${r.from} → ${pick.name} (Qloo's top available option${choice ? `; the model's "${choice.to}" wasn't one of ${list}` : ""})`,
    );
    out.push({
      ...r,
      to: pick.name,
      type: pick.type,
      reason: own
        ? `${r.reason} The model proposed ${pick.name} itself, and Qloo scored it above the bar${score}: ${choice?.why ?? ""}`
        : byModel
          ? `${r.reason} The model chose ${pick.name} from Qloo-approved ${list}: ${choice?.why ?? ""}`
          : r.reason,
    });
  }
  return { replacements: out, notes };
}
