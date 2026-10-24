# TASTEMAKER handoff (from session_01GU9AevzaBAt2vnPTdZEP2L)

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

## In flight
- Nothing is running.
- `.agent/win/TASTEMAKER/reaudit.md` and `break-it.md` are stale (they name 3b25d12). Don't trust their numbers; redo both on the final commit.

## Next steps, in order
1. **Medium:** `"Washington"` in `US_METROS` (src/lib/agent/presets.ts) is ambiguous for `filter.location.query`.
   - Change it to "Washington, DC"; the simulator catalog has that alias.
   - Fix the tests that name "Washington" (tests/integration/agent.test.ts, mcp.test.ts).
2. **Medium:** a hostile CTO may read the agent as a fixed workflow.
   - Consider letting the model call bounded tools (taste_check, insights by type, trending) in the revise round, with each call shown in the trace.
3. **Low:** `ownerKeyOf` in src/lib/publisher/index.ts calls `decodeURIComponent`, which throws on a malformed cookie, so the route returns 500. Catch it and treat it as a wrong key (403).
4. **Low:** owner session hardening.
   - Store an HMAC(key, expiry) token in the cookie instead of the raw key.
   - Check Origin on the POST routes ship, requery and owner.
   - Rate-limit `/api/owner`.
5. **Low:** the ROI line in src/components/App.tsx ("agency brief takes weeks") needs a source or softening; label recorded or cached durations as such.
6. **Low:** label custom-brief `?run=` permalinks "user-submitted brief".
7. Add B18+ items for audit 3 to WIN-CHECKLIST.md.
8. Run a full hostile audit (one subagent), fix what it finds, and repeat until 2 audits in a row are clean.
9. **Break-it:**
   - soak: deep pass with `FC_NUM_RUNS=100000 pnpm exec vitest run --testTimeout=0`, then about 80 rounds of `FC_NUM_RUNS=500`;
   - `pnpm test:e2e`;
   - a fresh clone running the README commands.
10. Update reaudit.md (`AUDITED_COMMIT`, `OPEN_CRITICAL: 0`, `OPEN_HIGH: 0`, `CLEAN_AUDITS_IN_A_ROW: 2`) and break-it.md (`TESTED_COMMIT`), clear pids, commit, push, run the gate, update the PR body and post the final status.

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
