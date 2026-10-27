# TASTEMAKER handoff (session_01PMv2tP3mmaSRPtyxJJkQMv, active since 2026-10-27T13:26Z; current as of the last push)

## Goal, deadline, PR
- **Goal:** win the Qloo Agentic Hackathon with Tastemaker by Sigmora. "Done" means `bash .agent/win-gate.sh TASTEMAKER` prints `GATE: PASS` on the pushed HEAD after the last code change, followed by a final status comment on the PR.
- **Dates:**
  - Freeze: 2026-10-29 15:00 UTC (fixes only after that).
  - Deadline: 2026-10-31 03:45 UTC.
  - **Owner milestone: 2026-10-29T18:00Z.** By then `docs/SUBMISSION.md` (every Devpost field, paste-ready), the README fresh-clone run, the demo script and `BLOCKED.md` must be final and pushed. The owner submits on Fri Oct 30 morning.
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

## State now (session_01PMv2tP3mmaSRPtyxJJkQMv holds the lease)
- **Submission materials (owner milestone 2026-10-29T18:00Z):** `docs/SUBMISSION.md` has every Devpost field in form order, `docs/demo-script.md` is the ≤ 2-minute shot list and voice-over, and `pnpm video` records every segment (verified end to end against a local server: ~90 s webm). The fresh-clone README run on 8c6f8f4 passed (install, demo 76/60/76 calls, 515 tests, GET / 200, branded 404, /docs redirect, /api/run streams, MCP 3 tools).
- **Audit rounds this session** (details in WIN-CHECKLIST "Re-audit 12" to "15"):
  - 12 on 1f0f04a: 0 high. 13 on 8c6f8f4: 1 high (locality ranking), fixed. 14 on 295b64a: 0 high. 15 on ee1540b: 1 high (city ranking mixed scales; an off-list city a "miss" Qloo never measured), fixed: one nationwide heatmap, off-list cities folded against the same cells.
  - 16 on 153d2ea: 1 high (docs still described the removed probes), fixed with maplibre-gl 6.4.1 (critical advisory), Edit-brief link origin, parser-error hiding, a plan's own city joining the ranking. Its judge lens hit a usage limit before reporting.
  - Round 17 on fd60092: running. Clean rounds in a row: 0 until 17 reports.
  - Subagent usage limits happen (one reset at 18:20 UTC on Oct 27): if a lens fails on a limit, re-run it after the reset; a round counts as clean only when all three lenses report 0 critical and 0 high.
- **Soaks:** 295b64a, ee1540b and 153d2ea clean (100k deep pass + 39–40 seeded rounds each), run in `scratchpad/wt2`. fd60092 running.
- **Fresh clone of ee1540b:** install, demo 75/60/75, 519 tests, GET / 200, /nope 404, /api/run streams, MCP 3 tools, `next build` + `next start` with no console errors at 390/1440.
- **CI:** GitHub Actions jobs end in 2–3 s with no runner (BLOCKED.md, Actions billing); local checks are the evidence.

## Open audit findings
- None known at critical or high after round 13's fixes.
- Owner decisions: judging-period quota settings (BLOCKED.md); making the repo public exposes `docs/PLAYBOOK.md` and `.agent/`.

## Next steps, in order
1. Collect round 14 (three lenses on 295b64a). Fix what it finds; repeat until **two consecutive rounds** have 0 critical and 0 high.
2. Break-it on the final code commit in a separate worktree: `FC_NUM_RUNS=100000 pnpm exec vitest run --testTimeout=0`, ~40 seeded `FC_NUM_RUNS=500 FC_SEED=<random>` rounds, `pnpm test:e2e`, a fresh clone running the README commands.
3. Write `reaudit.md` (`AUDITED_COMMIT`, `OPEN_CRITICAL: 0`, `OPEN_HIGH: 0`, `CLEAN_AUDITS_IN_A_ROW: 2`) and `break-it.md` (`TESTED_COMMIT`), commit, push, run the gate until PASS.
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

- **(this session) A paid key on Vercel without KV fails the build**, rather than deploying with per-instance budgets; half a KV pair fails anywhere; secret-bearing URLs must be https.
- **(this session) bias.trends as documented:** Qloo defaults to `medium`, so discovery sends `high` and scoring sends `off` (plain affinity).
- **(this session) Where to launch:** locality insights only accept locality signals, so the heatmap ranks; metros the nationwide top-50 cells miss get their own in-boundary heatmap while fewer than three are ranked (≤ 3 extra calls, only then).
- **(this session) Soaks and e2e run in separate worktrees** under the scratchpad, never in the checkout being edited.

## Commands
- **Subagents (owner rule):** every subagent you launch must set model "sonnet" and effort "high" (every Agent/Task launch sets `model: "sonnet"` and `effort: "high"`. That covers auditors, reviewers, fixers, researchers, and soak or log watchers.) Keep these in the main session:
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
