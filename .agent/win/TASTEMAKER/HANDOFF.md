# TASTEMAKER handoff (session_01PRg5xX3d1yQyMW528USmNf, took over from session_01GU9AevzaBAt2vnPTdZEP2L on 2026-10-25 08:07 UTC)

## Goal, deadline, PR
- **Goal:** win the Qloo Agentic Hackathon with Tastemaker by Sigmora. "Done" means `bash .agent/win-gate.sh TASTEMAKER` prints `GATE: PASS` on the pushed HEAD after the last code change, followed by a final status comment on the PR.
- **Dates:**
  - Freeze: 2026-10-29 15:00 UTC (fixes only after that).
  - Deadline: 2026-10-31 03:45 UTC.
- **PR:** mlsniperpro/sigmora-tastemaker#1 (branch `tastemaker` → `main`). Keep exactly one PR. Update the PR body status with the gate's last line.
- **Rules:**
  - read AGENTS.md and docs/PLAYBOOK.md first;
  - substantial pushes at least 45 minutes apart;
  - run `pnpm lint && pnpm typecheck && pnpm test` (plus e2e) before each push;
  - never edit `.agent/win-gate.sh`;
  - never weaken a test;
  - secrets only from env;
  - no model identifiers in commits or code.

## Done (evidence)
- **WIN-CHECKLIST.md:** every judging criterion, playbook item and audit finding is mapped to evidence.
  - Sections A1–A35 (audit 1), O1–O8 (owner audit), B1–B17 (audit 2).
  - 0 open items.
- **Audit 3 (on 4ef5b36) found 0 critical and 2 high.** Fixed in the last code commit (`handoff:` parent, "Re-audit 3 fixes"):
  - **High: budget.** `QlooClient.reserve/release` (src/lib/qloo/client.ts) reserves `QLOO_RUN_ESTIMATE` calls atomically and refunds the unspent ones. Wired into src/app/api/run/route.ts and src/lib/mcp.ts. Tests are in tests/integration/client.test.ts.
  - **High: platforms in the copy.** The `CHANNELS` stop-list in src/lib/agent/mentions.ts keeps streaming services, social networks and stores out of picks. Mention-only picks are flagged and never swapped (`mentionedOnly` in run.ts). Tests are in tests/unit/mentions.test.ts.
  - **Medium.** When the Qloo budget or deadline runs out, the critic returns `unscored` instead of throwing (`critique` in critic.ts, `isQlooStop` in qloo/errors.ts). The Qloo deadline is 75 s (`setDeadline`). Tests are in tests/integration/agent.test.ts ("finishes the plan with unscored picks…").
  - **Low.** MCP `plan_campaign` honours `fresh`.
- **Last verified on that commit:** lint and typecheck clean; `pnpm test` 27 files / 308 tests passed.
  - Not yet run on it: e2e, build, soak, fresh clone.
  - Last full e2e run (12 passed) and build were on 4ef5b36.
- **Gate's last line (on 4ef5b36):** `GATE: FAIL (5)`, failing on:
  - stale reaudit.md and break-it.md (they still say 3b25d12);
  - the soak's process id in pids;
  - an uncommitted pids file.
  - `checks.sh` itself passes.

## In flight (2026-10-25 09:05 UTC, session_01PRg5xX3d1yQyMW528USmNf)
- **Pushed eba9860 (08:55):** the audit-3 security fixes plus the judge-path UI (diff card, sticky toggle, simulated labels).
- **Local, not yet pushed (squash before pushing, at 09:40 or later):**
  - the Qloo contract fixes (trending, compare, diversify, demographics, honest metrics);
  - model-proposed replacements verified by Qloo (`choose.ts` `ownProposals`/`withOwnIdeas`);
  - the benchmark validity rule;
  - the audit-4 security fixes: preset and custom pools, last-run fallback, Origin on /api/run, owner attempt limit, fail-closed budget counter, the cookie sandbox fallback, overruns charged to the shares.
- **Audit 4 ran on b190264** (three lenses). Security is fixed (WIN-CHECKLIST D1–D9).
- **Two worktree agents are running** (`.claude/worktrees/`, both reset to b190264). Cherry-pick their commits when they report:
  - Judge path + "Audit any AI's plan" panel: no numbers on simulated runs in the trace and Taste Map, the TrendMark threshold, a trace jump link, "Re-run" without "live" on simulated runs, 12 px text, README screenshots, `/api/audit` plus the panel, and a re-run of the offline benchmark (it gives the new request count for BLOCKED.md and the benchmark docs; the old figure was 1318, now about 1949).
  - Qloo audit-4 fixes: the explainability warning and null-affinity schema, per-pick degrade on a budget or deadline cut, no swaps after a cut pass, not starving the audit, optional own-idea scoring, a venue city 400, mentions errors, the compare shape warning, and omitted-entity rescoring.
- **Soak on b190264:** a `FC_NUM_RUNS=100000` deep pass (380/380, 209 s) and 60 seeded `FC_NUM_RUNS=500` rounds, with no failure. Redo it on the final commit for break-it.md.

## Next steps, in order
1. Merge both agents' commits; resolve conflicts in run.ts and choose.ts. Apply the sandbox note wording and the benchmark count they report.
2. Add WIN-CHECKLIST items D10+ for the judge and Qloo audit-4 findings.
3. Squash the WIP commits, run lint, typecheck, test and e2e, then push (45 minutes or more after the last push).
4. Run a full three-lens audit again (fresh agents, read-only). Fix what it finds, and repeat until two audits in a row are clean.
5. Break-it on the final commit:
   - the deep soak;
   - 60 seeded rounds;
   - `pnpm test:e2e`;
   - a fresh clone of the pushed branch running the README commands;
   - failure injection (the live-stub tests).
6. Write reaudit.md (`AUDITED_COMMIT`, 0/0, `CLEAN_AUDITS_IN_A_ROW: 2`) and break-it.md (`TESTED_COMMIT`), commit, push, and run the gate until it prints PASS.
7. Update the PR body (status, Decisions, Self-review) and post the final status comment.

## Key decisions (why)
- **Qloo is the critic inside the loop:**
  - the model chooses only among Qloo-approved replacements (`applyChoices`);
  - the pass bar is the higher of 0.25 and 0.7 × the median of Qloo's own candidates, which is circular by design, so the UI says so;
  - the honest comparison is the baseline's miss and invented counts, and the blind judge.
- **Owner-only live publishing:** visitors always get the sandbox, because the demo must stay free and open through Nov 16 without anyone posting as the brand.
- **Preset recordings:** presets serve recorded live runs, so judges see results instantly and spend no quota.
- **Refuse before spending:** a run reserves its Qloo budget up front, so it is never refused half-way.
- **No made-up numbers:** `unscored` instead of 0, and simulated data is labelled.
- **Local build allowed:** `next build` runs locally because checks.sh requires it.
- **Repo tracking:** `.agent/` and WIN-CHECKLIST.md stay tracked because the owner's gate requires them.

## Commands
- **Install:** `pnpm install --frozen-lockfile`
- **Checks:** `pnpm lint && pnpm typecheck && pnpm test`
- **E2E:** `pnpm test:e2e`. Set `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` if a preinstalled Chromium is present.
- **Build:** `pnpm build`
- **Run:** `pnpm dev`. `pnpm demo` gives a terminal run; it prints the trace and the count of Qloo requests.
- **Screenshots:** `pnpm screenshots <url>` (needs a running server).
- **Gate:** `bash .agent/win-gate.sh TASTEMAKER`. It runs `.agent/win/TASTEMAKER/checks.sh`.

## Owner-only blockers (see BLOCKED.md)
- `QLOO_API_KEY`; then run `pnpm fixtures:record` and `pnpm runs:record`, and verify the live calls.
- `LLM_*` and `JUDGE_*` keys.
- Vercel deploy and env.
- KV.
- Sigmora `/v1` plus `SIGMORA_OWNER_KEY`.
- Qloo judging quota, then raise `QLOO_DAILY_CALL_CAP`.
- Live benchmark run.
- Make the repo public and merge (MIT licence in About).
- GitHub Actions billing: CI gets no runners.
- Devpost submission, after retaking the screenshots on the live URL.
- Dogfood campaign.
- Brand tokens.
- Video footage.
