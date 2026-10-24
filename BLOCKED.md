# BLOCKED: live calls still to verify

Status on 2026-10-24: **no Qloo key is available to the build session** (the hackathon host is not reachable from it, and `QLOO_API_KEY` is not a secret there yet). Everything below is built against Qloo's documented response shapes and runs end to end on the offline simulator. Nothing here has been checked against a live response.

## Unblock in one command

```bash
QLOO_API_KEY=… pnpm fixtures:record   # records every preset into fixtures/qloo/recorded.json and runs the probes
pnpm test && pnpm demo indie-release  # the demo now answers from replay, labeled "replayed"
```

Then set `QLOO_API_KEY` on the hosted deployment (server-side env only) so custom briefs go live; presets keep working from fixtures if the key is rate-limited.

## Calls to verify (in the order the agent makes them)

| # | Call | What to check | Where in code |
|---|---|---|---|
| 1 | `GET /search?query=Tems&take=5` (no `types`) | Seeds of any type resolve; result has `entity_id`, `name`, `subtype` or `types` | `run.ts` resolve step |
| 2 | `GET /search?query=…&types=urn:entity:<type>` | `types` is the right param name and accepts a URN; fuzzy matches for invented names are rejected by `sameName` | `client.ts` `search`, `util.ts` |
| 3 | `GET /entities?external.spotify.ids=…` | Param name and response shape for Spotify/IMDb external-ID lookup (`external.imdb.ids`) | `run.ts` `resolveLinks` |
| 4 | `GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=…` | Response is `results.demographics[0].query.age/gender` with signed values; age bucket keys match `AGE_BUCKETS` | `types.ts`, demographics step |
| 5 | `GET /v2/insights?filter.type=urn:tag&…` | Response is `results.tags[]` with `name` and `query.affinity` | tags step |
| 6 | `signal.demographics.age` values | We send coarse buckets (`35_and_younger`, `36_to_55`, `55_and_older`) mapped from the brief's fine buckets. Confirm accepted values (the playbook suggests `25_to_29,30_to_34` may also work) | `run.ts` `signalAges` |
| 7 | `GET /v2/insights?filter.type=urn:entity:<artist|brand|tv_show|movie|podcast|person>` with signals | Non-empty for the hero preset; `query.affinity` present | culture step |
| 8 | `GET /v2/insights?filter.type=urn:entity:locality&filter.results.entities=<locality ids>` | Locality is a valid insights type and `filter.results.entities` restricts to the candidate metros; `location.lat/lon` present | cities step |
| 9 | `GET /v2/insights?filter.type=urn:heatmap&output.heatmap.boundary=urn:entity:locality` **without** a location filter | Whether a national heatmap works, or a `filter.location*` is required; response shape `results.heatmap[].location.{latitude,longitude}` + `query.affinity` | heatmap step |
| 10 | `GET /v2/insights?filter.type=urn:entity:place&filter.location.query=Washington` | `filter.location.query` accepts a city name; venues come back | venues step, critic venue check |
| 11 | `GET /v2/trending?filter.type=…&signal.interests.entities=…` | Whether trending accepts specific entity IDs at all (it may only list what's trending per type); field name for velocity (`population_rank_velocity`) | trending step, critic |
| 12 | `GET /v2/analysis/compare?a.signal.interests.entities=…&b.signal.interests.entities=…` | Param names and the response shape (`results.tags[].query.a/b/delta` is assumed) | compare step |
| 13 | `filter.results.entities` + `feature.explainability=true` | **The critic.** Returned entities keep `query.affinity`; explainability lives at `query.explainability["signal.interests.entities"][]` with `entity_id` + `score` | `run.ts` `critique` |
| 14 | `bias.trends`, `diversify.by` | Not used yet; validate before turning on | `params.ts` |
| 15 | `video_game` vs `videogame` | Which spelling the hackathon host accepts | `params.ts` |
| 16 | `GET /v2/tags?filter.query=…&feature.semantic_search=true` | Free-text brief → tag IDs (client method exists, not wired into the loop yet) | `client.ts` `tags` |
| 17 | Param allow-lists | Every list in `params.ts` against [available-parameters-by-entity-type](https://docs.qloo.com/reference/available-parameters-by-entity-type) | `params.ts` |

## Probes (run by `pnpm fixtures:record`)

- Nairobi coverage: `/search?query=Nairobi&types=urn:entity:locality`, places with `filter.location.query=Nairobi`. Pass → add a Nairobi preset (P2).
- Spotify seeding: set `PROBE_SPOTIFY_ID` to a real artist ID.
- Tag semantic search for "afrobeats".

## Other blockers

- **Hosting.** The build session cannot create the Vercel project. Owner steps: connect the repo in Vercel, set env vars from `.env.example` (at least `QLOO_API_KEY` once recorded; optional `LLM_*`, `KV_REST_API_*`), deploy by `git push`. Point `tastemaker.sigmora.org` at it.
- **Sigmora `/v1` contract.** `SigmoraPublisher` posts to `POST /v1/campaigns` with `{ source, name, metadata, posts: [{platform, text, scheduledFor}] }` and expects `{ id, posts: [{ id }] }`. This shape is a proposal; confirm or adapt it against the real `/v1` before turning on `SIGMORA_PUBLISH_MODE=live`.
- **Benchmark numbers.** `docs/benchmark.md` is a labeled DRY RUN until it is re-run with a live key and a real LLM (`pnpm benchmark`). Do not quote it until then.
- **Mixed replay + simulator.** If a custom brief hits a request that was not recorded while the key is unavailable, that call falls back to the simulator, whose entity IDs don't match Qloo's. Each call is labeled with its source; on the hosted demo set the key so custom briefs go live.
