/**
 * The model chooses among Qloo-approved options; code accepts only those.
 * A choice outside a swap's options, or one another swap already took, falls
 * back to Qloo's next option, so a hallucination can't re-enter through a choice.
 */
import type { Choice, Replacement } from "../llm/types";
import { normName } from "./util";

export interface Chosen {
  replacements: Replacement[];
  /** One line per swap for the trace: what was chosen from what, and why. */
  notes: string[];
}

export function applyChoices(replacements: readonly Replacement[], choices: readonly Choice[]): Chosen {
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
    const list = options.map((o) => o.name).join(", ");
    notes.push(
      byModel
        ? `${r.from} → ${pick.name} (model's choice from ${list}: ${choice?.why ?? ""})`
        : `${r.from} → ${pick.name} (Qloo's top available option${choice ? `; the model's "${choice.to}" wasn't one of ${list}` : ""})`,
    );
    out.push({
      ...r,
      to: pick.name,
      type: pick.type,
      reason: byModel ? `${r.reason} The model chose ${pick.name} from Qloo-approved ${list}: ${choice?.why ?? ""}` : r.reason,
    });
  }
  return { replacements: out, notes };
}
