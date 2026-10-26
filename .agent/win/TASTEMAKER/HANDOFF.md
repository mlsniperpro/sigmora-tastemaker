# TASTEMAKER handoff (session_01PRg5xX3d1yQyMW528USmNf, wound down 2026-10-26T18:53:01Z; current as of the last push)

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

## In flight (wound down 2026-10-26T18:53:01Z; the lease is released, so a successor may claim it)
- **Last fully verified code:** dfac45a (round-10 fixes). On it:
  - lint and typecheck clean;
  - `pnpm test` 35 files / 508;
  - `pnpm test:e2e` 24/24;
  - the soak deep pass (100k) was clean.
  The 60 seeded soak rounds were stopped unfinished.
- **Round 11 (three Sonnet lenses on dfac45a):**
  - Qloo lens: 0 critical/high, 5 medium, several low.
  - Judge lens: 0 critical/high, 3 medium, several low.
  - Security lens: stopped at wind-down before it reported.
  So round 11 counts as clean only if a security audit of the same code also finds no high. Treat it as not yet clean: re-run all three lenses on the new HEAD.
- **This handoff commit (WIP, on top of dfac45a) holds round-11 fixes.** lint and typecheck are clean and the touched test files pass. The full `pnpm test` and e2e were NOT run on it. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` first; fix anything red. The fixes:
  - `src/lib/net.ts`: a 404 records whether its body was a JSON object (`HttpError.jsonBody`); a refused redirect isn't retried.
  - `src/lib/qloo/client.ts`: Qloo's own JSON "No results" 404 is cached like an empty reply and not counted; a non-JSON (gateway) 404 is never cached and counts in `notFound` (Qloo M3/M4).
  - `src/lib/qloo/types.ts`: top-level `results: null` and a compare item's `query: null` are tolerated (Qloo L1).
  - `src/lib/agent/extract.ts`:
    - the initials fold (`INITIAL`) accepts any separator and chained initials ("SZA, J. Cole.", "J. Cole x Wizkid", "A. R. Rahman") (Qloo M1);
    - joins are tried only for a one-word name joined by and/&/+, a word before an "&" name, or "The …", so comma lists of one-word names spend no searches (Qloo M2);
    - "Features"/"Key features" are no longer collab labels (Qloo M5);
    - an article before a lowercase word is a description, so "A Tribe Called Quest" is a name.
  - `src/lib/agent/cities.ts`: a locality reply of candidates only is used when it ranks at least half of them, and the trace text counts real non-candidates (Qloo L2/L3).
  - `src/lib/agent/presets.ts`: `presetIdOf` requires the whole brief to be the preset's, so an edited preset's permalink no longer offers "Re-run live" over it (judge M1).
  - Tests added or updated in `tests/integration/client.test.ts`, `tests/unit/extract.test.ts` and `tests/unit/agent-pure.test.ts`.
- **Round-11 findings still open (not started):**
  - judge M2: "Edit brief" carries a preset's hidden product, goal, city and comparable into a custom brief while "More details" stays collapsed. Plan: auto-open More details when the form is prefilled, or add a note or a "Start blank" button (`src/components/BriefForm.tsx`).
  - judge M3: after "Try a sample plan" the audit audience stays the sample's (`src/components/AuditPanel.tsx`: restore the brief's audience, or label it "(sample)").
  - Lows to triage, from both reports:
    - "LA"/"NYC"/"SF" judged not found (map city codes to canonical names);
    - an invented "Smith & Co." split into "Smith" and "Co" (don't split when the last part is a legal suffix);
    - "&" splits starved by subtitle splits;
    - "J. Cole" displayed as "J Cole";
    - a double full stop after a seed ending in ".";
    - a repeated affinity sentence in audit rows;
    - the audit 429 Retry-After;
    - "N Qloo calls" counts cache hits;
    - MCP `taste_check` prints simulator numbers;
    - `.env.example` still says "one 80-call plan audit";
    - MCP preset unmetered inconsistency;
    - the `lastKey` pointer rewritten by a degraded run;
    - undocumented `external.isbn/tmdb` params in params.ts;
    - "Atlanta GA" without a comma.
  Record each in WIN-CHECKLIST as section L (round 11), fixed `[x]` or decided `[-]` with the reason.
- **Audit history:** rounds 8, 9 and 10 each found highs, all fixed. No two consecutive clean rounds yet.
- **Stale reports:** `.agent/win/TASTEMAKER/reaudit.md` and `break-it.md` still name 3b25d12. Rewrite them only after two clean rounds and the break-it pass (soak, e2e, fresh clone, failure injection). Rebuild the round table from WIN-CHECKLIST sections A–K.
- **PR #1 body:** last updated for 52a25e1. Refresh it for the new HEAD.

## Open audit findings
- None known at critical or high (round 11's security lens never reported).
- **Owner decisions:** the judging-period quota settings (BLOCKED.md); making the repo public exposes `docs/PLAYBOOK.md` and `.agent/`.
- Accepted `[-]` decisions are in WIN-CHECKLIST (latest: J10, J21, K12, K13).

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
