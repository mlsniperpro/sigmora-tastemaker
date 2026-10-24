# Tastemaker by Sigmora

**Every marketing agent guesses the culture. Tastemaker checks it, then ships the campaign.**

Tastemaker is a marketing agent that plans a launch for a creator or small brand: audience, launch city, collaborators, brand partners, hook references, podcast pitches, venue, presenter, hooks, a 30-second script and captions per platform. It uses [Qloo](https://www.qloo.com/) as the **critic inside the agent loop**. The LLM proposes, Qloo scores every cultural pick against the target audience, low-affinity and invented picks are cut and replaced with Qloo-preferred alternatives, and every surviving pick carries a **receipt**: affinity score, which input drove it (explainability), trend direction, and the exact Qloo call behind it.

A **Without Qloo** toggle shows the plan the same model writes with no Qloo access, with its misses struck through.

> **Disclosure:** built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). All Qloo integration, the agent, the critic loop, the UI and the benchmark are new work in this repo (see [docs/new-work-disclosure.md](docs/new-work-disclosure.md)). Sigmora, the publishing engine behind "Ship", pre-existed and is reached only through a narrow `/v1` API.

**Live demo:** _being connected to hosting; see [BLOCKED.md](BLOCKED.md)._ · **Judge path:** [docs/judging.md](docs/judging.md) · **Benchmark:** [docs/benchmark.md](docs/benchmark.md)

![Tastemaker: agent trace, Taste Map and campaign pack with receipts](docs/screenshots/desktop.png)

## Why it matters

An audience-research brief from an agency takes weeks. Tastemaker produces a checked launch plan (audience, city, references, assets, schedule) in one run, and shows you which of the AI's picks were wrong. LLM marketing agents *hallucinate culture*: they confidently pick artists, shows, brands and places an audience doesn't actually love, and sometimes ones that don't exist. Tastemaker measures that miss rate on every run and fixes it before anything ships.

## Try it in 10 seconds

Open the demo and click a preset:

1. **Indie artist: single launch.** An independent Afro-fusion artist picks the first US city to play.
2. **DTC brand: new city.** A clean-skincare brand opens a pop-up in Atlanta.
3. **Sports club: new fan market.** A football club picks its first US watch-party city.

Then flip **Without Qloo**, and click any receipt chip to see the Qloo call behind it.

## How the agent works

```
resolve seeds ─► who over-indexes ─► taste vocabulary ─► cross-domain culture map
 (/search,         (urn:demographics)   (urn:tag)            (/v2/insights × 6 types)
  /entities)
      ─► where to launch ─► demand heatmap ─► venues in the city ─► rising vs fading
         (urn:entity:locality) (urn:heatmap)    (place + filter.location) (/v2/trending)
      ─► positioning gap ─► LLM drafts the campaign
         (/v2/analysis/compare)
      ─► QLOO CRITIC: resolve every named entity (invented = hallucination),
         score with filter.results.entities + feature.explainability,
         check venues are in the launch city, check hook references aren't fading
      ─► replace failures with Qloo-preferred picks ─► LLM revises ─► critic again (≤ 2 rounds)
      ─► pack with receipts ─► Ship (Sigmora /v1, sandbox on the public demo)
```

The same model also drafts with no Qloo context; the critic audits that plan without fixing it, which powers the Without Qloo view and the Culture Miss Rate.

### Qloo surfaces used

| Surface | Job in Tastemaker |
|---|---|
| `GET /search` | Resolve seeds, candidate cities and every name the model writes; no match = invented entity |
| `GET /entities` (`external.spotify.ids`, `external.imdb.ids`) | Seed from a pasted Spotify or IMDb link |
| `/v2/insights` `urn:demographics` | Which age and gender buckets over-index |
| `/v2/insights` `urn:tag` | The audience's taste vocabulary, fed into the copy |
| `/v2/insights` artist · brand · tv_show · movie · podcast · person | Cross-domain culture map: collabs, partners, references, pitches, presenters |
| `/v2/insights` `urn:entity:locality` + `filter.results.entities` | Rank candidate launch metros |
| `/v2/insights` `urn:heatmap` + `output.heatmap.boundary=urn:entity:locality` | Demand map |
| `/v2/insights` `urn:entity:place` + `filter.location.query` | Venues in the launch city; venue-in-city check |
| `filter.results.entities` + `feature.explainability=true` | **The critic**: score the model's shortlist and attribute why |
| `GET /v2/trending` | Rising vs. fading references |
| `GET /v2/analysis/compare` | Positioning gap vs. a comparable's audience |
| `signal.demographics.age/gender` | Every call is conditioned on the target audience |

Every request is validated against a per-`filter.type` parameter allow-list before it leaves the server (Qloo silently drops unknown params), cached by normalized request, and labeled in the UI as **live**, **replayed** (recorded fixture) or **simulated**.

## Run it locally (zero credentials)

```bash
pnpm install
pnpm dev            # http://localhost:3000, runs fully offline
pnpm demo           # the hero preset end to end in the terminal
pnpm test           # unit + agent + API tests
```

With no keys, Qloo answers come from an **offline simulator** (placeholder numbers in Qloo's response shapes, labeled "simulated" everywhere) and drafts come from a **scripted model**. Add keys in `.env.local` (see [.env.example](.env.example)):

| Variable | Effect |
|---|---|
| `QLOO_API_KEY` | Live Qloo (hackathon host). Falls back to recorded fixtures, then the simulator, with the reason shown in the trace |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` | Any OpenAI-compatible or Anthropic model; no vendor is pinned |
| `SIGMORA_PUBLISH_MODE=live`, `SIGMORA_API_URL`, `SIGMORA_API_TOKEN` | Ship to real channels through Sigmora `/v1` (sandbox otherwise) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Shared Redis-over-REST cache for Qloo responses and runs |

Scripts: `pnpm fixtures:record` records live Qloo responses for every preset; `pnpm benchmark` runs the 30-brief Culture Miss Rate benchmark and writes [docs/benchmark.md](docs/benchmark.md).

## Repo map

```
src/lib/qloo/       typed client (live / replay / simulated), param validation, cache, simulator
src/lib/llm/        LLM providers: scripted offline model, OpenAI-compatible, Anthropic
src/lib/agent/      brief schema, presets, the agent loop and critic, result types
src/lib/publisher/  Ship: sandbox publisher and the Sigmora /v1 client
src/app/api/        POST /api/run (NDJSON stream of trace steps + result), POST /api/ship
src/components/     the one-page UI
benchmark/, scripts/  benchmark briefs, benchmark runner, fixture recorder, terminal demo
```

## Docs

- [docs/judging.md](docs/judging.md): the 3-click judge path and where each Qloo surface fires
- [docs/benchmark.md](docs/benchmark.md): Culture Miss Rate method and results
- [docs/responsible-taste.md](docs/responsible-taste.md): aggregate-only, no PII, claims discipline
- [docs/evidence-status.md](docs/evidence-status.md): what we claim and what we don't
- [docs/new-work-disclosure.md](docs/new-work-disclosure.md)
- [BLOCKED.md](BLOCKED.md): live calls still to verify
- [SUBMISSION.md](SUBMISSION.md): Devpost text

## License

MIT for the code in this repo ([LICENSE](LICENSE)). The Sigmora brand and platform are not covered; see [NOTICE.md](NOTICE.md).
