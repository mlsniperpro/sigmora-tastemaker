# BLOCKED: inputs only the owner can provide

Everything below is already built behind a stub, fixture or sandbox, so each item takes effect as soon as its input arrives. Status as of 2026-10-25 08:20 UTC: none of these inputs exist in the build session. The Qloo hackathon host is now reachable from it (`curl https://hackathon.api.qloo.com/search?query=Tems` returns 401 without a key), so the live recording can run here as soon as `QLOO_API_KEY` is added as a session secret. No call has been verified against live Qloo yet.

## Checklist of owner inputs

- [ ] **`QLOO_API_KEY`** (the hackathon key). Set it as a server-side env var on the deployment, then, with the LLM keys set too, run:
  1. `pnpm fixtures:record`. It records every Qloo response the presets use into `fixtures/qloo/recorded.json`, so a failed live call can fall back to a recorded live answer.
  2. `pnpm runs:record`. It records one finished live run per preset into `fixtures/runs/recorded.json`, and the audit panel's sample audit into `fixtures/audits/recorded.json` (served, labelled, when a new audit of the sample is refused). The demo serves these instantly, labelled "a recorded live run", and offers "Re-run live". It also serves them when a live run is refused (budget or rate limit) or fails, so the preset buttons keep working during judging whatever the key does. The script refuses simulated or scripted runs.

  Commit the three files.
- [ ] **`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`** (and `LLM_BASE_URL` for OpenAI-compatible hosts). Without them, drafts come from the scripted model, which is labeled in the UI.
- [ ] **Vercel project.** Connect `mlsniperpro/sigmora-tastemaker`, set the env vars above (see `.env.example`), and deploy by `git push`. Point `tastemaker.sigmora.org` at it.
- [ ] **`KV_REST_API_URL`, `KV_REST_API_TOKEN`** (Upstash or Vercel KV). **Required for the hosted demo.** Run permalinks (`?run=<id>`, kept 45 days), Ship and measure all look runs up by id, and serverless instances don't share memory. KV also makes the response cache and the rate-limit and budget counters shared across instances. Without it, a permalink or Ship can fail on another instance, and the limits apply per instance.
- [ ] **Sigmora `/v1`.** Set `SIGMORA_PUBLISH_MODE=live`, `SIGMORA_API_URL`, `SIGMORA_API_TOKEN` and `SIGMORA_OWNER_KEY` (32+ random characters with at least 12 distinct ones, e.g. `openssl rand -hex 24`) once Sigmora exposes the endpoint below. Only requests carrying the owner key reach real channels; every visitor, in any mode, gets the labeled sandbox. To ship from the browser for the dogfood run and the video, sign it in once from the devtools console: `fetch("/api/owner", {method: "POST", body: JSON.stringify({key: "<SIGMORA_OWNER_KEY>"})})` (it sets an httpOnly, SameSite=Strict cookie scoped to `/api` holding a signed 30-day session token, never the key; 5 attempts a minute per IP; `fetch("/api/owner", {method: "DELETE"})` signs out). Scripts send the header `x-tastemaker-owner: <key>` instead.
- [ ] **Qloo quota for judging (Nov 2–16).** Qloo doesn't publish the hackathon key's quota, so the defaults are deliberately small.
  - The day: `QLOO_DAILY_CALL_CAP=480`.
  - Cold preset runs draw on `QLOO_PRESET_POOL=240`, each preset at most `QLOO_PRESET_DAILY_CALLS=160`.
  - Custom briefs, "Re-run live" and plan audits draw on the other 240. Each network (an IP, or an IPv6 /64) gets at most `QLOO_IP_DAILY_CALLS=80`, which is one run or one audit, and at most a third of that pool.
  - A new run reserves `QLOO_RUN_ESTIMATE=80`; an audit reserves 80.
  - Identical audits and briefs are served from cache without spending.
  - **Owner action:** ask Qloo for the judging-period quota, then raise `QLOO_DAILY_CALL_CAP` to about quota ÷ 15 days and scale the pools and shares with it. Settings that can't fit one run in every share fail the build, so a bad value never reaches visitors.
  - When a share is spent, the request is refused up front with a message naming that share: presets show their recording or their last finished run, and permalinks and cached runs still work.
  - With KV set, a KV outage refuses new paid runs rather than letting each instance count from zero.
- [ ] **Benchmark run.** With the Qloo and LLM keys set (and ideally `JUDGE_PROVIDER`, `JUDGE_MODEL`, `JUDGE_API_KEY` for a judge from a different vendor than the generator), and `QLOO_DAILY_CALL_CAP` above the request count stated in `docs/benchmark.md`, run `pnpm benchmark`. Commit `docs/benchmark.md`, `benchmark/summary.json` (written only for a valid measurement) and `fixtures/judge/recorded.json`. Raw runs stay in the gitignored `benchmark/runs/`. Until then the report says "No measurement yet" and shows no numbers.
- [ ] **Video.** Run `pnpm video https://<deployment>` against the live deployment (needs Playwright + Chromium), then add a voice-over.
- [ ] **GitHub Actions runners.** CI (`.github/workflows/ci.yml`) jobs end in 2–3 s with no runner assigned, which on a private repo usually means the Actions minutes, spending limit or billing are blocked. Check Settings → Billing → Actions; making the repo public (next item) also lifts the minutes limit.
- [ ] **Make the repo public.** GitHub → `mlsniperpro/sigmora-tastemaker` → Settings → Danger zone → Change visibility → Public. The rules require a public repo with all source needed to run it.
- [ ] **Merge PR #1 into `main`.** GitHub reads the licence from the default branch, so the MIT `LICENSE` only shows in the repo's About panel after the merge. Then check that About shows "MIT license" and add the live demo URL as the repo website.
- [ ] **Devpost submission** (Oct 29–30, before Oct 30 23:45 ET). Paste from `SUBMISSION.md`: title, tagline, description, "built with", the live demo URL, the public repo URL, the video link and the screenshots in `docs/screenshots/`. Retake those first with `pnpm screenshots <live demo URL>` once the Qloo and LLM keys are set, so the images show real Qloo numbers instead of the offline run's labelled simulated ones. Submit; a draft doesn't count.
- [ ] **Dogfood campaign** (the playbook's P1 traction item). Run one real Sigmora campaign planned by Tastemaker, for a real client or for Sigmora itself. Ship it through `/v1` (needs the Sigmora item above), then add the real reach and engagement numbers and the client's permission to `SUBMISSION.md`. Don't publish numbers before they exist.
- [ ] **Sigmora brand tokens.** Paste the colour and type values from `packages/brand` (private `sigmora-platform` repo) into the token block at the top of `src/app/globals.css`. Components use only the utilities generated from those tokens, so nothing else changes. This repo may not import private Sigmora code, so the values have to be copied in by hand.
- [ ] **Spotify probe.** Set `PROBE_SPOTIFY_ID` to a real artist ID when running `pnpm fixtures:record`. That verifies the `/entities` external-ID lookup.

## The Sigmora `/v1` contract this repo calls

`POST {SIGMORA_API_URL}/v1/campaigns` with headers `Authorization: Bearer <token>` and `Idempotency-Key: tastemaker-<runId>`, and this body:

```json
{ "source": "tastemaker", "name": "…", "metadata": { "tastemakerRunId": "…", "verifiedPicks": ["…"] },
  "posts": [{ "platform": "TikTok", "text": "…", "scheduledFor": "2026-10-25T17:00:00.000Z" }] }
```

Expected reply: `{ "id": "<campaign id>", "posts": [{ "id": "<post id>" }] }`. Sigmora implements this endpoint, or `SigmoraPublisher` in `src/lib/publisher/index.ts` gets adapted to whatever `/v1` actually exposes.

**Measure → re-query** reads performance back: `GET {SIGMORA_API_URL}/v1/campaigns/<id>/metrics` with the same bearer token, replying

```json
{ "id": "<campaign id>", "metadata": { "tastemakerRunId": "…" },
  "posts": [{ "platform": "TikTok", "text": "<what was posted>", "impressions": 1200, "engagements": 96 }] }
```

`metadata.tastemakerRunId` (sent at ship time) names the run to re-query, and a run shipped through Sigmora is kept for 30 days for this. Posts with 500+ impressions are compared, each by its own text. Verified picks named in posts that beat the median engagement rate become the next run's seeds (`src/lib/agent/requery.ts`). After a real Sigmora ship, the receipt offers "Measure and re-query" and a bookmarkable `/?measure=<campaign id>` link. The sandbox has nothing to measure and says so.

## Live calls to verify when the key lands (`pnpm fixtures:record` prints a line per preset)

Each call below is built from Qloo's docs plus notes from other entrants who ran on the hackathon host. The record script and the trace show any call that fails or comes back empty. Every failure also shows in the UI's source banner (no silent fallbacks).

| # | Call | Check | Code |
|---|---|---|---|
| 1 | `/search?query=…` (no `types`) and `…&types=urn:entity:<type>` | Hits carry `entity_id`, `name`, `types`; `sameName` rejects fuzzy hits for invented names | `context.ts` `resolveSeeds`, `critic.ts` `resolvePick` |
| 2 | `/entities?external.spotify.ids=…` / `external.imdb.ids` | Param names and shape, and that the hero preset's link (`687cZJR45JO7jhk1LHIbgq`, Tems) resolves to Tems; if it doesn't, replace it in `presets.ts` with the id the record script prints. The name seeds still cover the run if it fails | `context.ts` `resolveLinks`, `presets.ts` |
| 3 | `/v2/tags?filter.query=…&feature.semantic_search=true` | `results.tags[]` with `tag_id`/`id`; the IDs work as `signal.interests.tags` | vibe step, `run.ts` |
| 4 | `urn:demographics` | `results.demographics[]`, one row per input signal (averaged across the seeds by `aggregateDemographics`); age keys match `AGE_BUCKETS` | demographics step, `context.ts` |
| 5 | `signal.demographics.age` values | We send the brief's fine buckets (`25_to_29`, `30_to_34`, …), the enum in the insights deep-dive. If they come back empty, check the coarse buckets | `context.ts` `signalAges` |
| 6 | `urn:tag` insights | `results.tags[]` with `query.affinity` | tags step |
| 7 | Six cross-domain types | Non-empty for the hero preset. Person queries are sent without demographic signals (reported to replace the audience there) | `context.ts` `loadCulture`, `signalFor` |
| 8 | `urn:entity:locality` + `filter.results.entities` | Ranks candidate metros. If it's empty, the run falls back to the folded heatmap (the trace says "ranked by heatmap") | `cities.ts` |
| 9 | `urn:heatmap` + `filter.location=POLYGON(…)` (US box) + `take=50` | Cells with `location.latitude/longitude` and `query.affinity`. `output.heatmap.boundary` is deliberately not sent (reported 500/400 on this host); cells are folded into cities within 60 km | `cities.ts` |
| 10 | `urn:entity:place` + `filter.location.query=<city>` | Venues come back, and the venue-in-city check works with `filter.results.entities` | `context.ts` `loadVenues`, `critic.ts` |
| 11 | `/v2/trending?filter.type=…&signal.interests.entities=<one id>&filter.start_date&filter.end_date` | One call per reference candidate, with a 6-week window ending on the last Monday (UTC). Response `results.trending[]` (a date series; the newest point is taken). The fading bar is `population_percent_delta < -3`, which is provisional: set it from the first live recording (`fadingBelow` in `context.ts`) | `context.ts` `loadTrends`, `tests/unit/qloo-contract.test.ts` |
| 12 | `/v2/analysis/compare?a.signal.interests.entities=…&b.signal.interests.entities=…&filter.subtype=urn:tag:genre` | `results` is an array (documented); the per-side `query.a/b` affinity fields are our reading, since the docs publish no example. A tag missing either side is skipped, never given a number | compare step, `compareItems` in `qloo/types.ts` |
| 13 | **The critic:** `filter.results.entities` + `feature.explainability=true` | Affinity is kept; explainability sits at `query.explainability["signal.interests.entities"][]` | `critic.ts` `scoreByType` |
| 14 | Param allow-lists | Each list in `params.ts` against [available-parameters-by-entity-type](https://docs.qloo.com/reference/available-parameters-by-entity-type) | `params.ts` |
| 15 | `bias.trends` on artist / tv_show / movie / podcast discovery | We send `QLOO_BIAS_TRENDS` (default `medium`; values `low`/`medium`/`high` assumed, since no public doc lists them). Compare results with and without it; if it's silently dropped (identical lists) or empties results, set `QLOO_BIAS_TRENDS=off` | `context.ts` `discoveryParams` |
| 16 | `diversify.by=subtype` on the `urn:tag` taste-vocabulary call (the documented use; `QLOO_DIVERSIFY=off` stops it) | Tags vary in subtype and the list stays non-empty. It is no longer sent on brand or place discovery, where no documented value applies | `context.ts`, `params.ts` |
| 17 | Nairobi coverage (probe) | `/search?query=Nairobi&types=urn:entity:locality`, places in Nairobi. Pass means a Nairobi preset can be added (P2) | `scripts/record-fixtures.ts` |

## Before making the repo public (owner decision)
- [ ] `docs/PLAYBOOK.md` holds judge-by-judge tactics and `.agent/` holds the session tooling and hand-off notes. Both become public with the repo. The win gate needs `.agent/` tracked until submission. Decide whether to trim the playbook or move both out before flipping the repo to public.
