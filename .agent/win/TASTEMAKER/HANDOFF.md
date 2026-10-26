# TASTEMAKER handoff (session_01PRg5xX3d1yQyMW528USmNf, resumed 2026-10-26 18:02 UTC; current as of each push)

## Goal, deadline, PR
- **Goal:** win the Qloo Agentic Hackathon with Tastemaker by Sigmora. "Done" means `bash .agent/win-gate.sh TASTEMAKER` prints `GATE: PASS` on the pushed HEAD after the last code change, followed by a final status comment on the PR.
- **Dates:**
  - Freeze: 2026-10-29 15:00 UTC (fixes only after that).
  - Deadline: 2026-10-31 03:45 UTC.
- **PR:** mlsniperpro/sigmora-tastemaker#1 (branch `tastemaker` → `main`). Keep exactly one PR, and update its body with the gate's last line.
- **Rules:**
  - read AGENTS.md and docs/PLAYBOOK.md first;
  - **push when a substantial task is complete and green** (a set of audit findings fixed and tested, a feature slice working, a soak or break-it pass recorded, the gate run); don't wait for a timer;
  - each push is a meaningful, squashed commit set: never empty, format-only or "wip" commits; exactly one PR;
  - **never sit idle or end a turn to wait.** While a subagent, audit, soak or build runs, keep working on the next item and collect the results when they arrive. The only reasons to stop are the API usage limit or the /goal being met;
  - run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm test:e2e` before each push;
  - never edit `.agent/win-gate.sh`;
  - never weaken a test;
  - secrets only from env;
  - no model identifiers in commits or code.

## Done (evidence)
- **Re-audit 3 and re-audit 4:** each ran as three parallel hostile audits (security, Qloo depth, judge path).
  - Every finding is mapped in WIN-CHECKLIST.md: C1–C39 (audit 3) and D1–D16 (audit 4: security plus Qloo).
  - D1–D16 are fixed in the handoff commit's parent (`b2529c4`, "Qloo contract fixes, Qloo-verified model ideas, re-audit 4 hardening").
- **Main changes this session:**
  - Owner sessions are HMAC-signed, expiring tokens (`src/lib/publisher/owner.ts`).
  - The Qloo budget is split into a presets pool and a custom pool, with per-preset and per-network (IPv6 /64) shares; impossible settings fail at startup.
    - Code: `src/lib/guard.ts` `qlooBudget`, `src/lib/config.ts` `budgetProblems`, `src/lib/qloo/client.ts` `reserve/release`.
    - The budget fails closed (`budgetCounter`).
  - Flood guard; CSP and security headers (`next.config.ts`).
  - A refused cold preset shows its last run (`runCache.ts` `lastRun`; `tests/e2e/stub-live-fallback.test.ts`).
  - Qloo contract fixes, checked against the docs: trending dates and series, compare `results[]`, diversify only where documented, multi-seed demographics, fine ages, explainability warnings. Tests: `tests/unit/qloo-contract.test.ts`, `tests/integration/failure-paths.test.ts`.
  - The model may propose its own replacement idea, and the Qloo critic scores it before it can be used (`src/lib/agent/choose.ts` `ownProposals`/`withOwnIdeas`; `tests/unit/choose.test.ts`).
  - Honest metrics (`judged` counts; null rate when fewer than half judged).
  - UI: the first-screen DiffCard, a sticky With/Without toggle, the brief folded to one line, simulated-data labels on chips (`src/components/DiffCard.tsx`, `Receipt.tsx`).
- **Last verified on b2529c4:**
  - lint and typecheck clean;
  - `pnpm test` 31 files / 403 tests passed;
  - `pnpm test:e2e` 12 passed;
  - `pnpm demo` hero 76 Qloo calls (DTC 60, sports 76; the reservation is 80).
- **Soak on b190264 (an earlier commit):** `FC_NUM_RUNS=100000` deep pass 380/380 in 209 s, then 60 seeded `FC_NUM_RUNS=500` rounds with no failure. Not yet redone on b2529c4.
- **Production CSP check:** the build served the headers with no CSP violations or console errors (Playwright, both widths).

## In flight (resumed 2026-10-26 18:02 UTC; lease active again)
- **Code:** HEAD 0b38d99 has the same code as d85782f. All round-9 fixes are in it (WIN-CHECKLIST J1–J21).
- **Verified on d85782f:** lint and typecheck clean; `pnpm test` 35 files / 499; `pnpm test:e2e` 24/24 (phone-390, desktop-1440).
- **Running since 18:02 UTC on 0b38d99:**
  - round 10 of the three-lens audit (Sonnet), each lens in its own scratchpad worktree (`aud10q`, `aud10s`, `aud10j`);
  - the soak (deep pass, then 60 seeded rounds; logs `soak10-*.log` in the scratchpad).
  If this session stops before they report, re-run both on the pushed HEAD.
- **Last clean soak:** 52a25e1 (deep pass 483/483, then 60 seeded rounds).
- **Fresh clone of 0b38d99 (18:05 UTC, break-it evidence):** install ok; `pnpm demo` 76 Qloo requests; 35 files / 499 tests; `GET /` 200; `/api/run` streams 15 steps and a result; MCP `tools/list` gives taste_check, audit_plan, plan_campaign.
- **Audit history:** round 8 found 3 highs and round 9 found 2, all fixed. No round has been clean yet, so two clean rounds in a row are still needed (rounds 10 and 11 at the earliest).
- **Stale reports:** `.agent/win/TASTEMAKER/reaudit.md` and `break-it.md` still name 3b25d12. Rewrite them only after two clean rounds and the break-it pass. Rebuild the round table (rounds 1–9, commits and fixes) from WIN-CHECKLIST sections A–J.
- **PR #1 body:** last updated for 52a25e1. Refresh it for the new HEAD.

## Open audit findings
- None known at critical or high after round 9; round 10 never reported.
- **Owner decision:** making the repo public exposes `docs/PLAYBOOK.md` and `.agent/` (BLOCKED.md).
- Accepted `[-]` decisions are in WIN-CHECKLIST (latest: I12, I16, I20, J10, J21).

## Next steps, in order
1. Run a fresh full three-lens audit on the pushed HEAD (read-only agents: Qloo depth, security, judge path). Fix what it finds, and repeat until **two audits in a row are clean** (0 critical, 0 high).
2. Break-it on the final commit:
   - `FC_NUM_RUNS=100000 pnpm exec vitest run --testTimeout=0`;
   - about 60 rounds of `FC_NUM_RUNS=500 FC_SEED=<random>`;
   - `pnpm test:e2e`;
   - a fresh clone of the pushed branch running the README commands;
   - the live-stub failure-injection tests.
3. Write `.agent/win/TASTEMAKER/reaudit.md` (`AUDITED_COMMIT`, `OPEN_CRITICAL: 0`, `OPEN_HIGH: 0`, `CLEAN_AUDITS_IN_A_ROW: 2`) and `break-it.md` (`TESTED_COMMIT`). Both are still stale: they name 3b25d12. Commit, push, and run the gate until it prints PASS.
4. Update the PR body (status, Decisions, Self-review, load), then post the final status comment.

## Key decisions (why)
- **Qloo is the critic inside the loop.**
  - The model chooses among Qloo's above-bar options, or proposes its own idea, which Qloo must pass. That makes it agentic, not a fixed pipeline, and no unverified name reaches the plan.
  - The pass bar is max(0.25, 0.7 × the pool median). That's circular by design, and the UI says so.
- **Budget pools, not one cap.** Presets and custom briefs can't starve each other, and no one network can take the custom pool. A run is refused before it spends; refused runs don't count toward the run cap.
- **Fail closed on the money counter, fail open on rate limits during a KV outage:** a free demo must stay up, but it must not overspend.
- **No numbers on simulated data** (playbook §7). Recorded runs and owner-only live publishing are as in the earlier HANDOFF: visitors always get the sandbox.
- **Real Ship only for preset runs or runs served to the signed-in owner,** so an injected brief can't be posted as the brand.
- **`next build` runs locally,** because checks.sh requires it. `.agent/` and WIN-CHECKLIST.md stay tracked for the gate. `.claude/worktrees/` is gitignored.

## Commands
- **Subagents (owner rule):** every Agent/Task launch sets `model: "sonnet"` and `effort: "high"`. That covers auditors, reviewers, fixers, researchers, and soak or log watchers. Keep these in the main session:
  - integrating changes;
  - the self-review of your diff;
  - deciding which findings are real;
  - the gate.

  Verify any subagent finding before acting on it, and never drop one unchecked.
- **Install:** `pnpm install --frozen-lockfile`
- **Checks:** `pnpm lint && pnpm typecheck && pnpm test`
- **E2E:** `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e`
- **Build and run:** `pnpm build`; `pnpm dev`
- **Demo:** `pnpm demo [indie-release|dtc-city|sports-club]` prints the trace and the Qloo call count.
- **Benchmark (offline):** `pnpm benchmark`
- **Deep property tests:** `pnpm test:deep`
- **Gate:** `bash .agent/win-gate.sh TASTEMAKER` (runs `.agent/win/TASTEMAKER/checks.sh`)

## Owner-only blockers (BLOCKED.md has the checklist)
- `QLOO_API_KEY`: hackathon.api.qloo.com is reachable from cloud sessions (401 without a key). Then run `pnpm fixtures:record` and `pnpm runs:record`.
- `LLM_*` and `JUDGE_*` keys.
- Vercel project and env vars; KV.
- Sigmora `/v1` plus `SIGMORA_OWNER_KEY` (12+ distinct characters).
- The judging-period Qloo quota (then raise `QLOO_DAILY_CALL_CAP` and the pools).
- A live benchmark run.
- Make the repo public and merge (MIT licence in About); GitHub Actions billing.
- Devpost submission; dogfood campaign; brand tokens; video. The owner was notified by push at 08:2x UTC.
