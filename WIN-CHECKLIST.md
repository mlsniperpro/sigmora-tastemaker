# WIN-CHECKLIST: Tastemaker by Sigmora

Every judging criterion, playbook requirement and audit finding, with evidence. Read by `bash .agent/win-gate.sh TASTEMAKER`.

`- [x]` done, with evidence · `- [P]` parked on an owner input listed in BLOCKED.md · `- [-]` not applicable, with the reason · `- [ ]` open (a work item).

## Stage One (Qloo staff pass/fail screen)

- [x] Working software, Qloo API, agentic: agent loop `src/lib/agent/run.ts` (generate → Qloo critic → revise, ≤ 2 rounds); MCP tools `src/lib/mcp.ts`; `tests/integration/agent.test.ts`, `tests/integration/mcp.test.ts`
- [x] No login wall: the app has no auth; `e2e/judge-path.spec.ts` drives it with zero credentials
- [P] Externally hosted demo: needs the Vercel project, keys and KV (BLOCKED.md: Vercel, QLOO_API_KEY, LLM_*, KV_*)
- [P] Public repo: making it public is the owner's (BLOCKED.md: Make the repo public)
- [P] MIT licence visible in About: `LICENSE` at the root; GitHub shows it after the merge to `main` (BLOCKED.md: Merge PR #1)
- [x] Text description, Qloo-powered: `docs/SUBMISSION.md`, `README.md`
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
- [x] A31 "every number links" claim corrected to what the UI does (`App.tsx`, `docs/SUBMISSION.md`, `docs/responsible-taste.md`)
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

## Re-audit 7 (2026-10-25, three lenses on 14951cf; partial at wind-down, see HANDOFF.md "Open audit findings")

- [x] H1 (high, Qloo) Subtitle matching only on whole title segments of titled media ("Rema Dupe" is not "Rema Dupe Tribute Band") (`util-params.test.ts`)
- [x] H2 (high, Qloo) Names a split would break are kept: the lowercase "the …" rule, Qloo-confirmed rejoining ("Earth, Wind & Fire"), venue cities dropped (`extract.test.ts`)
- [x] H3 (medium) A spelling-blind second matching key accepts stylised spellings (P!nk, Ke$ha, N.W.A., AC/DC, Mø) and still rejects different names (`util-params.test.ts`)
- [x] H4 (medium) Plan-city venue failures are contained in the taste check and the baseline audit (`failure-paths.test.ts`)
- [x] H5 (medium) Partial audits are cached briefly; concurrent identical audits run once (`audit.test.ts`)
- [x] H6 (medium) A run or audit that fails before spending (no audience name resolved) gives back its admission
- [x] H7 (low) A lone UTF-16 surrogate is a 400 at the run, audit and MCP boundaries
- [x] H8 (low) Run single flight: waiters don't inherit a network-specific (429) refusal
- [x] H9 (low) Cache versions bumped for the matching change (`audit:v2`, run schema 5)
- [x] H10 (high, judge) No blank first screen on a total live-Qloo failure: a preset with nothing recorded shows its last finished run, else the same preset on the labelled offline simulator ("Live Qloo unavailable … nothing in it is a Qloo answer"), never mixed with live data (`stub-live-fallback.test.ts`)
- [x] H11 The Qloo throttle uses the monotonic clock: a wall-clock step backwards (NTP, a test clock) can no longer stall every Qloo call (found while testing H10)
- [x] H12 (judge, medium/low) A dead `?run=` link says so at the top and loads the hero preset; "simulated" in the trace header and the sticky bar; an offline-catalog note on simulated audits; "Edit brief" and the audit audience start from the brief on screen (e2e, `components.test.tsx`)
- [x] H13 (low) A refusal isn't memoised when a refund to that share landed while it was being refused; a request's own rollbacks don't count as refunds (`client.test.ts` race test, fails without the fix)
- [x] H14 (low) MCP `audit_plan` and `plan_campaign` give back their admission when no audience name resolves (as /api/run and /api/audit)
- [x] H15 (low) Run-result misses are remembered for 10 s in-process, so random `?run=` probes can't each cost a store read; a `set` clears it (`cache.test.ts`)
- [x] H16 (low) The audit panel names entities Qloo knows as a kind this audit doesn't check (a city in prose), instead of calling them unknown (`components.test.tsx`)
- [x] H17 (security M3, rest) The one-click sample audit always answers: `pnpm runs:record` also records it, live only, and a refused audit of the exact sample serves that recording, labelled with why (`recorded-audit.test.ts`)

## Re-audit 8 (2026-10-26, three lenses on d3fc58a: 3 high from the Qloo lens, 0 high from security and judge)

- [x] I1 (high, Qloo) The last name of an Oxford-comma or "&" list is audited ("A, B, and C", "A, B & C", "A as well as B") (`extract.test.ts`)
- [x] I2 (high, Qloo) A labelled name that may be two ("Burna Boy & Wizkid", "Drake, the Weeknd") is read as its parts unless Qloo knows it whole ("Simon & Garfunkel", "Tyler, the Creator"), in the same batch of searches as the rejoins; a failed search keeps it whole (`extract.test.ts`)
- [x] I3 (high, Qloo) A refused cold preset with nothing recorded and no earlier run shows the labelled offline simulator, not a 503; the fallback is fully simulated (no recorded answers mixed in) and kept by id briefly, so its permalink opens (`stub-live-fallback.test.ts`, fails without the fix)
- [x] I4 (medium, Qloo) "Hook:" lines are copy, read as prose: only names Qloo knows come out of them (`extract.test.ts`)
- [x] I5 (medium, Qloo) Descriptions aren't audited as names ("5 micro-influencers in Lagos", "Local Coffee Shops", "Pop-up in Lagos"); "50 Cent" and "5 Seconds of Summer" still are (`extract.test.ts`)
- [x] I6 (medium, Qloo) A titled work keeps its subtitle ("Black Panther: Wakanda Forever", "Law & Order: SVU"); an explanation after a colon is still cut (`extract.test.ts`)
- [x] I7 (medium, Qloo) Place qualifiers with dots or "City" are dropped after a venue or city ("Washington, D.C.", "New York City", "Harlem", a state code) (`extract.test.ts`)
- [x] I8 (medium, Qloo) Name matching folds "CF", "Inc.", "Ltd", "St." = "Saint" and spelled-out numbers ("Fast Five" = "Fast 5"), and still tells sequels apart (`util-params.test.ts`)
- [x] I9 (low, Qloo) City lists spend no searches on joins; labelled picks come before the model's extras, so the cap never cuts them (`extract.test.ts`)
- [x] I10 (medium, security) No-audience refunds only when nothing was paid for: a live model's draft or extraction already ran, so that run or audit still counts (/api/run, /api/audit, MCP) (`audit.test.ts`, fails without the fix)
- [x] I11 (medium, security) A KV read error is never remembered as a miss, so a blip can't 404 permalinks or start a paid run for 10 s (`cache.test.ts`)
- [-] I12 (medium, security) A few networks can use the custom pool for the day (240 calls, 80 per network). Decision: the defaults are deliberately small because Qloo publishes no hackathon quota; presets, permalinks, cached runs and the recorded sample audit keep working, the refusal says so, and the owner scales the pools (BLOCKED.md)
- [x] I13 (low, security) After a leader refused for its own network (429), one waiter leads a new admission and the rest join it, for runs and audits (`stub-live-fallback.test.ts`, `audit.test.ts`, both fail without the fix)
- [x] I14 (low, security) The refusal memo is keyed by the size asked for: a refused 80-call run doesn't refuse a 14-call taste check (`client.test.ts`)
- [x] I15 (low, security; raised to medium in audit 9 as J10) The narrowest share is counted first, so an over-share request never touches the shared counters (`client.test.ts`)
- [-] I16 (low, security) A refund just after 00:00 UTC lands on the new day (at most one extra run that day). Accepted
- [x] I17 (medium, judge) A refused or failed run never clears the screen or the address bar: the previous result stays, with the refusal above it and a "new run in progress" note while one streams (`components.test.tsx`, e2e)
- [x] I18 (medium, judge) The simulator fallback says live Qloo failed, with the reason, instead of "no key on this deployment"; its permalink opens (I3) (`components.test.tsx`)
- [x] I19 (low, judge) README lists three MCP tools; placeholder runs claim no duration ("Offline demo run") (`components.test.tsx`, e2e)
- [-] I20 (low, judge) The keyless demo strikes through famous real names as "Simulated miss". Kept: every such verdict is labelled simulated with a note, and recorded live runs replace it once `pnpm runs:record` runs (BLOCKED.md)

## Re-audit 9 (2026-10-26, three lenses on 52a25e1: 1 high and 1 conditional high from the Qloo lens, 0 high from security and judge)

- [x] J1 (high, Qloo) A failed seed-link lookup (`/entities` 400, 404, 5xx, malformed) leaves the link unresolved and the brief's names seed the run; only a budget or deadline stop ends it (`failure-paths.test.ts`, fails without the fix)
- [x] J2 (high if live, Qloo) A 404 from `/search` or `/entities` ("No results" in the docs) reads as an empty list, cached as one; any other 404 is still an error (`client.test.ts`, fails without the fix). To confirm live (BLOCKED.md)
- [x] J3 (medium, Qloo) The locality ranking is used only when it covers every candidate city; else the heatmap ranks them, and the trace says why (`failure-paths.test.ts`)
- [x] J4 (medium, Qloo) A "Name: More" title in a list keeps its subtitle only if Qloo knows the whole title, else it's "Name"; every list item, not only the first (`extract.test.ts`)
- [x] J5 (medium, Qloo) Lists ending ", as well as / along with / featuring / with X" keep X; initials ("J. Cole", "A.J. Tracey") don't end a line; "Nike, Inc." is Nike (`extract.test.ts`)
- [x] J6 (medium, Qloo) Real state and country codes qualify a city ("Portland, OR"), city codes don't ("LA", "NYC"; "DC" only after Washington); US state names qualify too ("Nashville, Tennessee") (`extract.test.ts`)
- [x] J7 (low, Qloo) Spelled-out numbers are no longer folded ("Ocean's 11" ≠ "Ocean's Eleven", "Nine" ≠ "9"); "C.F." folds like "F.C." (`util-params.test.ts`)
- [x] J8 (low, Qloo) "Re-run live" never shares a plain preset click's admission (separate single-flight key)
- [x] J9 (low, Qloo) Optional entity fields accept null (one null can't fail a whole reply) (`client.test.ts`)
- [-] J10 (low, Qloo) More than 6 join or split candidates in one text: the rest are read as written. Bounded on purpose (the audit's reservation); MCP `plan_campaign` has no single flight and errors on a refused preset (it's a tool: a clear error is the contract)
- [x] J11 (medium, security) The narrowest share is reserved first, so a burst from one network can't set a refusal memo on the pool or the day and lock others out (`client.test.ts`, fails without the fix; the auditor's patch)
- [x] J12 (low, security) A refused preset's simulated fallback is also its last run for 10 minutes: a burst of refused clicks replays one run instead of simulating each (e2e)
- [x] J13 (low, security) Unmetered custom runs (no key) are capped at 6 per network per minute (`api.test.ts`, `counter-guard-config.test.ts`) The soak found the api test could straddle a minute window (seed 511810038); its clock is now pinned.
- [x] J14 (low, security) On a deployment with live Qloo, a simulated fallback run can't ship to real channels (409) (e2e)
- [x] J15 (low, security) A lone surrogate in a model-written name is replaced before it reaches a Qloo URL (`client.test.ts`)
- [x] J16 (low, security) The in-memory counter evicts the least recently updated key, never the busy day count (`counter-guard-config.test.ts`)
- [x] J17 (medium, judge) A fallback run's permalink says live Qloo was unavailable, not "no key" (server labels it; `parseServed`), and the fallback is kept a day, not 10 minutes (e2e, `components.test.tsx`)
- [x] J18 (medium, judge) "Low by design" and "near zero" appear only when the after-critic rate is at most 10%; otherwise the card says how many picks the critic couldn't replace (`components.test.tsx`)
- [x] J19 (medium, judge) A failed run says what failed in a sentence ("Live Qloo couldn't answer (HTTP 503 on /search)… The presets still load.") (`api.test.ts`, `components.test.tsx`)
- [x] J20 (low, judge) "Edit brief" follows every new result, the highlighted preset is the one behind the result on screen, the banner's reason is its own sentence, the pass chip reads "Passes the Qloo bar", BLOCKED.md names the simulator outcome (`components.test.tsx`, e2e)
- [-] J21 (low, judge) Audit results stay on screen when the brief changes. Accepted: re-running the audit for the new audience is one click

## Re-audit 10 (2026-10-26, three lenses on 0b38d99: 0 high from Qloo and security; 1 config-dependent high from the judge path)

- [x] K1 (high, judge) An audit reserved its worst case (80 calls, a network's whole share), so one audit blocked a judge's next one. It now reserves 30; calls past that are charged one by one to the same shares, and a cut audit leaves names unscored. The worst case stays at most 80 (`audit.test.ts`); a judge can run the (cached) sample and two plans (e2e, fails with the old reservation). Default quotas stay deliberately small; judging-period settings are in BLOCKED.md
- [x] K2 (medium, Qloo; medium, judge) "Show: Network" items past the 6-search cap read as the show, unsearched; subtitled titles are searched before joins, so "Black Panther: Wakanda Forever" is never cut to "Black Panther" (`extract.test.ts`)
- [x] K3 (medium, Qloo) "Tiffany & Co." keeps its "Co." (`extract.test.ts`)
- [x] K4 (medium, Qloo) Two names for one city are one candidate; a locality reply of candidates only is a ranking even if it leaves one out (listed as unranked); only a reply with non-candidates means the filter was dropped (`failure-paths.test.ts`)
- [x] K5 (medium, Qloo) An initial folds only when its name ends the list item ("Lil Nas X. Both skew…" is a name, then a sentence) (`extract.test.ts`)
- [x] K6 (low, Qloo) "along with" and "×" split lists; a compare 404 reads as no results; null tolerance across insights, trending, heatmap, demographics and compare replies; a link-only brief whose lookup failed says so, not "no match"; `spotify:artist:` URIs are read (`extract.test.ts`, `client.test.ts`, `failure-paths.test.ts`)
- [x] K7 (low, judge) Joins only where a split may have broken a name ("Burna Boy, Wizkid" is two names); the audit note lists the names past the 15-name cap; a refused preset's banner gives the refusal's first sentence only; a preset run's permalink highlights its preset (and offers Re-run live); a replaced pick's label keeps its case (`extract.test.ts`, `agent-pure.test.ts`)
- [x] K8 (medium, security) The keyless (unmetered) cap covers fresh preset runs, `/api/audit`, MCP `audit_plan` and `plan_campaign` too, plus an instance-wide 60 a minute; keyless custom runs are kept an hour, not 45 days; free audits are kept 10 minutes (`api.test.ts`)
- [x] K9 (medium, security) `/api/owner` runs the in-process flood guard before its store-backed attempt limit (`api.test.ts`)
- [x] K10 (medium, security) A "no results" 404 is never cached, and a run or audit that saw one is kept only 10 minutes (and never replaces a healthy run's pointer), so a gateway blip can't stand as an "invented" verdict for a day (`client.test.ts`, `api.test.ts`, `audit.test.ts`)
- [x] K11 (low, security) No redirects on Qloo, model or Sigmora calls (keys never follow a reply to another origin); `ipKey` drops an IPv4 source port; a degraded "Re-run live" never replaces a preset's healthy result
- [-] K12 (low, security) A store timeout after an increment applied leaks that reservation until midnight UTC (fails closed; a variant of F15)
- [-] K13 (low, judge) "Edit brief" wording, the 10% "low by design" threshold, counted (not named) unreplaced picks, "J Cole" shown without the initial's dot, failed live calls counting toward a share (they were sent): kept as is
- [x] K14 (soak) A test could straddle a clock-minute window (seed 511810038); its clock is pinned

## Re-audit 11 (2026-10-26, three lenses on dfac45a: 0 high from Qloo and judge; the security lens was stopped by a wind-down before it reported)

- [x] L1 (medium, Qloo; regression from K5) An initial folds before any separator and in chains: "SZA, J. Cole.", "J. Cole x Wizkid", "J. Cole — …", "A. R. Rahman" (`extract.test.ts`)
- [x] L2 (medium, Qloo) Joins are tried only where a split may have broken one name (a word joined by and/&/+, a word before an "&" name, or "The …"): comma lists of one-word names spend no searches, so real "A & B" splits aren't crowded out (`extract.test.ts`)
- [x] L3 (medium, Qloo; regression from K10) Qloo's own JSON "No results" 404 is an answer, cached like any empty reply and not counted; only a non-JSON (gateway) 404 is uncached and marks the job brief. So healthy live runs keep their 24 h cache and repeated lookups aren't re-paid (`client.test.ts`)
- [x] L4 (medium, Qloo) "Features" / "Key features" lines are not artist picks; "Featured brands" stays sponsors; an article before a lowercase word is a description, "A Tribe Called Quest" a name (`extract.test.ts`)
- [x] L5 (low, Qloo) `results: null` and a compare item's `query: null` are tolerated; a locality reply of candidates only is used when it ranks at least half of them, and the trace text counts real non-candidates; a refused redirect isn't retried; undocumented `/entities` params removed; MCP `plan_campaign` exempts presets from the keyless cap as `/api/run` does; a degraded run never rewrites the last-run pointer either (`client.test.ts`, `failure-paths.test.ts`)
- [x] L6 (medium, judge; regression from K7) A permalink highlights a preset only when the whole brief is that preset's, so an edited preset's "Re-run live" can't replace it (`agent-pure.test.ts`)
- [x] L7 (medium, judge) "Edit brief" names the folded-away fields it keeps ("Kept from the brief on screen: what's launching, goal, city…") with a "Start blank" button (`components.test.tsx`)
- [x] L8 (medium, judge) After the one-click sample, the audit audience is labelled as the sample's, and goes back to the brief's once the reader writes their own plan
- [x] L9 (low, judge) "LA", "NYC", "SF", "ATL", "DC" in a city list are looked up by the city's name; "Smith & Co." and "Mumford & Sons" aren't split; MCP prints no numbers on simulated data; no double full stop after a seed ending in "."; `.env.example` gives the audit's 30-call reservation (`extract.test.ts`, `mcp.test.ts`)
- [-] L10 (low, judge) "J. Cole" shown as "J Cole" (matching is unaffected); a repeated affinity sentence in audit rows; the audit 429's flat Retry-After; "N Qloo calls" counting cache hits (it counts the calls the run made, served live or from cache); subtitles searched before "&" splits (a wrong subtitle guess audits a different work; an unsplit "A & B" is at worst flagged); "Atlanta GA" without a comma: kept as is

## Owner milestone for 2026-10-29T18:00Z (submission materials final and pushed)

- [x] `docs/SUBMISSION.md` has every Devpost field in form order: name, elevator pitch (197 of 200 characters), thumbnail, About (Inspiration through What's next), Built with, Try it out, Video, Image gallery, and a pre-submit checklist
- [x] Video demo script: `docs/demo-script.md` (≤ 2 min shot list and voice-over); `pnpm video` records every segment in that order, including Audit any AI's plan

## Re-audit 12 (2026-10-27, three lenses on 1f0f04a: 0 critical and 0 high from Qloo depth, security and the judge path)

- [x] M1 Qloo: the benchmark method said brand and venue pools are diversified by subtype; only `urn:tag` is (`aggregate.ts`, `config.ts` comment, `docs/benchmark.md`)
- [x] M2 Qloo: "in the launch city" was checked against Qloo's padded locality boundary; venue discovery, the critic's venue check and the in-city heatmap now send `filter.location.radius=0` per the parameter reference (`context.ts`, `critic.ts`, `run.ts`; `tests/integration/wire-params.test.ts`)
- [P] M3 Qloo: compare, explainability, trending series and locality coordinates have never been seen live; `pnpm fixtures:record` first thing once `QLOO_API_KEY` lands (BLOCKED.md)
- [-] L4 Qloo: `bias.trends` "off"/"very_*" values: Qloo's parameter reference lists no allowed values ("The level of impact a trending entity has on the results"), so the allow-list stays at the values we send until a live recording shows otherwise
- [-] L5 Qloo: venue score scale (pool vs. scoring call): unverified until live; both calls carry the same audience signal
- [-] L6/L7 Qloo: unlisted invented names in copy and generic-title homonyms: accepted limits already disclosed (A4, benchmark "upper bound")
- [x] M1 security: a hosted (Vercel) deployment with a paid key and no KV now fails the build ("Invalid KV setup"), and half a KV pair fails anywhere (`config.ts` `kvProblems`; `tests/unit/counter-guard-config.test.ts`)
- [x] L5 security: secret-bearing base URLs must be https (plain http only for localhost) (`config.ts` `secureUrl`; same test file)
- [-] L1 security: forwarded-IP headers are trusted as Vercel sets them; the deploy target is Vercel (README), and global caps bound spend on any host
- [-] L2 security: owner key on `/api/run` isn't attempt-counted; the key is 32+ characters with 12+ distinct (config refine), so guessing is infeasible
- [-] L3 security: no `max_tokens` on the OpenAI-compatible format: OpenAI's reasoning models reject `max_tokens`, so sending it would break valid configs; output is bounded by the 25 s timeout and at most 150 runs a day
- [-] L4/L6/L7 security: body size (platform 4.5 MB cap, flood guard first), non-revocable 30-day owner cookie (HttpOnly, SameSite=Strict; rotate the key to revoke), KV-flap refunds on rate limits only (C11/I16)
- [x] M1 judge: unknown paths get a branded 404 with "Back to the demo", and `/docs/*` on the demo domain redirects to the repo copy (`src/app/not-found.tsx`, `next.config.ts`; e2e "branded 404")
- [x] M2 judge: below the desktop layout, flipping With/Without brings the campaign pack under the sticky bar (`App.tsx` `switchMode`; e2e "flipping the plan view")
- [x] M3 judge: offline, a custom brief's diff card no longer shows a preset's scripted sample as "what the plain model would have shipped" (`DiffCard.tsx` `offBrief`; e2e "custom brief's diff card")
- [x] L6 judge: an offline `pnpm benchmark` leaves `docs/benchmark.md` byte-identical (no timestamp in the not-a-measurement note)
- [x] L5 judge: heading order (sr-only h2 on the diff card) and the mobile h1 orphan (`text-balance`); chips at 26 px clear WCAG 2.2 AA's 24 px target size
- [-] L4 judge: the sample audit's "not audited" note names the sample's fictional artist and single; the note is accurate (no Qloo entity has those names)
- [P] L7 judge: `docs/PLAYBOOK.md` and `.agent/` become public with the repo: owner decision before the public flip (BLOCKED.md)
