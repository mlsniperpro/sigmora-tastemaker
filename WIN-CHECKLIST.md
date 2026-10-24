# WIN-CHECKLIST: Tastemaker by Sigmora

Every judging criterion, playbook requirement and audit finding, with evidence. Read by `bash .agent/win-gate.sh TASTEMAKER`.

`- [x]` done, with evidence · `- [P]` parked on an owner input listed in BLOCKED.md · `- [-]` not applicable, with the reason · `- [ ]` open (a work item).

## Stage One (Qloo staff pass/fail screen)

- [x] Working software, Qloo API, agentic: agent loop `src/lib/agent/run.ts` (generate → Qloo critic → revise, ≤ 2 rounds); MCP tools `src/lib/mcp.ts`; `tests/integration/agent.test.ts`, `tests/integration/mcp.test.ts`
- [x] No login wall: the app has no auth; `e2e/judge-path.spec.ts` drives it with zero credentials
- [P] Externally hosted demo: needs the Vercel project, keys and KV (BLOCKED.md: Vercel, QLOO_API_KEY, LLM_*, KV_*)
- [P] Public repo: making it public is the owner's (BLOCKED.md: Make the repo public)
- [P] MIT licence visible in About: `LICENSE` at the root; GitHub shows it after the merge to `main` (BLOCKED.md: Merge PR #1)
- [x] Text description, Qloo-powered: `SUBMISSION.md`, `README.md`
- [x] Stays up through judging under load and budget: per-IP limit, daily caps, run cache, recorded-run fallback (`src/lib/guard.ts`, `src/lib/agent/runCache.ts`, `tests/integration/recorded.test.ts`)

## Stage Two criteria

- [x] Technological implementation: 12 canonical surfaces (`src/lib/agent/surfaces.ts`), the hero run touches ≥ 10 (`tests/unit/surfaces.test.ts`); critic = `filter.results.entities` + `feature.explainability` (`critic.ts`); param allow-lists (`params.ts`); `bias.trends` / `diversify.by` on the wire (`tests/integration/wire-params.test.ts`); record/replay, throttle, budgets, retries (`tests/integration/client.test.ts`)
- [ ] Design: complete, coherent product: open until map tiles, the brief bar and the DTC map below are done
- [P] Potential impact, measured: ROI line from the run's own measurements is live (`RoiLine` in `App.tsx`); the benchmark numbers and the dogfood campaign need the keys and a real campaign (BLOCKED.md: Benchmark run, Dogfood campaign)
- [x] Quality of the idea: Qloo as the critic that audits the AI; Without Qloo diff on every run; measure → re-query (`src/lib/agent/requery.ts`)

## Playbook §3 hero scenario

- [ ] Step 1 resolve from a Spotify/IMDb link: `/entities` is wired (`resolveLinks`), but no preset shows it and a link-only brief is rejected
- [x] Step 2 demographics + taste vocabulary: `urn:demographics`, `urn:tag` steps; Taste Map panels; `surfaces.test.ts`
- [x] Step 3 cross-domain map with signals and `diversify.by`: `loadCulture`, `discoveryParams` (`context.ts`); `wire-params.test.ts`
- [x] Step 4 where to launch, venues in the plan's city: `rankCities`; `followPlanCity` (`run.ts`); `agent.test.ts` "judges venues in the city the plan chose"
- [x] Step 5 rising vs fading: `/v2/trending` step; fading verdicts; `critic.test.ts`
- [ ] Step 6 verify every entity the plan mentions: listed picks are resolved (typed, then untyped search) and scored; names in the copy that are missing from `picks` are not yet checked
- [x] Step 7 compare positioning gap: `/v2/analysis/compare` step; Taste Map panel
- [x] Step 8 receipts on every pick, no made-up numbers: `ReceiptChip`; `critic.test.ts` "shows no number when Qloo gives no score"
- [x] Step 9 Without Qloo, annotated inline: `annotation` (`evidence.ts`); e2e asserts the inline line
- [x] Step 10 Ship: sandbox publisher + Sigmora `/v1` client with idempotency (`api.test.ts`)
- [P] Step 10 live Sigmora endpoint (BLOCKED.md: Sigmora `/v1`)
- [x] Step 11 measure → re-query: `requery.ts`, `/api/requery`, `/?measure=` (`requery.test.ts`)
- [P] Step 11 live metrics endpoint (BLOCKED.md: Sigmora `/v1` metrics contract)

## Playbook §7 design spec

- [ ] Brief bar with link paste and audience chips: `BriefForm.tsx` exists behind "Your own brief"; no city, gender or compare fields
- [x] Live, collapsible trace with endpoint, params and latency: `Trace.tsx` (running step, all params with names, canonical surfaces, collapse, aria-live); e2e asserts params
- [ ] Taste Map with map tiles: MapLibre + OpenFreeMap tiles added (`CityTileMap.tsx`); the tile worker doesn't load under Turbopack yet, so it falls back to the SVG map
- [x] Cross-domain affinity web: seeds → picks from explainability (`src/lib/agent/web.ts`, `tests/unit/web.test.ts`)
- [x] Pack with receipt chips: `CampaignPack.tsx`; e2e
- [x] Without Qloo toggle: e2e
- [x] Ship bar: e2e (sandbox)
- [x] Permalinks to the exact run: `?run=<id>`, kept 45 days (`GET /api/run`; e2e "a run permalink opens that exact run, in a fresh browser")
- [x] 390 px, no horizontal scroll: e2e `noHorizontalScroll` on phone-390 and desktop-1440
- [x] No placeholder numbers: `placeholderReason` blanks the scoreboard and MCP rates; the benchmark report shows no numbers until a valid run

## Playbook §9 ladder

- [x] P0 typed client, agent loop, receipts, toggle, repo docs (see above)
- [P] P0 hosted hero preset (BLOCKED.md: Vercel)
- [x] P1 trending, compare, presets, Ship (sandbox): trace steps; three presets in `presets.ts`
- [P] P1 benchmark published: script, blind judge and report ready (`scripts/benchmark.ts`, `src/lib/benchmark/*`); needs the keys (BLOCKED.md: Benchmark run)
- [P] P1 ≤ 2-minute video: `pnpm video <url>` works; footage is the owner's (BLOCKED.md: Video)
- [x] P2 MCP server: `/api/mcp`; `mcp.test.ts`
- [x] P2 brand tokens: one token block in `globals.css`, components use only its utilities
- [P] P2 Sigmora brand values (BLOCKED.md: Sigmora brand tokens)
- [P] P2 Nairobi preset: the probe is in `scripts/record-fixtures.ts`; needs the key (BLOCKED.md: QLOO_API_KEY)
- [-] P2 Song Starter autofill: lives in the private `sigmora-platform` repo, out of scope here (AGENTS.md)

## Hostile-judge audit (2026-10-24)

- [x] A1 cold hero run slow: recorded preset runs served instantly with "Re-run live"; independent steps in parallel (`pnpm bench:latency 1200`: 25.4 s → 20.6 s); `recorded.test.ts`, `agent.test.ts` "credits every Qloo call"
- [P] A1 recordings themselves need the keys (BLOCKED.md: `pnpm runs:record`)
- [x] A2 resilience under rate limits: a refused or failed live run falls back to the recording, with the reason (`recorded.test.ts`)
- [ ] A3 looks like a fixed pipeline: the model should choose among critic-approved options, with its choice in the trace
- [ ] A4 names in the copy but not in `picks` go unchecked (same as §3 step 6)
- [x] A5 venues judged in the plan's own city; baseline in its own city (`agent.test.ts`)
- [ ] A6 pass bar is circular: add a sensitivity table at several bars to the benchmark report
- [x] A7 no made-up 0.00: `unscored` verdict (`critic.test.ts`)
- [x] A8 "Not a real entity" overclaim: untyped second search, "Not found in Qloo", role-mismatch verdict (`critic.test.ts`)
- [x] A9 ROI line in the app: `RoiLine`; e2e
- [ ] A10 link seeding never visible (same as §3 step 1)
- [ ] A11 map tiles (same as §7)
- [x] A12 affinity web was a star: now seeds → picks (`web.ts`, `web.test.ts`)
- [x] A13 Without Qloo annotations inline: e2e
- [x] A14 cached runs labelled: `served` on the result event; trace banner; e2e
- [x] A15 trace shows every param: e2e
- [x] A16 surface count canonical: `surfaces.test.ts`
- [x] A17 trace live and collapsible: `start` events, running step, collapse, aria-live
- [x] A18 permalinks to the exact run: e2e
- [P] A18 KV for permalinks and Ship across instances (BLOCKED.md: KV)
- [ ] A19 brief bar fields (same as §7)
- [ ] A20 DTC preset has no map: heatmap inside the target city
- [ ] A21 Ship sends captions only and ships with misses: send the full pack, warn on remaining misses
- [x] A22 baseline failure no longer kills the run (`agent.test.ts`)
- [x] A23 no made-up 0.5 bar; `taste_check` ranks city picks (`critic.test.ts`, `agent.test.ts`)
- [x] A24 MCP blanks placeholder rates (`mcp.ts`)
- [x] A25 single-flight and `after()` lifetime (`recorded.test.ts`)
- [x] A26 server-rendered title block and link-preview image (`Intro.tsx`, `src/app/opengraph-image.png`)
- [ ] A27 tiny text on mobile: SVG labels below 10 px at 390 px
- [x] A28 whole-word, case-insensitive highlighting (`CampaignPack.tsx`)
- [x] A29 aria-live trace; presets can switch mid-run (`App.tsx`)
- [x] A30 misleading labels corrected (ranked-by, demographic units, scoreboard, strongest driver)
- [x] A31 "every number links" claim corrected to what the UI does (`App.tsx`, `SUBMISSION.md`, `docs/responsible-taste.md`)
- [x] A32 numbers in docs come from scripts (`.env.example`, route comment, README throttle note)
- [-] A33 benchmark families food and creators: the three preset families are the product's scope; the report states its families
- [ ] A34 component-level tests for `Marked`, `ReceiptChip`, `Scoreboard`
- [ ] A35 client bundle weight: keep zod and presets out of the first-load bundle where possible

## Owner audit (PR #1)

- [x] O1 blind pairwise judge (`src/lib/benchmark/judge.ts`, `judge.test.ts`, `judge-replay.test.ts`)
- [x] O2 Playwright e2e at 390 px in replay mode (`e2e/judge-path.spec.ts`)
- [x] O3 `diversify.by` and `bias.trends` on the wire (`wire-params.test.ts`)
- [x] O4 screenshots without simulated numbers (`docs/screenshots/`, `pnpm screenshots`)
- [x] O5 no DRY RUN results committed (`.gitignore`, `benchmark/runs/`)
- [x] O6 owner items in BLOCKED.md
- [x] O7 `noUncheckedIndexedAccess`, `strict-type-checked`, no eslint-disable in `App.tsx`
- [x] O8 measure → re-query and brand tokens

## Soak and fuzz findings

- [x] `median([0, -0, 5e-324])` was order-dependent: fixed with a -0 normalisation; regression test in `util-params.test.ts`
- [x] `normName("_fC")` wasn't idempotent: tokenise first, drop noise to a fixpoint; regression test
- [x] Live-stub rate-limit test straddled a minute boundary: clock pinned just after a boundary (`tests/e2e/stub-live.test.ts`)
