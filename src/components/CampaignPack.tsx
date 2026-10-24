"use client";

import { Fragment } from "react";
import { ROLE_LABEL, ROLES } from "@/lib/vocab";
import type { PlanSide, Receipt, Verdict } from "@/lib/agent/types";
import { annotation } from "@/lib/agent/evidence";
import { ReceiptChip, VERDICT_STYLE } from "./Receipt";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Struck through: the critic rejected these. Fading is a warning and "unscored" means Qloo gave no score, so neither is struck. */
const STRUCK: ReadonlySet<Verdict> = new Set(["miss", "hallucination"]);

/** Marks every named entity in a text field with its verdict. */
function Marked({ text, receipts }: { text: string; receipts: Receipt[] }) {
  const names = [...new Set(receipts.map((r) => r.name))].sort((a, b) => b.length - a.length);
  if (!names.length) return <>{text}</>;
  // Whole words only, any case: "Tems" mustn't mark "Temsy", and "the weeknd" should mark "The Weeknd".
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${names.map(esc).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return (
    <>
      {text.split(re).map((part, i) => {
        const r = receipts.find((x) => x.name.toLowerCase() === part.toLowerCase());
        if (!r) return <Fragment key={i}>{part}</Fragment>;
        if (r.verdict === "pass") return <span key={i} className="text-ink underline decoration-pass/60 decoration-2 underline-offset-2">{part}</span>;
        const v = VERDICT_STYLE[r.verdict];
        return (
          <span key={i} className={`rounded px-0.5 ${v.cls} ${STRUCK.has(r.verdict) ? "line-through decoration-2" : ""}`} title={r.note}>
            {part}
          </span>
        );
      })}
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </div>
  );
}

export function CampaignPack({ side, mode }: { side: PlanSide; mode: "qloo" | "without" }) {
  const { draft, receipts } = side;
  if (side.unavailable) {
    return (
      <section aria-label="Campaign pack" className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold tracking-wide text-ink">Campaign pack — without Qloo</h2>
        <p className="mt-2 text-body text-muted">The same model&apos;s draft without Qloo failed on this run ({side.unavailable}). Run the brief again to compare.</p>
      </section>
    );
  }
  const byRole = ROLES.map((role) => ({ role, items: receipts.filter((r) => r.role === role) })).filter((g) => g.items.length);
  return (
    <section aria-label="Campaign pack" className="space-y-4 rounded-2xl border border-line bg-panel p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-ink">{mode === "qloo" ? "Campaign pack" : "Campaign pack — without Qloo"}</h2>
        <span className="text-label text-muted">{mode === "qloo" ? "every pick carries a receipt" : "same model, no Qloo access; audited by Qloo"}</span>
      </header>

      <Block title="Positioning">
        <p className="text-lead leading-relaxed text-ink">
          <Marked text={draft.positioning} receipts={receipts} />
        </p>
      </Block>

      <Block title="Hooks">
        <ul className="space-y-2">
          {draft.hooks.map((h, i) => (
            <li key={i} className="rounded-lg border border-line bg-panel-2/60 p-2.5 text-body leading-snug">
              <Marked text={h} receipts={receipts} />
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Cultural picks">
        <ul className="space-y-2.5">
          {byRole.map(({ role, items }) =>
            items.map((r) => (
              <li key={`${role}-${r.name}`} className="space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-label uppercase tracking-wider text-muted">{ROLE_LABEL[role]}</span>
                  <span className={`text-body font-medium ${r.verdict === "pass" ? "text-ink" : r.verdict === "fading" ? "text-fade" : r.verdict === "unscored" ? "text-muted" : "text-miss line-through"}`}>
                    {r.name}
                  </span>
                  {r.replaced && (
                    <span className="text-caption text-muted">
                      replaced <span className="line-through">{r.replaced.name}</span>
                    </span>
                  )}
                </div>
                {r.verdict !== "pass" && <p className="text-caption leading-snug text-muted">{annotation(r)}</p>}
                <ReceiptChip r={r} />
              </li>
            )),
          )}
        </ul>
      </Block>

      <Block title="30-second script">
        <p className="text-body-sm leading-relaxed text-ink/90">
          <Marked text={draft.script} receipts={receipts} />
        </p>
      </Block>

      <Block title="Captions">
        <ul className="space-y-1.5">
          {draft.captions.map((c) => (
            <li key={`${c.platform}-${c.text}`} className="text-body-sm leading-snug">
              <span className="mr-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-label font-medium text-violet">{c.platform}</span>
              <Marked text={c.text} receipts={receipts} />
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Music & visual brief">
        <p className="text-body-sm leading-relaxed text-ink/90">
          <Marked text={draft.musicBrief} receipts={receipts} />
        </p>
      </Block>
    </section>
  );
}
