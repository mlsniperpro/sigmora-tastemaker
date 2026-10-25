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

## In flight (2026-10-25, session_01PRg5xX3d1yQyMW528USmNf)
- Re-audit 3 ran as three parallel audits (security, Qloo depth, judge path) on 9cb77e6. Findings are mapped in WIN-CHECKLIST.md "Re-audit 3" (C1+).
- **Done locally (squash before push):**
  - owner session tokens (HMAC, expiring), Origin checks, sign-in rate limit;
  - per-IP and per-preset Qloo budget shares plus the preset holdback;
  - IPv6 /64 keys and the flood guard;
  - owner-only Ship of owner or preset runs;
  - midnight-safe refunds;
  - CSP and security headers;
  - "Washington, DC";
  - the measured ROI line;
  - the LLM side of model-proposed replacements (`Choice.own`).
- **Two worktree agents are running** (under `.claude/worktrees/`, gitignored); merge their commits when they report:
  - Qloo API contract fixes: trending dates and response shape, compare array, locality catch, diversify on the right types, multi-seed demographics, honest metrics with judged counts, `sameName` sequels, optional audit, body timeout, short TTL for empty replies, stale venue pool, replacements filtered by the bar;
  - UI: simulated labels on chips, sticky toggle plus a collapsed brief, a first-screen diff card, 12 px trace text, replay wording, metadataBase, styleimagemissing, RoiLine on simulated runs.
- **After the merge:** wire `Choice.own` in run.ts (score own proposals with the critic and accept only passing ones, in applyChoices), with tests. Then update the BLOCKED.md live-call table rows 5, 11, 12 and 16 to the new request shapes.

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
