# Devpost submission: Tastemaker by Sigmora

> Paste-ready. Fill the bracketed items only from measured sources: the live URL once hosted, the benchmark numbers once `docs/benchmark.md` is a live measurement (not the DRY RUN), and the video link.

**Title:** Tastemaker by Sigmora

**Tagline:** Every marketing agent guesses the culture. Tastemaker checks it.

## Inspiration

We run a small studio and use AI agents to market our own products. They kept picking cultural references our audience didn't care about: the famous artist instead of the one our listeners actually stream, a podcast whose audience is the opposite of ours, sometimes a collective that doesn't exist. LLM marketing agents hallucinate culture, and they sound confident doing it.

## What it does

Tastemaker plans a launch campaign for a creator or small brand (audience, launch city, collaborators, brand partners, hook references, podcast pitches, a venue, a presenter, hooks, a 30-second script and per-platform captions) and **uses Qloo as the critic inside the agent loop**:

1. The model drafts the plan from Qloo's audience data.
2. Every cultural entity it names is resolved in Qloo. If it doesn't exist, it's flagged as invented.
3. Every real pick is scored against the target audience with `filter.results.entities` and `feature.explainability`. Venues must be in the launch city; hook references must not be fading on `/v2/trending`.
4. Failures are replaced with Qloo-preferred picks, the model revises, and the critic checks again.
5. Every surviving pick carries a **receipt**: affinity, pass bar, which seed drove it, trend, and the exact Qloo call.
6. **Without Qloo:** one toggle shows the plan the same model writes with no Qloo access, with its misses struck through.
7. **Ship:** the verified pack goes to Sigmora's publishing engine as a schedule (a labeled sandbox on the public demo).

## Why it can't work without Qloo

- The critic step *is* a Qloo call. Remove Qloo and the agent has no way to reject a culturally wrong pick; the Without Qloo view shows the result on every run.
- City choice, demographic over-indexing, rising vs. fading references and audience-vs-audience gaps are measured data an LLM cannot produce from pretraining.

## How we built it

Next.js + TypeScript, a zod-typed Qloo client, and a model-agnostic LLM layer (any OpenAI-compatible or Anthropic model from env). Qloo surfaces used, each visible in the live agent trace:

- `/search` and `/entities` (Spotify/IMDb external IDs) to resolve seeds and catch invented names
- `/v2/insights` with `urn:demographics` (who over-indexes) and `urn:tag` (taste vocabulary for the copy)
- `/v2/insights` across artist, brand, tv_show, movie, podcast and person: the cross-domain culture map
- `urn:entity:locality` ranking and `urn:heatmap` with a locality boundary: where to launch
- `urn:entity:place` with `filter.location.query`: venues, and the venue-in-city check
- `filter.results.entities` + `feature.explainability`: the critic
- `/v2/trending`: rising vs. fading references
- `/v2/analysis/compare`: the positioning gap vs. a comparable's audience
- `signal.demographics.*` on every call

Every request is validated against per-`filter.type` parameter allow-lists (Qloo silently drops unknown params), cached by normalized request, recordable as fixtures, and labeled live / replayed in the UI.

## Culture Miss Rate

Across 30 briefs (music, DTC, sports), the same model with no Qloo access produced **[X]%** picks that were invented or below the audience's affinity bar; with the Qloo critic the shipped plans had **[Y]%**. Method, script and raw outputs: `docs/benchmark.md`, `benchmark/results.json`. *(Fill only from a live run.)*

## Responsible taste

Aggregate-only: inputs are public catalog entities, tags and demographic buckets, never a person's data. Results are audience-level affinity. Every number links to the Qloo call behind it.

## New-work disclosure

Sigmora (content production and publishing) pre-existed and is reached only through a narrow `/v1` API. All Qloo integration, the agent, the critic loop, the UI and the benchmark were built for this hackathon (planning from 2026-10-06, code from 2026-10-24). Details: `docs/new-work-disclosure.md`.

## Try it

- Live demo: [URL]
- Repo (MIT): https://github.com/mlsniperpro/sigmora-tastemaker
- Video: [URL]
- Three one-click presets: indie single launch, DTC brand entering Atlanta, football club growing a US fan market.
