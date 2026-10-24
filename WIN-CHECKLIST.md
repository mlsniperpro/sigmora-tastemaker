# WIN-CHECKLIST: Tastemaker by Sigmora

Every judging criterion, playbook requirement and audit finding, mapped to evidence in this repo. ✅ = done and evidenced · 🟡 = partial (gap named) · ⏳ = needs an owner input (BLOCKED.md) · ⬜ = open.

Updated every loop round. Evidence commands are the ones in **Evidence** below, run on the head named there.

## Stage One (Qloo staff pass/fail screen)

| Requirement | Status | Evidence |
|---|---|---|
| Working software, Qloo API, agentic | ✅ | Agent loop `src/lib/agent/run.ts` (generate → Qloo critic → revise, ≤ 2 rounds); MCP tools `src/lib/mcp.ts`; `tests/integration/agent.test.ts`, `tests/integration/mcp.test.ts` |
| Externally hosted, no login | ⏳ | Vercel + keys (BLOCKED.md). The app needs no login; `e2e/judge-path.spec.ts` runs it with zero credentials |
| Public repo with all source and run instructions | ⏳ | Make the repo public (BLOCKED.md). Fresh-clone run of the README: see Evidence |
| MIT licence visible in About | ⏳ | `LICENSE` at root; shows in About after the merge to `main` (BLOCKED.md) |
| Text description, Qloo-powered | ✅ | `SUBMISSION.md`, `README.md` |
| Free access through judging | ⏳ | Budgets and caches so it stays up: `src/lib/guard.ts`, `src/lib/agent/runCache.ts`; hosting is the owner's |

## Stage Two criteria (equal weight; tie-break Tech → Design → Impact → Idea)

| Criterion | Status | Evidence |
|---|---|---|
| **Technological implementation**: thorough, skilful Qloo use | ✅ | 12 canonical surfaces (`src/lib/agent/surfaces.ts`); the hero run touches ≥ 10 (`tests/unit/surfaces.test.ts`); the critic (`filter.results.entities` + `feature.explainability`) in `src/lib/agent/critic.ts`; param allow-lists `src/lib/qloo/params.ts`; `bias.trends` / `diversify.by` on the wire (`tests/integration/wire-params.test.ts`); record/replay, throttle, budgets, retries (`tests/integration/client.test.ts`) |
| **Design**: complete, coherent product | 🟡 | One screen: brief → live trace → Taste Map → pack with receipts → Without Qloo → Ship (`e2e/judge-path.spec.ts` at 390 and 1440 px). Gaps: map tiles, a true cross-domain web, an always-visible brief bar (R3 below) |
| **Potential impact**: credible problem, demo solves it | 🟡 | ROI line from the run's own measurements (`App.tsx` `RoiLine`); Culture Miss Rate method and blind judge (`docs/benchmark.md`). Needs the live benchmark and the dogfood campaign (⏳) |
| **Quality of the idea**: non-obvious Qloo use | ✅ | Qloo as the critic that audits the AI; the Without Qloo diff on every run; measure → re-query (`src/lib/agent/requery.ts`) |

## Playbook §3 hero scenario

| Step | Status | Evidence |
|---|---|---|
| 1 Resolve from a Spotify/IMDb link | 🟡 | `resolveLinks` / `/entities` in `context.ts`; no preset uses a link yet and a link-only brief is not allowed (R3) |
| 2 Demographics + taste vocabulary | ✅ | `urn:demographics`, `urn:tag` steps in `run.ts`; Taste Map panels |
| 3 Cross-domain culture map with signals, `diversify.by` | ✅ | `loadCulture`, `discoveryParams` in `context.ts`; wire tests |
| 4 Where to launch + venues in the city | ✅ | `rankCities` (`cities.ts`); venues re-loaded for the plan's own city (`agent.test.ts` "judges venues in the city the plan chose") |
| 5 Rising vs fading | ✅ | `/v2/trending` step; fading verdicts |
| 6 Generate, then verify every entity | 🟡 | Every listed pick is resolved (typed + untyped search) and scored. Gap: names mentioned in copy but missing from `picks` (R3) |
| 7 Compare positioning gap | ✅ | `/v2/analysis/compare` step |
| 8 Receipts on every pick | ✅ | `ReceiptChip`; no score ⇒ no number (`critic.test.ts` "shows no number when Qloo gives no score") |
| 9 Without Qloo, annotated | ✅ | Inline annotation with rank among Qloo's candidates (`annotation` in `evidence.ts`; e2e asserts it) |
| 10 Ship to Sigmora | ✅ ⏳ | Sandbox publisher + `/v1` client with idempotency (`api.test.ts`); live endpoint ⏳ |
| 11 Measure → re-query | ✅ ⏳ | `requery.ts`, `/api/requery`, `/?measure=` (`requery.test.ts`); live metrics endpoint ⏳ |

## Playbook §7 design spec

| Item | Status | Evidence |
|---|---|---|
| Brief bar with link paste and audience chips | 🟡 | `BriefForm.tsx`; behind "Your own brief", no city/gender/compare fields (R3) |
| Live, collapsible trace with endpoint, params, latency | ✅ | `Trace.tsx`: running step, all params with entity names, canonical surfaces, collapse, aria-live; e2e asserts params |
| Taste Map: demographics, heatmap with map tiles, affinity web | 🟡 | Demographics, tags, city ranking, heatmap cells on a stylized outline. Map tiles and pick-to-pick edges open (R3) |
| Pack with receipt chips | ✅ | `CampaignPack.tsx` |
| Without Qloo toggle | ✅ | e2e |
| Ship bar | ✅ | e2e (sandbox) |
| Permalinks | 🟡 | `?preset=` / `?b=`; cached replays are labelled (e2e). Run-id permalinks kept past judging open (R2) |
| 390 px, no horizontal scroll | ✅ | e2e `noHorizontalScroll` |
| No placeholder numbers | ✅ | Scoreboard blanks simulated/scripted runs (`placeholderReason`); MCP does the same; report shows no numbers until a valid run |

## Playbook §9 ladder

| Item | Status | Evidence |
|---|---|---|
| P0 typed client, agent loop, receipts, toggle, repo docs | ✅ | See above |
| P0 hosted hero preset, rate-limited | ⏳ | Guard + caps built (`guard.ts`); hosting ⏳ |
| P1 heatmap + map UI | 🟡 | Ranking + heatmap cells; map tiles open |
| P1 trending, compare, presets, Ship (sandbox) | ✅ | Trace steps; three presets in `presets.ts` |
| P1 Spotify/IMDb seeding | 🟡 | Built; not shown in a preset |
| P1 benchmark published | 🟡 ⏳ | Script, blind judge and report ready; needs keys for a valid run |
| P1 ≤ 2-minute video | ⏳ | `pnpm video <url>` works; footage ⏳ |
| P2 MCP server | ✅ | `/api/mcp`, `mcp.test.ts` |
| P2 measure → re-query | ✅ ⏳ | See step 11 |
| P2 brand tokens | ✅ ⏳ | Token block in `globals.css`; Sigmora values ⏳ |
| P2 Nairobi preset | ⏳ | Probe in `scripts/record-fixtures.ts`, needs the key |

## Hostile-judge audit (2026-10-24), by item

| # | Finding | Status | Fix / evidence |
|---|---|---|---|
| 1 | Cold hero run slow, steps sequential | ⬜ | R2: recorded preset runs + parallel independent steps |
| 2 | Demo not resilient under rate limits | ⬜ | R2: serve the last good run when the budget or a required step fails |
| 3 | Looks like a fixed pipeline | ⬜ | R3: model chooses among critic-approved options via tools; decisions in the trace |
| 4 | Names in copy but not in `picks` go unchecked | ⬜ | R3 |
| 5 | Venues checked against the wrong city | ✅ | `followPlanCity` in `run.ts`; baseline audited in its own city; `agent.test.ts` |
| 6 | Pass bar circular | ⬜ | R3: percentile against a broad reference sample + sensitivity table |
| 7 | Made-up 0.00 affinity | ✅ | `unscored` verdict, no number; `critic.test.ts` |
| 8 | "Not a real entity" overclaims | ✅ | Untyped second search; "Not found in Qloo"; role-mismatch verdict; `critic.test.ts` |
| 9 | No ROI line in the app | ✅ | `RoiLine` from measured `durationMs`; e2e |
| 10 | Link seeding never visible | ⬜ | R3 |
| 11 | No map tiles | ⬜ | R3 |
| 12 | Affinity web is a star | ⬜ | R3 (subtitle corrected meanwhile) |
| 13 | Without Qloo annotations hover-only | ✅ | Inline `annotation`; e2e |
| 14 | Cached runs unlabelled | ✅ | `cached` on the result event; trace banner; e2e |
| 15 | Trace hides params | ✅ | All params with entity names; e2e |
| 16 | Surface count padded | ✅ | `surfaceOf`; `surfaces.test.ts` |
| 17 | Trace not live, not collapsible | ✅ | `start` events, running step, collapse, aria-live |
| 18 | Permalinks re-run; Ship needs KV across instances | ⬜ | R2 |
| 19 | Brief bar fields missing | ⬜ | R3 |
| 20 | DTC preset has no map | ⬜ | R3 |
| 21 | Ship sends captions only; ships with misses | ⬜ | R3 |
| 22 | Baseline failure kills the run | ✅ | `unavailable` baseline; `agent.test.ts`; benchmark counts it as failed |
| 23 | Empty pool ⇒ made-up 0.5 bar; MCP city picks always fail | ✅ | No bar ⇒ `unscored`; `taste_check` ranks cities; tests |
| 24 | MCP prints placeholder numbers | ✅ | `placeholderReason` in `mcp.ts` |
| 25 | Serverless lifecycle, no single-flight | ⬜ | R2 |
| 26 | Empty server HTML, no OG image | ⬜ | R2 |
| 27 | Tiny text on mobile | ⬜ | R3 |
| 28 | Highlighting case-sensitive, no word boundaries | ✅ | Unicode word-boundary, case-insensitive regex in `CampaignPack.tsx` |
| 29 | No aria-live; presets locked during a run | 🟡 | aria-live added; preset lock open (R3) |
| 30 | Misleading labels | ✅ | Ranked-by label, demographic units, scoreboard label, strongest driver |
| 31 | "Every number links to its call" overclaims | ⬜ | R3 |
| 32 | Numbers not from a script | ✅ | `.env.example`, route comment, README throttle note, SUBMISSION anecdote fixed |
| 33 | Benchmark covers 3 families | ⬜ | R3 |
| 34 | Missing tests | 🟡 | Added for 5, 7, 8, 14, 15, 16, 22, 23; desktop e2e. Component tests open |
| 35 | Client bundle and fixture import weight | ⬜ | R2 |

## Earlier audit (owner, PR #1)

All 8 items closed in `9194e0a`; details in the PR description.

## Evidence (latest round)

```
$ pnpm lint && pnpm typecheck      → clean (strict-type-checked, noUncheckedIndexedAccess)
$ pnpm test                        → Test Files 21 passed (21) · Tests 253 passed (253)
$ pnpm test:e2e                    → 4 passed (phone-390 and desktop-1440 × 2 tests)
$ FC_NUM_RUNS=20000 vitest run     → 241 passed (deep property pass, before this round)
$ soak: 60 rounds × suite at 500 runs/property
                                   → 1 failure in round 8: median([0,-0,5e-324]) was order-dependent; fixed at the root, regression test added
$ fresh clone → pnpm install --frozen-lockfile → pnpm test (241/241) → pnpm demo → pnpm dev:
  GET / → 200 in 0.12 s; POST /api/run streams a result; MCP taste_check answers
```
