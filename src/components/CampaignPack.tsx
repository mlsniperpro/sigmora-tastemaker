"use client";

import { Fragment } from "react";
import { ROLE_LABEL, ROLES } from "@/lib/agent/brief";
import type { PlanSide, Receipt } from "@/lib/agent/types";
import { ReceiptChip, VERDICT_STYLE } from "./Receipt";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks every named entity in a text field with its verdict. */
function Marked({ text, receipts }: { text: string; receipts: Receipt[] }) {
  const names = [...new Set(receipts.map((r) => r.name))].sort((a, b) => b.length - a.length);
  if (!names.length) return <>{text}</>;
  const re = new RegExp(`(${names.map(esc).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((part, i) => {
        const r = receipts.find((x) => x.name === part);
        if (!r) return <Fragment key={i}>{part}</Fragment>;
        if (r.verdict === "pass") return <span key={i} className="text-ink underline decoration-pass/60 decoration-2 underline-offset-2">{part}</span>;
        const v = VERDICT_STYLE[r.verdict];
        return (
          <span key={i} className={`rounded px-0.5 ${v.cls} ${r.verdict === "fading" ? "" : "line-through decoration-2"}`} title={r.note}>
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
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </div>
  );
}

export function CampaignPack({ side, mode }: { side: PlanSide; mode: "qloo" | "without" }) {
  const { draft, receipts } = side;
  const byRole = ROLES.map((role) => ({ role, items: receipts.filter((r) => r.role === role) })).filter((g) => g.items.length);
  return (
    <section aria-label="Campaign pack" className="space-y-4 rounded-2xl border border-line bg-panel p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-ink">{mode === "qloo" ? "Campaign pack" : "Campaign pack — without Qloo"}</h2>
        <span className="text-[10px] text-muted">{mode === "qloo" ? "every pick carries a receipt" : "same model, no Qloo access; audited by Qloo"}</span>
      </header>

      <Block title="Positioning">
        <p className="text-[14px] leading-relaxed text-ink">
          <Marked text={draft.positioning} receipts={receipts} />
        </p>
      </Block>

      <Block title="Hooks">
        <ul className="space-y-2">
          {draft.hooks.map((h, i) => (
            <li key={i} className="rounded-lg border border-line bg-panel-2/60 p-2.5 text-[13px] leading-snug">
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
                  <span className="text-[10px] uppercase tracking-wider text-muted">{ROLE_LABEL[role]}</span>
                  <span className={`text-[13px] font-medium ${r.verdict === "pass" ? "text-ink" : r.verdict === "fading" ? "text-fade" : "text-miss line-through"}`}>
                    {r.name}
                  </span>
                  {r.replaced && (
                    <span className="text-[11px] text-muted">
                      replaced <span className="line-through">{r.replaced.name}</span>
                    </span>
                  )}
                </div>
                <ReceiptChip r={r} />
              </li>
            )),
          )}
        </ul>
      </Block>

      <Block title="30-second script">
        <p className="text-[12.5px] leading-relaxed text-ink/90">
          <Marked text={draft.script} receipts={receipts} />
        </p>
      </Block>

      <Block title="Captions">
        <ul className="space-y-1.5">
          {draft.captions.map((c) => (
            <li key={c.platform} className="text-[12.5px] leading-snug">
              <span className="mr-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-violet">{c.platform}</span>
              <Marked text={c.text} receipts={receipts} />
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Music & visual brief">
        <p className="text-[12.5px] leading-relaxed text-ink/90">
          <Marked text={draft.musicBrief} receipts={receipts} />
        </p>
      </Block>
    </section>
  );
}
