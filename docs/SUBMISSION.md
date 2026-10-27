# Devpost submission: Tastemaker by Sigmora

> Paste-ready, one section per Devpost field, in the order the form asks for them. Fill the bracketed items only from measured sources: the live URL once hosted, the benchmark numbers once `docs/benchmark.md` is a live measurement (it currently says "No measurement yet"), and the video link. Before pasting, run the checklist at the end.

## Project name

Tastemaker by Sigmora

## Elevator pitch (Devpost limit: 200 characters)

Every marketing agent guesses the culture. Tastemaker checks it: Qloo is the critic in the agent loop, so every cultural pick ships with a receipt, and the same model without Qloo is a toggle away.

## Thumbnail

`src/app/opengraph-image.png` (3:2 crop works; it is the social card the live demo serves).

## About the project

The Devpost "About the project" field takes Markdown. Paste everything from **Inspiration** down to **What's next** as one block.

## Inspiration

We run a small studio and use AI agents to market our own products. They kept picking cultural references our audience didn't care about: the famous artist instead of the one our listeners actually stream, a podcast whose audience is the opposite of ours, sometimes a name that isn't in any catalogue at all. LLM marketing agents hallucinate culture, and they sound confident doing it.

## What it does

Tastemaker plans a launch campaign for a creator or small brand (audience, launch city, collaborators, brand partners, hook references, podcast pitches, a venue, a presenter, hooks, a 30-second script and per-platform captions) and **uses Qloo as the critic inside the agent loop**:

1. The model drafts the plan from Qloo's audience data.
2. Every cultural entity it names is resolved in Qloo, with a typed search and then an untyped one. A name Qloo can't find is flagged "not found in Qloo"; a real entity filed under the wrong type is flagged as a role mismatch.
3. Every real pick is scored against the target audience with `filter.results.entities` and `feature.explainability`. Venues must be in the launch city; hook references must not be fading on `/v2/trending`.
4. For each failure, the model either picks one of Qloo's above-bar options or proposes its own idea, which Qloo scores first and code keeps only if it clears the same bar. The model then revises the copy, and the critic checks the whole plan again.
5. Every surviving pick carries a **receipt**: affinity, pass bar, which seed drove it, trend, and the exact Qloo call.
6. **Without Qloo:** one toggle shows the plan the same model writes with no Qloo access, with its misses struck through.
7. **Ship:** the verified pack goes to Sigmora's publishing engine as a schedule (a labeled sandbox on the public demo).
8. **Audit any AI's plan:** paste a campaign written by ChatGPT, Claude or anyone, and the same Qloo critic checks every cultural name in it against your audience, with a receipt and a Qloo-preferred replacement for each failure. One click runs it on a sample chatbot plan.

## Why it can't work without Qloo

- The critic step *is* a Qloo call. Remove Qloo and the agent has no way to reject a culturally wrong pick; the Without Qloo view shows the result on every run.
- City choice, demographic over-indexing, rising vs. fading references and audience-vs-audience gaps are measured data an LLM cannot produce from pretraining.

## How we built it

Next.js + TypeScript, a zod-typed Qloo client, and a model-agnostic LLM layer (any OpenAI-compatible or Anthropic model from env). Qloo surfaces used, each visible in the live agent trace:

- `/search` and `/entities` (Spotify/IMDb external IDs) to resolve seeds and catch names that aren't in Qloo
- `/v2/insights` with `urn:demographics` (who over-indexes) and `urn:tag` (taste vocabulary for the copy)
- `/v2/insights` across artist, brand, tv_show, movie, podcast and person: the cross-domain culture map
- `urn:entity:locality` ranking and a `urn:heatmap` over the US folded into candidate cities: where to launch
- `urn:entity:place` with `filter.location.query`: venues, and the venue-in-city check
- `filter.results.entities` + `feature.explainability`: the critic
- `/v2/trending`: rising vs. fading references
- `/v2/analysis/compare`: the positioning gap vs. a comparable's audience
- `signal.demographics.*` on every call

Every request is validated against per-`filter.type` parameter allow-lists (Qloo silently drops unknown params), throttled, retried with backoff, budgeted, cached by normalized request, recordable as fixtures, and labeled live / replayed in the UI.

## Culture Miss Rate

Across 30 briefs (music, DTC, sports), the same model with no Qloo access produced **[X]%** picks that weren't in Qloo or fell below the audience's affinity bar; with the Qloo critic the shipped plans had **[Y]%**. Method, script and summary: `docs/benchmark.md`, `benchmark/summary.json`; blind LLM-judge preference in the same report. *(Fill only from a live run.)*

## Responsible taste

Aggregate-only: inputs are public catalog entities, tags and demographic buckets, never a person's data. Results are audience-level affinity. Every receipt names the Qloo calls behind its number, every Taste Map panel names its endpoint, and the trace shows every call's parameters.

## New-work disclosure

Sigmora (content production and publishing) pre-existed and is reached only through a narrow `/v1` API. All Qloo integration, the agent, the critic loop, the UI and the benchmark were built for this hackathon (planning from 2026-10-06, code from 2026-10-24). Details: `docs/new-work-disclosure.md`.

## Challenges we ran into

- **Qloo drops parameters it doesn't support, silently.** A misspelled or unsupported filter returns an empty or unfiltered result instead of an error. We built per-`filter.type` allow-lists from the docs (`src/lib/qloo/params.ts`) that reject an invalid request before it is sent, and contract tests that pin each call's shape (`tests/unit/qloo-contract.test.ts`).
- **Search always finds something.** A fuzzy `/search` hit for an invented name looks like a real entity. The critic only accepts a match whose normalized name agrees with the one the model wrote, so a hallucinated name is reported as "not found in Qloo" instead of being quietly swapped for a lookalike.
- **A circular pass bar.** The bar is drawn from the same Qloo pool the plan is grounded in, so we say so in the UI and keep a fixed floor under it.
- **A free public demo with a paid quota.** Every visitor runs a real agent, so Qloo calls are budgeted per run, per network and per day, presets and custom briefs draw from separate pools, and a refused run shows the last recorded run for that preset instead of a blank screen.

## Accomplishments that we're proud of

- Qloo isn't a lookup step bolted onto a chatbot. It decides what the agent may ship, and the agent can't publish a pick Qloo hasn't scored.
- The Without Qloo toggle makes the value visible on every run, not only in a benchmark.
- The whole product runs from a fresh clone with zero credentials (replay fixtures and a scripted model, each labelled on screen), so judges and contributors can try every path.
- Honest numbers: the demo never prints a number computed from simulated data, and no benchmark figure appears anywhere until a live run produces it.

## What we learned

- LLMs are confident about culture they've never measured. Most bad picks aren't invented; they're real names that the target audience simply doesn't care about, which only audience-level affinity data can catch.
- Explainability (`feature.explainability`) turns a score into something a marketer will trust: knowing *which* seed drove an affinity is what makes a receipt useful.
- Locality and heatmap data change the plan more than any other surface: where to launch is the decision a small brand gets wrong most often.

## What's next for Tastemaker

- Run the first real campaign planned by Tastemaker through Sigmora's publishing engine, and publish its reach next to the plan.
- Re-check live campaigns against `/v2/trending` and swap references that start fading.
- Offer the critic as a tool any agent can call (the repo already exposes it over MCP as `audit_plan`).

## Built with

nextjs, react, typescript, tailwindcss, zod, maplibre-gl, qloo, vitest, fast-check, playwright, model-context-protocol

## Try it out (links)

- Live demo: [URL]
- Repo (MIT): https://github.com/mlsniperpro/sigmora-tastemaker
- Video: [URL]
- Three one-click presets: indie single launch, DTC brand entering Atlanta, football club growing a US fan market.

## Video demo link

[URL] (≤ 2 minutes; YouTube or Vimeo, public or unlisted)

## Image gallery

Upload in this order (3:2 works best). Retake first with `pnpm screenshots <live demo URL>` once the Qloo and LLM keys are set, so the images show real Qloo data:

1. `docs/screenshots/desktop.png`: the hero run with the agent trace and the campaign pack.
2. `docs/screenshots/pack-without.png`: the Without Qloo view with its misses struck through.
3. `docs/screenshots/tastemap.png`: the Taste Map (where to launch, the culture map, rising vs. fading).
4. `docs/screenshots/mobile.png`: the same run on a phone.

## Before you press Submit

- [ ] Live demo URL opens with no login in a private window, and the hero preset runs.
- [ ] Repo is public and GitHub shows "MIT license" in About.
- [ ] Every [bracketed] item above is filled from a measured source or removed.
- [ ] The Culture Miss Rate section is removed unless `docs/benchmark.md` is a live measurement.
- [ ] Press **Submit**: a saved draft doesn't count.
