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
- [x] Design: one coherent screen: brief bar → live trace → Taste Map (tiles, heatmap, affinity web) → pack with receipts → Without Qloo → Ship; e2e at 390 and 1440 px (`e2e/judge-path.spec.ts`, 10 runs)
- [P] Potential impact, measured: ROI line from the run's own measurements is live (`RoiLine` in `App.tsx`); the benchmark numbers and the dogfood campaign need the keys and a real campaign (BLOCKED.md: Benchmark run, Dogfood campaign)
- [x] Quality of the idea: Qloo as the critic that audits the AI; Without Qloo diff on every run; measure → re-query (`src/lib/agent/requery.ts`)

## Playbook §3 hero scenario

- [x] Step 1 resolve from a Spotify/IMDb link: the hero preset seeds from Tems' Spotify id via `/entities`; a link alone is a valid brief; link and name dedupe (`agent.test.ts` "seeds from a Spotify link alone")
- [P] Step 1 the hero's Spotify id is verified on the first live run (BLOCKED.md: live calls #2)
- [x] Step 2 demographics + taste vocabulary: `urn:demographics`, `urn:tag` steps; Taste Map panels; `surfaces.test.ts`
- [x] Step 3 cross-domain map with signals and `diversify.by`: `loadCulture`, `discoveryParams` (`context.ts`); `wire-params.test.ts`
- [x] Step 4 where to launch, venues in the plan's city: `rankCities`; `followPlanCity` (`run.ts`); `agent.test.ts` "judges venues in the city the plan chose"
- [x] Step 5 rising vs fading: `/v2/trending` step; fading verdicts; `critic.test.ts`
- [x] Step 6 verify every entity the plan mentions: listed picks are resolved (typed, then untyped search) and scored; names in the copy that aren't picks are found and checked too (`src/lib/agent/mentions.ts`, `tests/unit/mentions.test.ts`)
- [x] Step 7 compare positioning gap: `/v2/analysis/compare` step; Taste Map panel
- [x] Step 8 receipts on every pick, no made-up numbers: `ReceiptChip`; `critic.test.ts` "shows no number when Qloo gives no score"
- [x] Step 9 Without Qloo, annotated inline: `annotation` (`evidence.ts`); e2e asserts the inline line
- [x] Step 10 Ship: sandbox publisher + Sigmora `/v1` client with idempotency (`api.test.ts`)
- [P] Step 10 live Sigmora endpoint (BLOCKED.md: Sigmora `/v1`)
- [x] Step 11 measure → re-query: `requery.ts`, `/api/requery`, `/?measure=` (`requery.test.ts`)
- [P] Step 11 live metrics endpoint (BLOCKED.md: Sigmora `/v1` metrics contract)

## Playbook §7 design spec

- [x] Brief bar always visible: names or a Spotify/IMDb link plus age chips up front; city, gender, comparable, vibe and goal on demand (`BriefForm.tsx`, `briefFromForm` tests; e2e "a custom brief from the brief bar")
- [x] Live, collapsible trace with endpoint, params and latency: `Trace.tsx` (running step, all params with names, canonical surfaces, collapse, aria-live); e2e asserts params
- [x] Taste Map with map tiles: MapLibre 5 + OpenFreeMap tiles with the urn:heatmap heat layer (`CityTileMap.tsx`); e2e covers the tile path (local style) and the SVG fallback (host blocked)
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
- [x] A3 the model chooses among Qloo-approved replacements and says why (a traced step); code accepts only listed options (`src/lib/agent/choose.ts`, `tests/unit/choose.test.ts`, `llm.test.ts` "LiveLLM.choose")
- [x] A4 names in the copy but not in `picks` are checked (`mentions.ts`, `mentions.test.ts`)
- [x] A5 venues judged in the plan's own city; baseline in its own city (`agent.test.ts`)
- [x] A6 pass bar: the report re-scores the same receipts at 0.5–0.9 × the pool median (`missRateAt`, `SENSITIVITY_RATIOS`; `judge.test.ts` "pass-bar sensitivity", monotonic property) and states that the grounded plan passes most bars by construction
- [x] A7 no made-up 0.00: `unscored` verdict (`critic.test.ts`)
- [x] A8 "Not a real entity" overclaim: untyped second search, "Not found in Qloo", role-mismatch verdict (`critic.test.ts`)
- [x] A9 ROI line in the app: `RoiLine`; e2e
- [x] A10 link seeding visible in the hero trace (`/entities`); link-only briefs (`agent.test.ts`)
- [x] A11 map tiles (`CityTileMap.tsx`; e2e)
- [x] A12 affinity web was a star: now seeds → picks (`web.ts`, `web.test.ts`)
- [x] A13 Without Qloo annotations inline: e2e
- [x] A14 cached runs labelled: `served` on the result event; trace banner; e2e
- [x] A15 trace shows every param: e2e
- [x] A16 surface count canonical: `surfaces.test.ts`
- [x] A17 trace live and collapsible: `start` events, running step, collapse, aria-live
- [x] A18 permalinks to the exact run: e2e
- [P] A18 KV for permalinks and Ship across instances (BLOCKED.md: KV)
- [x] A19 brief bar fields (same as §7)
- [x] A20 DTC preset maps where inside Atlanta the audience is (`urn:heatmap` + `filter.location.query`; `agent.test.ts` "maps where inside a fixed market")
- [x] A21 Ship sends the whole pack (hooks, script, music brief) and asks before shipping flagged picks (`api.test.ts` "asks before shipping picks the critic still flags")
- [x] A22 baseline failure no longer kills the run (`agent.test.ts`)
- [x] A23 no made-up 0.5 bar; `taste_check` ranks city picks (`critic.test.ts`, `agent.test.ts`)
- [x] A24 MCP blanks placeholder rates (`mcp.ts`)
- [x] A25 single-flight and `after()` lifetime (`recorded.test.ts`)
- [x] A26 server-rendered title block and link-preview image (`Intro.tsx`, `src/app/opengraph-image.png`)
- [x] A27 chart labels ≥ 9 px rendered at 390 px (e2e measures glyph boxes)
- [x] A28 whole-word, case-insensitive highlighting (`CampaignPack.tsx`)
- [x] A29 aria-live trace; presets can switch mid-run (`App.tsx`)
- [x] A30 misleading labels corrected (ranked-by, demographic units, scoreboard, strongest driver)
- [x] A31 "every number links" claim corrected to what the UI does (`App.tsx`, `SUBMISSION.md`, `docs/responsible-taste.md`)
- [x] A32 numbers in docs come from scripts (`.env.example`, route comment, README throttle note)
- [-] A33 benchmark families food and creators: the three preset families are the product's scope; the report states its families
- [x] A34 component tests rendered with react-dom/server (`tests/unit/components.test.tsx`: Scoreboard blanking, ReceiptChip unscored/not-found/driver, highlighting, unavailable baseline)
- [x] A35 zod out of the client bundle (constants in `src/lib/vocab.ts`; `?b=` gets a structural check, the server validates): the 157 KB zod chunk is gone from `.next/static/chunks`; `tests/unit/client-bundle.test.ts` fails if a client import reaches zod or server code (mutation-tested). MapLibre (1 MB) loads lazily

## Re-audit 2 (hostile judge on 6784c3e: 1 critical, 3 high)

- [x] B1 (critical) Ship and Measure can't reach real channels without the owner: live mode needs `SIGMORA_OWNER_KEY`; only a request carrying it (header or the httpOnly cookie `POST /api/owner` sets) gets the real publisher; visitors always get the sandbox; a wrong key is a 403; live mode without the key is a 500, never a quiet downgrade (`publisherFor`, `api.test.ts`: "never lets a visitor post as the brand")
- [x] B2 (high) Unlisted-mention check: platforms excluded by exact name (an "X" caption no longer hides Netflix or Alix Earle); known names matched on whole words; seeds (typed and link-resolved) excluded; sentence openers ("Like Burna Boy") also tried without the opener; possessives read as the name; lone openers tried last (`mentions.test.ts` regressions)
- [x] B3 (high) Qloo budget: per-IP daily cap (`RATE_LIMIT_PER_DAY`), "Re-run live" is per-IP limited and really runs live, and a run is refused up front when today's Qloo budget can't cover a whole run instead of failing half-way (`counter-guard-config.test.ts`)
- [x] B4 (high) Scoreboard leads with what isn't circular (baseline invented picks and miss rate, picks replaced) and labels the after-critic rate as low by construction, with the bar it uses (`components.test.tsx`); MCP text says the same
- [x] B5 No made-up 0 affinity anywhere: entities, venues, cities, tags and compare rows without an affinity are skipped, so the pick is "unscored" (`critic.test.ts`)
- [x] B6 Unscored picks render neutral, not struck through (`CampaignPack.tsx`)
- [x] B7 A title with its subtitle dropped ("Wakanda Forever") resolves to Qloo's full title, and the receipt names it, instead of counting as invented (`isTitlePart`, `critic.test.ts`)
- [x] B8 Screenshots retaken on the current UI; BLOCKED.md asks for a retake against the live URL once keys are set
- [x] B9 Live trace lists every step in flight, not one title (`useRun.ts`, `Trace.tsx`)
- [x] B10 Run cache key is SHA-256 (no crafted-brief collision with a preset); FNV `hashId` removed
- [x] B11 Cache backfill lasts 60 s, so a degraded run's 10-minute TTL holds (`cache.test.ts`)
- [x] B12 A shared `?b=` brief is shown and runs only on a click (`e2e`: "a shared ?b= brief…")
- [x] B13 The baseline's venue is judged against its own city's venue pool (`agent.test.ts`)
- [x] B14 `compareTo` resolves by exact name only, so positioning never runs against a look-alike
- [x] B15 `pnpm demo` prints the Qloo request count (73 for the hero preset); `.env.example` and the route quote it
- [x] B16 No model call can outlast the route: a run-level deadline (105 s) on every LLM call (`agent.test.ts`: "never waits on a hung model")
- [-] B17 `.agent/` and `WIN-CHECKLIST.md` stay tracked: the owner's win gate requires the kit committed and the checklist in the PR

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

## Re-audit 3 (2026-10-25, three parallel hostile audits on 9cb77e6: security, Qloo depth, judge path)

Security and robustness:

- [x] C1 One network can't spend the day's Qloo budget: per-IP (IPv6 /64) daily share `QLOO_IP_DAILY_CALLS`, a `QLOO_PRESET_HOLDBACK` custom runs can't touch, reserved atomically with the run (`client.test.ts`: "caps each scope's share…")
- [x] C2 A burst of cold preset requests across instances is bounded by the preset's own daily share `QLOO_PRESET_DAILY_CALLS` (`qlooBudget`, `counter-guard-config.test.ts`)
- [x] C3 Free routes (permalinks, Ship lookups, MCP) have a per-instance flood guard that costs no KV round trip (`floodGuard`, 120/min per IP)
- [x] C4 IPv6 keyed by /64; `x-vercel-forwarded-for` first; IPv4-mapped addresses folded (`ipKey` unit and property tests)
- [x] C5 A visitor's injected brief can't be posted as the brand: real Ship takes only preset runs and runs served to the signed-in owner (`api.test.ts`: "ships to real channels only presets and runs the owner started")
- [x] C6 Budget refunds go back to the day they were reserved from, across midnight UTC (`client.test.ts`)
- [x] C7 Security headers on every route: CSP (tiles host only), frame-ancestors none, nosniff, referrer and permissions policies (`next.config.ts`)
- [x] C8 Live-mode misconfiguration serves visitors the sandbox; only the owner gets the 500 (`api.test.ts`)
- [x] C9 Owner cookie holds an HMAC-signed, expiring session token, never the key; a malformed cookie is a 403, not a 500 (`owner.test.ts`, `api.test.ts`)
- [x] C10 Origin checked on ship, requery and owner POSTs; owner sign-in limited to 5 attempts a minute per IP (`api.test.ts`)
- [-] C11 KV outage falls back to per-instance counters instead of failing closed: kept on purpose, because failing closed would take the free demo down with KV; the per-IP shares and the flood guard still bound one instance, and the warning is logged
- [x] C12 "Washington, DC" in the metro list, so `filter.location.query` isn't ambiguous with the state
- [x] C13 ROI line uses only this run's measured numbers (time, Qloo calls, picks checked, the plain model's wrong picks) and labels recorded or cached timings; the unsourced "agency takes weeks" claim is gone from the UI, README and evidence table
- [x] C14 The unsourced "10,000 calls a month" quota figure is removed from BLOCKED.md; the budget knobs are documented instead

Judge path and claims:

- [x] C15 Simulated data never reads as a Qloo verdict: chips say "Simulated pass/miss/not in catalog" with no numbers; the Taste Map header carries a "simulated data, not Qloo" badge (`components.test.tsx`, e2e)
- [x] C16 At 390 px the With/Without toggle is sticky and the brief folds into a one-line summary with "Edit brief" once a run exists (e2e: the toggle stays in view after scrolling into the pack)
- [x] C17 First-screen diff card: the same model without Qloo vs. with the Qloo critic, its worst picks struck through with their notes and replacements, and the circularity disclaimer; counts hidden on simulated runs (`DiffCard.tsx`, `components.test.tsx`, e2e "starts in the first viewport")
- [x] C18 Trace metadata at 12 px or more (endpoint chips, latency, call and surface counts)
- [x] C19 Replayed runs say "Instant: this exact run finished at …", with "Re-run live" at the top of the banner
- [x] C20 `metadataBase` set from the site URL; the build warning is gone
- [x] C21 MapLibre `styleimagemissing` handled; no console warning at 1440 px
- [x] C22 The ROI line shows no miss count on simulated runs and labels the calls "simulated"
- [P] C23 The live demo, live Qloo data and the benchmark numbers (the audit's critical item) need the owner's keys and Vercel (BLOCKED.md: QLOO_API_KEY, LLM_*, Vercel, KV, Benchmark run)

Qloo depth and agent correctness:

- [x] C24 `/v2/trending` sends the required `filter.start_date`/`filter.end_date`, one entity per call, and parses the documented `results.trending[]` series; trends only for roles where fading changes a verdict (`qloo-contract.test.ts`)
- [x] C25 `/v2/analysis/compare` parses the documented `results[]` array (old shape still accepted) with `filter.subtype=urn:tag:genre`
- [x] C26 A failed locality call keeps the heatmap fallback, and the reason is traced; heatmaps send `take=50` (`failure-paths.test.ts`)
- [x] C27 `diversify.by` only where documented (`subtype` on `urn:tag`, geocode on place); the validator enforces it (`wire-params.test.ts` corrected)
- [x] C28 Demographics averaged across one row per seed (`aggregateDemographics`)
- [x] C29 The brief's fine age buckets are sent as is (insights enum)
- [x] C30 No fake 0%: metrics carry `judged`; the rate is null ("—") when fewer than half the picks were judged; an entity Qloo omits from `filter.results.entities` is a miss; unscored picks don't end the loop (`critic.test.ts`); the benchmark is invalid under the same condition (`judge.test.ts`)
- [x] C31 `sameName` rejects invented sequels: number and roman-numeral tokens must match (`util-params.test.ts`, property tests)
- [x] C32 One Qloo error can't sink a finished plan: a failed baseline audit marks the comparison unavailable; each culture type settles on its own (`failure-paths.test.ts`)
- [x] C33 The network timeout covers the response body, not only the headers (`net.test.ts`: a stalled body)
- [x] C34 Empty replies are cached for 10 minutes, not 7 days
- [x] C35 A failed venue load for a new city leaves no stale pool from the old city
- [x] C36 Replacements must clear the role's bar; a fixed-market city miss is swapped for the target city
- [x] C37 Agentic, not a fixed pipeline: for each failing pick the model picks one of Qloo's above-bar options or proposes its own idea, which the Qloo critic scores first and code keeps only if it passes; the trace says which and why (`choose.test.ts`, incl. a property test and an invented own idea refused end to end)
- [x] C38 Every preset stays within the 80 calls a run reserves (`pnpm demo`: hero 76, DTC 60, sports 76; a test asserts it)
- [-] C39 A non-budget Qloo error in the grounded critic's first pass still fails the run: that pass is the product, and a preset then falls back to its recorded run; a plan with no critic would be the thing Tastemaker exists to prevent

## Re-audit 4 (2026-10-25, three parallel audits on b190264)

Security and robustness (0 critical; 2 high, 2 medium, 4 low, all fixed):

- [x] D1 (high) Custom briefs can't be starved by presets or vice versa: the day is split into a presets pool and a custom pool, each with per-preset or per-network shares; impossible settings are refused at startup (`budgetProblems`, property test; `client.test.ts` "keeps the preset and custom pools apart")
- [x] D2 (high) A refused cold preset with no recording shows its last finished run, labelled with why, instead of a 503 (`lastRun`, `tests/e2e/stub-live-fallback.test.ts`)
- [x] D3 (medium) Only a run that got its Qloo budget counts toward the rate limits and the daily run cap, so refused requests can't fill the cap (`admitNewRun`)
- [x] D4 (medium) `/api/run` checks Origin, so another site can't make its visitors spend this demo's budget
- [x] D5 (low) Owner keys sent in the header count toward the 5-a-minute attempt limit; low-entropy owner keys are refused at load (`api.test.ts`)
- [x] D6 (low) With KV configured, the budget counter fails closed on a KV outage (no per-instance zero counts); refunds are best effort and logged (`client.test.ts` "fails closed")
- [-] D7 (low) The Qloo throttle is per instance: `QLOO_RPS` (default 4) is documented against the key's ~5/s, and a 429 is retried with backoff; a KV token bucket would add a round trip to every Qloo call for a demo that runs on few instances
- [x] D8 (low) A stale or garbled session cookie gets the sandbox, not a 403; a wrong header key is still refused
- [x] D9 (Qloo audit M3) Calls past a run's reservation are charged to the same shares, so overruns can't eat another pool (`client.test.ts`)

Qloo depth and agent correctness (0 critical; 2 high, 3 medium, 2 low, all fixed):

- [x] D10 (high) An explainability warning (`query.explainability.warning`, per the insights deep-dive) or a null affinity no longer fails the critic: the pick is unscored with the warning on its receipt (`qloo-contract.test.ts`, `critic.test.ts`)
- [x] D11 (high) A budget or deadline cut in mid-pass degrades per pick: picks already judged keep their verdicts, refused ones are unscored, and a cut pass swaps nothing; the baseline audit now runs before critic pass 2, so the headline comparison is judged first (`critic.test.ts` incl. a property test, `agent.test.ts`, `failure-paths.test.ts`)
- [x] D12 (medium) Optional extras can't sink a run: an own idea whose scoring fails "wasn't checked", a venue whose city Qloo 400s is unscored with the reason, and a failed mention search is listed in the trace (`failure-paths.test.ts`)
- [x] D13 (medium) A compare reply with items but no two-sided scores says "compare reply shape not recognised" instead of "no gap found"
- [x] D14 (medium) Overrun calls are charged to the reserved shares (D9)
- [x] D15 (low) Entities Qloo omitted aren't re-scored every pass; the mention-search cap is shown in the trace
- [x] D16 A malformed Qloo 200 is neither cached nor recorded as a fixture, and a cached entry that no longer validates is refetched (`client.test.ts`)

Judge path and claims (0 critical; 2 high, 3 medium, 3 low, plus the biggest-gain suggestion, all done):

- [x] D17 (high) No numbers on simulated runs anywhere: trace step details (verdict counts, affinities, metro scores), Taste Map values and the choose step say "simulator" and print no Qloo-looking numbers; live and replay runs keep them (`tests/integration/honest-numbers.test.ts`, `components.test.tsx`, e2e)
- [x] D18 (high) The benchmark request count is re-measured (`pnpm benchmark` offline: 1949 requests, still "not a measurement"); docs/benchmark.md and BLOCKED.md quote it
- [x] D19 (medium) The trend chip uses the critic's fading bar and shows a percent change
- [x] D20 (medium) The sticky bar has a "Trace · N Qloo calls" jump link, so the trace is one tap away at 390 px (e2e)
- [x] D21 (medium) "Re-run" (not "Re-run live") when the run's Qloo data is simulated
- [x] D22 (low) Stale numbers fixed: ~76 calls in the route comment, the surface count in evidence-status, README screenshots retaken
- [x] D23 (low) No text under 12 px at 390 px
- [x] D24 (low) Sandbox receipt says "Sandbox: schedule computed, nothing posted."
- [x] D25 Audit any AI's plan: paste a campaign from any model and the Qloo critic checks every name in it against the audience. A live model extracts the names (the deterministic scanner otherwise), invented ones come back not found, weak ones get Qloo-preferred replacements; one-click sample; budgeted like taste_check, Origin-checked, and only a budgeted audit counts toward the limits (`src/app/api/audit/route.ts`, `src/lib/agent/audit.ts`, `extract.ts`, `AuditPanel.tsx`; `audit.test.ts`, `extract.test.ts`, e2e)

## Re-audit 5 (2026-10-25, three parallel audits on af4f11a)

Security (H1 high, H2 high, M1, L1, L2), Qloo depth (H1, H2, M1, M2, L1); the judge-path audit had no critical or high findings:

- [x] E1 (high) No regex backtracking on pasted text: a label is read with `indexOf` plus a pattern on a 60-character prefix, and whitespace runs are squashed first (a 4000-space line took 22.5 s; now under 100 ms; `extract.test.ts` "stays fast on hostile input")
- [x] E2 (high) One network can't lock everyone out of custom briefs and audits: each network's share is at most a third of the custom pool (`NETWORKS_PER_POOL`); defaults are cap 480, presets 240, custom 240, 80 per network (one run or one audit); invalid settings are refused at startup (`counter-guard-config.test.ts`)
- [x] E3 (high) The audit scanner reads only pure pick labels: planning lines ("Brand voice", "Partner KPIs", "Target market", "Shows: Friday…", "Venue: TBC", dates) are prose, never invented entities; "Host city" is a city and "Podcast host" a podcast (`extract.test.ts`)
- [x] E4 (high) An invented city can't borrow a real one's verdict: cities a plan names count only on an exact Qloo match, and venues are judged in the plan's city only once Qloo knows it (`rankCities` `exact`)
- [x] E5 (medium) The model's extraction is checked against the text: only names the text contains word for word are audited, the scanner's labelled picks are merged in, and dropped names are reported; an injected or "corrected" list falls back to the scanner (`extract.test.ts`)
- [x] E6 (medium) The model gets 12 s to list names; past that the scanner's list is used, so the Qloo checks keep their time (`EXTRACT_TIMEOUT_MS`)
- [x] E7 (low) The audit reserves 80 calls, held by a worst-case plan in a live-wire test (`audit.test.ts`)
- [x] E8 (low) MCP `taste_check` and `plan_campaign` reserve the Qloo budget before counting toward the rate limits (as /api/run and /api/audit)
- [x] E9 The e2e assertion for the new sandbox wording is fixed (af4f11a's e2e run predated the wording change)

## Re-audit 6 (2026-10-25, Qloo depth and security on 9da7b26; judge-audit-5 UI items merged)

- [x] F1 (high) Name matching is exact: equal after normalising case, accents, punctuation, "the", "F.C." and numerals; no token-overlap rule, so "Black Panther Wakanda Rising" never verifies as "Black Panther: Wakanda Forever" (`util-params.test.ts`)
- [x] F2 (medium) The scanner reads values the way a person would: "Dr. Dre", "feat.", "Atlanta, GA", "Lagos, Nigeria", and placeholders ("Our agency", "N/A for now", "Coming soon", "Season 1") aren't picks (`extract.test.ts`)
- [x] F3 (medium) Prose names Qloo has no entity for are listed as "not audited" in the panel, not silently skipped; looser label grammar ("Top 3 creators", "Venue (primary)", "Podcast appearances", "Producer") (`extract.test.ts`, `components.test.tsx`)
- [x] F4 (medium) Model path: placeholders never become picks (shared value rules)
- [x] F5 (medium) A run with unscored picks isn't cached as healthy for a day (`failure-paths.test.ts`)
- [x] F6 (medium) A fixed audit city Qloo can't place leaves the venues unchecked with the reason, instead of failing the audit (`failure-paths.test.ts`)
- [x] F7 (low) The panel says which model-listed names weren't in the text, and when an audit was served from cache
- [-] F8 (low) The model call past the 12 s extraction cut-off isn't aborted: it ends at its own `LLM_TIMEOUT_MS` and costs one model call; the audit doesn't wait for it
- [x] F9 (low) A refusal names the share that ran out (your network's share, this preset's re-runs, the custom pool, or the store) (`qlooRefusal`)
- [x] F10 (low) BLOCKED.md lists `filter.location.query` + `filter.results.entities` as a live call to verify (row 10)
- [x] F11 (high, security) Identical audits are served from cache before any budget is reserved, so the one-click sample can always be repeated (`audit.test.ts`)
- [x] F12 (medium) A bad env value fails the build (`next.config.ts` runs `loadConfig`), so the last good deploy keeps serving; `.env.example` and BLOCKED.md match the defaults
- [x] F13 (medium) A burst of cold requests for one brief shares one run: single-flight admission per brief, waiters join or share the refusal (`stub-live-fallback.test.ts`)
- [x] F14 (medium/low) A share that just refused is refused again for 60 s without a store round trip (keyed by cap and day, cleared by refunds) (`client.test.ts`)
- [-] F15 (low) Reservations have no lease: a function killed by the platform mid-run leaks its unspent calls until the UTC day resets; normal timeouts are covered (runs end at 105 s of 120, audits at about 48 of 60)
- [x] G1 Judge audit 5 (all medium/low) merged: the product above the fold (one-line source note, a launch map beside the diff card, a "Paste any AI's plan" entry point), browser-side audience validation, scripted-baseline labels, 12 px minimum text with an e2e check, a required "Who's launching", a distinct trend glyph, README `bias.trends` caveat, venue-outside-city notes
- [x] G2 "Audit any AI's plan" is also an MCP tool (`audit_plan`), sharing one budgeted, cached code path with /api/audit (`auditWithBudget`), so any agent can have Qloo audit a plan (`mcp.test.ts`)
