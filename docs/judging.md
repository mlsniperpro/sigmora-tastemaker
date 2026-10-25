# Judging guide

## What to remember

**"Don't guess the culture. Query it."** Tastemaker uses Qloo as the critic inside a marketing agent's loop: the model proposes, Qloo scores, weak picks and names Qloo can't find are replaced, and every survivor carries a receipt. The Without Qloo toggle shows what the same model gets wrong on its own.

## The 3-click path

1. **Open the demo.** The hero preset (indie Afro-fusion single launch) runs on load. Watch the **Agent trace** (left on desktop; on a phone, tap "Trace · N Qloo calls" in the sticky bar): every step names the Qloo endpoint and `filter.type` it called. Click a step to see each call's parameters, source and latency.
2. **Click a receipt chip** in the Campaign pack. It shows the affinity, the pass bar, the explainability split across the seed entities, the trend, and the exact `GET` behind it. "Replaced" picks show what the critic threw out.
3. **Flip "Without Qloo".** Same model, no Qloo access. Invented entities are pink, low-affinity picks red and struck through, fading references amber. The diff card at the top shows both sides for this run: what the plain model would have shipped, with its worst picks struck through, next to what the Qloo critic changed.

Then try the other two presets, or "Your own brief" (paste names your audience loves, or a Spotify/IMDb link). To see Qloo audit another AI's work, click **Paste any AI's plan →** at the top of the page (it opens **Audit any AI's plan** under the diff card) and click **Try a sample plan**, or paste a plan from any chatbot.

## Where each Qloo surface fires

| Trace step | Surface |
|---|---|
| Resolve the taste seed | `GET /search`, `GET /entities` (Spotify / IMDb external IDs) |
| Map the brief's vibe to taste tags | `GET /v2/tags` with `feature.semantic_search=true` → `signal.interests.tags` on every later call |
| Who over-indexes | `/v2/insights` `filter.type=urn:demographics` |
| Taste vocabulary | `/v2/insights` `filter.type=urn:tag` |
| Cross-domain culture map | `/v2/insights` × artist, brand, tv_show, movie, podcast, person, all with `signal.interests.entities` + `signal.demographics.*` |
| Where to launch (ranking) | `/search` (localities) + `/v2/insights` `urn:entity:locality` with `filter.results.entities` |
| Where to launch (heatmap) | `/v2/insights` `urn:heatmap` + `filter.location` (US polygon); cells folded into candidate cities |
| Venues in the city | `/v2/insights` `urn:entity:place` + `filter.location.query` |
| Rising vs. fading | `GET /v2/trending` |
| Positioning | `GET /v2/analysis/compare` |
| Qloo critic (each pass) | `/search` per named entity + `/v2/insights` with `filter.results.entities` + `feature.explainability=true`; place check with `filter.location.query` |
| Qloo audit of the baseline | same as the critic, on the Without Qloo plan |

## Engineering notes for the Qloo reviewer

- `src/lib/qloo/params.ts`: per-`filter.type` parameter allow-lists; invalid requests throw outside production (Qloo drops unknown params silently).
- `src/lib/qloo/client.ts`: hackathon host + `X-Api-Key`, server-side only; throttled under the key's rate limit; bounded retries with backoff; per-run and daily call budgets; normalized-request cache (memory + optional Redis REST); record/replay fixtures; every call labeled `live` / `replay` / `simulated`, with the fallback reason when a live call fails.
- `src/lib/agent/run.ts` (the loop) and `src/lib/agent/critic.ts` (the critic). Name matching rejects fuzzy search hits for invented names (`sameName`); swaps the model ignores are enforced.
- Data-source honesty: if the deployment has no key, a one-line note at the top of the diff card says the data is simulated (and the model scripted, when it is), and no benchmark number is quoted (see `docs/evidence-status.md`). The scripted model's plan without Qloo is labelled as a fixed sample plan for the category, not an answer to the brief.

## Qloo as the grounding layer for any agent

`POST /api/mcp` exposes the critic as MCP tools (`taste_check` for a pick list, `audit_plan` for any model's pasted plan) and the whole agent as `plan_campaign`. See the README for a one-line `curl`.
