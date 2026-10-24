# BLOCKED: inputs only the owner can provide

Everything below is already built behind a stub, fixture or sandbox, so each item takes effect as soon as its input arrives. Status as of 2026-10-24: none of these inputs exist in the build session. The Qloo hackathon host is also blocked by the session's network policy, so no call has been verified against live Qloo yet.

## Checklist of owner inputs

- [ ] **`QLOO_API_KEY`** (the hackathon key). Set it as a server-side env var on the deployment, then run `QLOO_API_KEY=… pnpm fixtures:record` once. That records every preset into `fixtures/qloo/recorded.json`, so presets keep working even if the key is rate-limited during judging. Commit the fixture file.
- [ ] **`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`** (and `LLM_BASE_URL` for OpenAI-compatible hosts). Without them, drafts come from the scripted model, which is labeled in the UI.
- [ ] **Vercel project.** Connect `mlsniperpro/sigmora-tastemaker`, set the env vars above (see `.env.example`), and deploy by `git push`. Point `tastemaker.sigmora.org` at it.
- [ ] **`KV_REST_API_URL`, `KV_REST_API_TOKEN`** (Upstash or Vercel KV). These turn the response cache and rate-limit and budget counters into shared state across instances. Without them, the limits apply per instance.
- [ ] **Sigmora `/v1`.** Set `SIGMORA_PUBLISH_MODE=live`, `SIGMORA_API_URL` and `SIGMORA_API_TOKEN` once Sigmora exposes the endpoint below. The public demo stays on the labeled sandbox until then.
- [ ] **Benchmark run.** With the Qloo and LLM keys set and `QLOO_DAILY_CALL_CAP` above the request count stated in `docs/benchmark.md`, run `pnpm benchmark` and commit `docs/benchmark.md` and `benchmark/results.json`. Until then the report is a labeled DRY RUN and must not be quoted.
- [ ] **Video.** Run `pnpm video https://<deployment>` against the live deployment (needs Playwright + Chromium), then add a voice-over.
- [ ] **Spotify probe.** Set `PROBE_SPOTIFY_ID` to a real artist ID when running `pnpm fixtures:record`. That verifies the `/entities` external-ID lookup.

## The Sigmora `/v1` contract this repo calls

`POST {SIGMORA_API_URL}/v1/campaigns` with headers `Authorization: Bearer <token>` and `Idempotency-Key: tastemaker-<runId>`, and this body:

```json
{ "source": "tastemaker", "name": "…", "metadata": { "tastemakerRunId": "…", "verifiedPicks": ["…"] },
  "posts": [{ "platform": "TikTok", "text": "…", "scheduledFor": "2026-10-25T17:00:00.000Z" }] }
```

Expected reply: `{ "id": "<campaign id>", "posts": [{ "id": "<post id>" }] }`. Sigmora implements this endpoint, or `SigmoraPublisher` in `src/lib/publisher/index.ts` gets adapted to whatever `/v1` actually exposes.

## Live calls to verify when the key lands (`pnpm fixtures:record` prints a line per preset)

Each call below is built from Qloo's docs plus notes from other entrants who ran on the hackathon host. The record script and the trace show any call that fails or comes back empty. Every failure also shows in the UI's source banner (no silent fallbacks).

| # | Call | Check | Code |
|---|---|---|---|
| 1 | `/search?query=…` (no `types`) and `…&types=urn:entity:<type>` | Hits carry `entity_id`, `name`, `types`; `sameName` rejects fuzzy hits for invented names | `context.ts` `resolveSeeds`, `critic.ts` `resolvePick` |
| 2 | `/entities?external.spotify.ids=…` / `external.imdb.ids` | Param names and shape | `context.ts` `resolveLinks` |
| 3 | `/v2/tags?filter.query=…&feature.semantic_search=true` | `results.tags[]` with `tag_id`/`id`; the IDs work as `signal.interests.tags` | vibe step, `run.ts` |
| 4 | `urn:demographics` | `results.demographics[0].query.age/gender`; age keys match `AGE_BUCKETS` | demographics step |
| 5 | `signal.demographics.age` values | We send `35_and_younger` / `36_to_55` / `55_and_older`. If they come back empty, switch `signalAges` to the fine buckets | `context.ts` `signalAges` |
| 6 | `urn:tag` insights | `results.tags[]` with `query.affinity` | tags step |
| 7 | Six cross-domain types | Non-empty for the hero preset. Person queries are sent without demographic signals (reported to replace the audience there) | `context.ts` `loadCulture`, `signalFor` |
| 8 | `urn:entity:locality` + `filter.results.entities` | Ranks candidate metros. If it's empty, the run falls back to the folded heatmap (the trace says "ranked by heatmap") | `cities.ts` |
| 9 | `urn:heatmap` + `filter.location=POLYGON(…)` (US box) | Cells with `location.latitude/longitude` and `query.affinity`. `output.heatmap.boundary` is deliberately not sent (reported 500/400 on this host); cells are folded into cities within 60 km | `cities.ts` |
| 10 | `urn:entity:place` + `filter.location.query=<city>` | Venues come back, and the venue-in-city check works with `filter.results.entities` | `context.ts` `loadVenues`, `critic.ts` |
| 11 | `/v2/trending?filter.type=…&signal.interests.entities=…` | Whether trending accepts specific IDs, and the velocity field name (`population_rank_velocity`). Failures show on the step and as "trend check failed" on the critic | `context.ts` `loadTrends` |
| 12 | `/v2/analysis/compare?a.signal.interests.entities=…&b.signal.interests.entities=…` | Response `results.tags[].query.a/b/delta` (assumed) | compare step |
| 13 | **The critic:** `filter.results.entities` + `feature.explainability=true` | Affinity is kept; explainability sits at `query.explainability["signal.interests.entities"][]` | `critic.ts` `scoreByType` |
| 14 | Param allow-lists | Each list in `params.ts` against [available-parameters-by-entity-type](https://docs.qloo.com/reference/available-parameters-by-entity-type) | `params.ts` |
| 15 | Nairobi coverage (probe) | `/search?query=Nairobi&types=urn:entity:locality`, places in Nairobi. Pass means a Nairobi preset can be added (P2) | `scripts/record-fixtures.ts` |
