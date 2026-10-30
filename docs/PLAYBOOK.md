# Tastemaker by Sigmora — Qloo Agentic Hackathon Winning Playbook

How Sigmora wins the Qloo Agentic Hackathon: the entry, the rules, the judges, the build, and the schedule.

Status: strategy source of truth (research complete 2026-10-06; build not started)

Competition: [Qloo Agentic Hackathon](https://qloo.devpost.com/) — "Agents, but with taste."

Prizes: **$15,000 / $6,000 / $4,000** (3 winners, no tracks, no bonus prizes)

Submission window: 2026-09-30 09:00 ET → **2026-10-30 23:45 ET = 2026-10-31 06:45 EAT**

Internal submission deadline: **2026-10-29 18:00 EAT** (ElevenCreative is due 11-01 and
the YouCam/MediQuest entry is due 11-02 — Qloo must be done and frozen before those crunch)

Judging: 2026-11-02 → 11-16 · Winners announced: **2026-11-23**

Entrant: individual Devpost account `aladroslab` (same posture as Creator Duty)

> This playbook is for the Qloo hackathon only. Do not copy the Google-Cloud
> architecture, Gemini-only model lock, or bonus-score tactics from the Creator
> Duty playbook (`products/COMPETITIONS/03_ACTIVE/all-things-agentic-2026/`) —
> the rules here are different. Sibling hackathon docs in this repo:
> `docs/audiotool/` (in the private platform repo).

---

## 0. The answer in one screen

1. **Enter Sigmora**, as a new public spin-off: **Tastemaker by Sigmora** — a
   marketing agent that plans a launch campaign for a creator or small brand
   and **checks every cultural choice against Qloo before it ships**.
2. **The idea that wins "Quality of the Idea":** LLM marketing agents *hallucinate
   culture*. They confidently pick artists, shows, brands, places, and references
   an audience doesn't actually love. Tastemaker uses Qloo **as the critic inside
   the agent loop, not just a recommender**: the LLM proposes, Qloo scores
   (`filter.results.entities` + `feature.explainability`), low-affinity picks get
   cut, and every surviving choice carries a **receipt**.
3. **The proof that wins "would it work without Qloo?":** a built-in
   **"Without Qloo" toggle** showing the plain-LLM plan next to the grounded plan,
   with the LLM's misses highlighted, plus a published **Culture Miss Rate
   benchmark** across 30 briefs.
4. **The depth that wins "Technological Implementation"** (Qloo's CTO screens this):
   use 8 Qloo surfaces most entrants never touch — explainability, `analysis/compare`,
   `urn:heatmap` with locality boundary, `urn:demographics`, `/v2/trending`,
   cross-domain insights, `/entities` external-ID crosswalk (paste a Spotify link),
   and shortlist ranking.
5. **The thing nobody else can show:** Sigmora closes the loop. The plan doesn't
   stop at a report — it becomes **produced assets** (hooks, scripts, captions per
   platform, a music brief, a presenter match) and can be **scheduled into real
   channels**, then **measured**, then **re-queried**. Competitors stop at
   "audience report + pitch."
6. **Hero customer:** an **independent musician launching a release** (lands with
   Live Nation's Abrams, Cedric, Calacanis), with two more one-click presets
   proving it generalizes: a **DTC brand entering a new city** (Qloo's core
   revenue) and a **sports club growing a new fan market** (Boehly).
7. **Do today:** register on Devpost, request the API key (it takes "a few
   business days"), join the Discord. Build against fixtures until the key lands.

### One-sentence pitch

**Every marketing agent guesses the culture. Tastemaker checks it — then ships
the campaign.**

### Judge memory sentence

**"Don't guess the culture. Query it."**

### What this is not

- Not a recommender ("you liked X, try Y") — that lane lost last year.
- Not a travel / trip / date-night planner — that lane is already crowded this
  year (TasteLoop, Home2Here, Taste Trail, TasteRoute).
- Not a chat wrapper around `/v2/insights`.
- Not "audience report + marketing pitch" — Resonance AI (2025 HM), NoBanks Taste
  Match, Quorum and Taste Brief already occupy that; we must go past the report.
- Not the pre-existing Sigmora product renamed.
- Not a claim about any individual person (Qloo data is aggregate affinity).

---

## 1. Rule lock (rechecked 2026-10-06)

Source: [rules](https://qloo.devpost.com/rules), [overview](https://qloo.devpost.com/),
[resources](https://qloo.devpost.com/resources),
[developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide).

### Stage One — pass/fail screen (Qloo staff, before the celebrity panel)

Last year the manager "narrowed down the final list to be sent to the ultimate
judges" ([forum](https://qloo-hackathon.devpost.com/forum_topics/41653-winners-announcements)).
**Qloo staff — very likely CTO Mike Diolosa's team — decide what the celebrities ever
see.** Optimize the first 60 seconds for a technical Qloo reviewer.

- [ ] Working software that integrates the Qloo API and is agentic (agentic tool,
      agent framework, or Qloo wired into an existing agent). **We do all three.**
- [ ] Externally hosted, fully published demo. No login wall, no private access,
      no "run locally".
- [ ] Public GitHub repo with all source, assets, and run instructions.
- [ ] Open-source LICENSE **visible in the repo About sidebar** (GitHub detects it
      only if the file is `LICENSE` at the root with standard text).
- [ ] Text description: what the agent does and what makes it "Qloo-powered".
- [ ] Pre-existing project rule: allowed **only if Qloo was integrated after
      2026-09-30**, and we must explain the significant updates. Verified
      2026-10-06: there is **zero Qloo code anywhere in this repo**, so
      every Qloo line is new work by construction.
- [ ] Free, unrestricted access for testing through the end of judging
      (**keep it live and funded until at least 2026-11-23**).
- [ ] Kenya is eligible (Brazil and Quebec are excluded).

### Stage Two — four equally weighted criteria

| Criterion (verbatim gist) | Who mostly drives it | What we show |
|---|---|---|
| **Technological Implementation** — how thoroughly and skillfully does it use Qloo; non-trivial working code | Diolosa / Qloo staff | 8 Qloo surfaces, a live agent trace naming each endpoint, explainability receipts, param validation, caching, fixture replay |
| **Design** — complete, coherent product, not a proof of concept | All judges | One screen: brief → live trace → Taste Map → content pack with receipts → "Without Qloo" diff → Ship |
| **Potential Impact** — credible, specific problem for a real audience, and the demo actually solves it | Calacanis, Boehly, Abrams | Named wedge customer (indie artist launch), cost/time math, Culture Miss Rate benchmark, real dogfood campaign |
| **Quality of the Idea** — creative, non-obvious use of Qloo; real grasp of the problem space | Diolosa, Seligman, Cedric | Qloo as the *critic* in the agent loop; generate-then-verify; LLM culture hallucination as the named problem |

Tie-break order: Tech → Design → Impact → Idea, then a judges' vote. **Tech is the
first tie-breaker. Do not trade depth for polish.**

### Multiple entries

Allowed if "unique and substantially different". **Recommendation: one entry.**
Bandwidth is the binding constraint (two other deadlines on 11-01 and 11-02).

### Demo video

Not required ("we're requiring something judges can actually use"). **Ship a
≤2-minute video anyway** in the README and the Devpost gallery: six celebrity
judges will watch 2 minutes before they click into an app.

---

## 2. What we learned about winning

### Last year's Qloo hackathon (2025, 2,847 participants, 344 projects)

| Prize | Project | Pattern |
|---|---|---|
| Grand | [GeoTaste](https://devpost.com/software/geotaste-your-agentic-qloo-taste-business-consultant) — agentic location business consultant | B2B, Qloo's own locality pitch, heavy visual output (Mapbox + 13 chart types), felt like an enterprise product |
| HM | [Resonance AI](https://devpost.com/software/resonance-ai-1hjbf0) — voter cultural profiles → campaign messaging | Audience → creative: exactly Qloo's ad/marketing revenue line; multi-agent |
| HM | [Zesty](https://devpost.com/software/zesty) — "Unrecommendation Engine" | Only consumer winner; won on an *inverted* idea, not on recommending well |
| HM | [Alloy](https://devpost.com/software/axiom-2bn391) — cultural compatibility for M&A diligence | High-stakes B2B, explicit ROI line ("$500k, 4–6 weeks → 6 minutes"), ReAct agent |

**Rules we take from this:**

1. **3 of 4 winners were B2B decision tools that turned taste into a business
   deliverable with a number attached.** Our deliverable: a launch campaign plus
   its Culture Miss Rate and an explicit cost/time saving.
2. **Plain consumer recommenders lost.** The consumer winner won by inverting the
   premise. Our inversion: Qloo isn't recommending to the user; it's **auditing
   the AI**.
3. **Visual weight matters.** GeoTaste won with maps and charts. We ship a Taste
   Map (heatmap + demographics + affinity graph), not a wall of text.
4. **Every winner stated an ROI line.** Ours (see §6) must be on the first screen.

### This year's field (public repos already tagged for this hackathon)

- Crowded: trip and day planners (TasteLoop, Home2Here, Taste Trail, TasteRoute).
- **Adjacent to us:** NoBanks "Taste Match" (audience-finding agent + marketing
  pitches for indie artists), Headliner (tour booking for indie artists),
  Quorum (synthetic focus group with cited affinities), Taste Brief, House
  Programme, AffinityQA.
- Emerging norm: **"every claim cited / receipts."** Receipts alone are now
  baseline. **Our edge over them:** (a) the generate-then-verify critic loop with a
  measured miss rate, (b) the "Without Qloo" diff as a product feature,
  (c) the plan becomes produced, schedulable assets, then is measured and
  re-queried. Nobody else owns a production + publishing engine.

### What the sponsor actually sells (and therefore wants showcased)

Qloo is a B2B API: Cultural Data Enrichment, Taste Intelligence, Locality
Intelligence, and **"AI & Agent Grounding"**. Customers: Netflix, Michelin,
Samsung, Match Group, JCDecaux, PepsiCo, Starbucks, Live Nation, AmEx,
Ticketmaster. The money is **audience insight for marketing and ads, media
personalization, and site selection.** Gartner (2026-09-15) named Qloo a front
runner in *synthetic population and behavioral simulation* — "taste intelligence
is becoming the core infrastructure for consumer AI."

**Narratives Qloo will want to amplify (we hit all four):**

1. Qloo as the grounding layer *any* agent calls, including over MCP.
2. Simulate the audience before spending money.
3. Measurable outcomes for marketers.
4. Privacy-safe, aggregate-only data.

### The panel, judge by judge

| Judge | What they reward | Tastemaker hook |
|---|---|---|
| **Mike Diolosa** (Qloo CTO) — likely Stage One gatekeeper | Deep, correct use of many endpoints; visible proof the agent beats a plain LLM; no thin wrappers | Trace panel naming each endpoint and parameter; explainability receipts; benchmark |
| **Jason Calacanis** | A founder who states the exact problem, moves fast, has lived experience, has a business | "I run a 23-product studio from Nairobi and my own agents kept picking culture my audience didn't care about." Pricing line, dogfood numbers |
| **Todd Boehly** (Eldridge — a Qloo investor; Chelsea, Dodgers) | Sports, media, fan engagement, sponsorship | One-click **sports club new-market** preset; brand-partner suggestions with affinity |
| **Michael Abrams** (Live Nation EVP; ex-Disney innovation) | Selling tickets: artist/fan/city demand, promotion | **Indie release + "where to play first"** heatmap of city demand |
| **Nicole Seligman** (OpenAI board; ex-Sony GC) | Governance, privacy, honest claims | Short "Responsible taste" panel: aggregate-only, no PII sent, claims discipline, every number sourced |
| **Cedric the Entertainer** (2012 Qloo seed investor; comedian/producer) | Creators keeping an authentic voice; easy to grasp, fun | Hero demo is a creator; the "Without Qloo" reveal is the laugh line ("the AI thought your fans love…") |

---

## 3. The product: Tastemaker by Sigmora

### Hero scenario (the 2-minute story)

> An independent Afro-fusion artist is dropping a single and wants to play a first
> show outside their home city. They paste a Spotify link and type: "Launch my
> single to 25–34-year-olds; pick the first city to play."

1. **Resolve.** `/entities` with `external.spotify.ids` → the artist's Qloo entity
   (fallback: `/search`). Seeds the taste signal from a real catalog ID, not a
   string.
2. **Profile the audience.** `urn:demographics` on the seed → which age and gender
   buckets over-index (signed affinity). `urn:tag` taste analysis → the vocabulary
   this audience's taste is described in (feeds copy).
3. **Map the culture, cross-domain.** `/v2/insights` with the seed signal plus
   `signal.demographics.age=25_to_29,30_to_34`, output types: artist (collab and
   playlist adjacency), brand (sponsor and merch partners), tv_show and movie
   (reference material for hooks), podcast (where to pitch an interview), place
   (venue character). `diversify.by` to avoid five near-identical picks.
4. **Find the city.** `urn:heatmap` with `output.heatmap.boundary=urn:entity:locality`
   across candidate metros → ranked "where to play first" plus where to geo-target
   paid posts. `filter.location` + place output → venue shortlist in the winner.
5. **Time it.** `/v2/trending` on the top references → keep the ones *rising*
   (velocity), drop the ones peaking out. Hooks referencing a fading show lose.
6. **Generate, then verify (the core loop).** The LLM drafts the campaign: hooks,
   a 30-second script, per-platform captions, a music/visual brief, a presenter
   match, collab targets. **Every cultural entity it mentions is extracted and
   re-scored by Qloo** (`filter.results.entities` with `feature.explainability=true`)
   against the audience signal. Below threshold → cut and regenerated with the
   Qloo-preferred alternative. Unresolvable entity → flagged as an LLM
   hallucination. Loop until the plan passes or the budget is spent.
7. **Compare.** `/v2/analysis/compare`: this artist's audience vs. the audience of
   the artist they asked to be compared to (or vs. the target city's baseline) →
   "what your fans love that theirs don't" = the positioning line.
8. **Receipts.** Every surviving pick shows a chip: affinity score, which input
   drove it (explainability), trend direction, and the Qloo call that produced it.
9. **Without Qloo.** One toggle shows the plan the same LLM produced with no Qloo
   access, with its misses struck through and annotated ("Qloo affinity for this
   audience: 0.12 — bottom decile").
10. **Ship (Sigmora).** "Schedule this campaign" hands the asset pack to Sigmora
    through a narrow `/v1` interface: rendered promo, captions per channel,
    schedule. On the public demo this runs against a **labeled sandbox publisher**;
    a real run is shown in the video from our own channels.
11. **Measure and re-query (P1).** Sigmora's `track` step pulls post performance;
    winners become new Qloo signals (`signal.interests.entities`) for the next
    iteration. This closes the loop no other entrant has.

### The two extra presets (one click, cached, instant)

| Preset | Qloo emphasis | Judge |
|---|---|---|
| **DTC brand → new city** (e.g. a skincare brand entering Atlanta) | brand + place outputs, heatmap neighborhoods, `filter.price_level`, compare vs. competitor brand audience | Qloo's revenue line, Calacanis |
| **Sports club → new fan market** (e.g. a football club growing in a US metro) | cross-domain artist/brand/tv for matchday content and sponsor fit, heatmap for watch-party venues | Boehly |

Presets are **US-first on purpose**: hackathon data coverage for Kenya/Nairobi is
undocumented ("may not have data for every entity or region"). See §8 for the
Nairobi probe; add a Nairobi preset only if the probe passes.

### Why it cannot work without Qloo (state this verbatim in the submission)

- The critic step *is* a Qloo call. Remove Qloo and the agent has no way to reject
  a culturally wrong pick, so the miss rate reverts to the LLM baseline (measured).
- City choice, demographic over-indexing, rising-vs-fading references, and
  audience-vs-audience gaps are measured data an LLM cannot produce from
  pretraining.
- The "Without Qloo" toggle demonstrates this live, on every run.

---

## 4. Qloo depth map (Technological Implementation)

Target: **8+ distinct Qloo surfaces, each doing a job the product needs.** The trace
panel shows each one as it fires.

| # | Qloo surface | Job in Tastemaker | Rarity among entrants |
|---|---|---|---|
| 1 | `GET /entities` (`external.spotify.ids`, `imdb`, …) | Seed from a pasted Spotify or IMDb link | Rare |
| 2 | `GET /search` | Resolve names; detect LLM-hallucinated entities (404 = not real) | Common |
| 3 | `GET /v2/insights`, cross-domain types | Culture map: artists, brands, shows, podcasts, places | Common (shallow); deep with signals |
| 4 | `filter.results.entities` + `feature.explainability=true` | **The critic**: score the LLM's shortlist, attribute why | Very rare |
| 5 | `filter.type=urn:demographics` | Who the audience is (signed over-index) | Rare |
| 6 | `filter.type=urn:tag` (taste analysis) | Copy vocabulary grounded in the audience's taste descriptors | Rare |
| 7 | `filter.type=urn:heatmap` + `output.heatmap.boundary=urn:entity:locality` | Where to launch, tour, pop up, geo-target | Rare |
| 8 | `GET /v2/trending` | Rising vs. fading references (timing) | Rare |
| 9 | `GET /v2/analysis/compare` | Positioning gap vs. a comparable audience | Very rare |
| 10 | `GET /v2/tags` (`feature.semantic_search=true`) | Map the user's free-text brief to real tag IDs | Uncommon |
| 11 | `signal.demographics.age/gender`, `signal.location`, `bias.trends`, `diversify.by` | Condition every call on the target audience | Usually skipped |

### Engineering rules for the Qloo client (from the docs and other entrants' pain)

- Base URL `https://hackathon.api.qloo.com`, header `X-Api-Key`. **Production and
  staging hosts reject hackathon keys** (every doc example uses them; swap the host).
- `/v2/insights` is **GET with query params**.
- **Unsupported params are silently dropped → 200 with empty results.** Ship a typed
  client that validates parameter names per `filter.type` against
  [available-parameters-by-entity-type](https://docs.qloo.com/reference/available-parameters-by-entity-type)
  and fails loudly in dev. This bug class will otherwise eat days.
- Units differ: `/search` radius is **miles**; insights radius is **metres**. WKT is
  **longitude first**; the `filter.location` string form is `lat,lon`.
- `destination` requires `signal.interests.entities`. `video_game` vs `videogame` —
  test both.
- `/v2/audiences` is marked deprecated but still needed for audience IDs — don't
  build the hero on it.
- **Cache every Qloo response** (key = normalized request) in KV/Redis with a long
  TTL, and ship a **record/replay fixture mode** so the demo survives a rate limit,
  a key outage, or the judging-period traffic spike. Label replayed results as
  replayed in the UI (claims discipline).
- Never put the key in the browser. All Qloo calls go server-side.
- Official MCP harness `@qloo/qloo-harness`: stdio only, not serverless, and
  defaults to `api.qloo.com` (needs `QLOO_BASE_URL` and `QLOO_TRUSTED_BASE_URL`
  set to the hackathon host). **Use our own REST client in the product.** P1: also
  expose Tastemaker's tools as an MCP server (Sigmora already serves
  `api.sigmora.org/mcp`) so any agent — Claude, ChatGPT — can call "taste-check
  this campaign". That hits Qloo's "grounding layer for every agent" narrative.

---

## 5. Architecture and the new-project boundary

### Public spin-off repo (the submission)

Follow the proven Creator Duty / live-relay pattern.

- Repo: `mlsniperpro/sigmora-tastemaker` (public). **MIT** `LICENSE` at the root
  (so GitHub shows it in About) + `NOTICE.md` carving out the Sigmora brand and the
  proprietary platform.
- Stack: Next.js app (scaffold with the official `create-next-app`, not by hand),
  TypeScript, Vercel AI SDK tool-loop agent (same family Sigma already uses in
  `apps/web/src/lib/sigma/turn.ts`), zod-typed Qloo client, KV cache. **Model-
  swappable** (provider/model from env; unknown provider = OpenAI-compatible) — never
  pin a vendor.
- Providers, each with a deterministic implementation so the repo runs with **zero
  credentials**: `QlooProvider` (live | replay fixtures), `LLMProvider` (live |
  deterministic), `PublisherProvider` (Sigmora `/v1` | labeled sandbox).
- Hosting: a Sigmora subdomain, e.g. `tastemaker.sigmora.org` (the competition
  doubles as a Sigmora launch). Vercel is fine for REST-only Qloo calls. Follow the
  new-Vercel-project procedure: repo + push first, then `vercel link` + git connect,
  env vars before the first build; deploy by `git push` only.
- Abuse and budget guard: per-IP rate limit, daily run cap, cached presets that
  render instantly without spending anything.

### "Wired into an agent we already have" (proof of the third qualifying path)

Inside the private `sigmora-platform` repo — shown in the video and described in the
new-work disclosure, not required to run the public demo:

- New `taste_research` step for the Marketing agent
  (`services/content-autopilot/src/services/agent-orchestrator/marketing-steps.ts`,
  next to `trendResearchStep` ~L391), writing `ctx.outputs.tasteBrief`, injected into
  `repurposeStep` alongside the existing BRAND VOICE / CAMPAIGN STRATEGY / LIVE TREND
  RESEARCH / PAST PERFORMANCE preambles (~L516).
- Audience signal resolved in `buildAgentRunConfig` (`apps/web/src/lib/agents.ts`
  ~L2130) from the existing `audience-markets.ts` market + age group.
- Qloo-backed **taste critic** added beside `scoreAttention` (~L465): a draft that
  fails the culture check gets one rewrite, the same way a draft below the
  attention bar does.
- `taste_profile` tool for the Sigma chat agent (`apps/web/src/lib/sigma/capabilities.ts`)
  and MCP.
- Song Starter's hand-typed audience profile (`apps/web/src/lib/contracts/songstarter.ts`
  L10–19: `primaryAgeGroup`, `primaryCountry`, `topInterests[]`) filled from Qloo
  demographics instead of typing — this connects to the Audiotool entry's promise
  to tell artists what to make "from their real audience".

The public repo calls Sigmora only through narrow HTTPS `/v1` endpoints with a bearer
token the model never sees (same boundary as Creator Duty).

### Required repo docs (copy the Creator Duty set)

- `README.md` — first screen: tagline, live demo link, video, **disclosure line**,
  the ROI line, "Try it in 10 seconds" (click a preset).
- `docs/judging.md` — what to remember, the 3-click judge path, the Qloo surface
  table with where each fires.
- `docs/new-work-disclosure.md` — start date 2026-10-06; Qloo integration is 100%
  new; what pre-existed in Sigmora; claims discipline.
- `docs/benchmark.md` — Culture Miss Rate method and results (§6).
- `docs/responsible-taste.md` — aggregate-only, no PII, Qloo safe-use framing.
- `docs/evidence-status.md` — claim / do-not-claim table.
- `SUBMISSION.md` — paste-ready Devpost text.

---

## 6. Proof: benchmark, ROI line, dogfood

### Culture Miss Rate benchmark (the number on the first screen)

- 30 briefs across music, DTC, sports, food, creators (10 per preset family).
- For each brief, run the **same model** twice: LLM-only vs. Tastemaker.
- Extract every cultural entity each plan names.
- Metrics:
  - **Hallucination rate:** entities that don't resolve in Qloo `/search` / `/entities`.
  - **Culture Miss Rate:** resolved entities scoring below the audience's
    affinity threshold (e.g. bottom 30% of `filter.results.entities` ranking for that
    audience signal).
  - **Fading-reference rate:** references with negative trending velocity.
  - Blind pairwise preference (LLM judge with a fixed rubric; disclose that it's an
    LLM judge).
- Publish the script, raw outputs, and numbers in the repo. **Claim only what the
  run measures.** If the LLM baseline turns out decent, report it honestly and lead
  with the hallucination and fading metrics instead.

### ROI line (draft; replace with measured numbers)

"An audience-research brief from an agency costs weeks and thousands of dollars.
Tastemaker produces a verified launch plan — audience, city, references, assets,
schedule — in about two minutes, and shows you which of the AI's picks were wrong."
Do not print a dollar figure unless sourced.

### Dogfood (Calacanis wants traction, not a mockup)

Run Tastemaker for one real launch of our own before submission — e.g. an
AlgoCracked / SkillSaber X post series or an ElevenReader title — through real
Sigmora scheduling. Report reach/engagement **only if measured**, labeled as one
small real campaign, not a controlled study.

### Responsible-taste panel (for Seligman and Qloo)

- Inputs are public catalog entities, tags, and demographic *buckets* — never a
  person's data.
- Results are audience-level affinity, never "this user likes X".
- Every number in the UI links to the Qloo call that produced it.
- Replayed (cached) results are labeled.

---

## 7. Design spec (one coherent product, not a dashboard of JSON)

One page, mobile-safe (390px, no horizontal scroll):

1. **Brief bar:** paste a Spotify/IMDb link or a brand name + audience chips (age,
   city) + goal. Three preset buttons under it.
2. **Agent trace (left rail, live):** each step with the Qloo endpoint and key params,
   status, and latency. Collapsible. This is what the Qloo reviewer reads.
3. **Taste Map (center):** demographic over-index bars, the city heatmap
   (map tiles), and a cross-domain affinity web (artist ↔ brand ↔ show ↔ place).
4. **Campaign pack (right):** hook cards, script, per-platform captions, music
   brief, presenter match, collab and sponsor targets — **each with receipt chips.**
5. **"Without Qloo" toggle (top):** flips the pack to the LLM-only version with
   misses struck through and annotated.
6. **Ship bar (bottom):** "Schedule with Sigmora" → sandbox receipts on the public
   demo.
7. **Permalinks:** every run gets a shareable URL so judges can open a finished,
   pre-run example in one click.

Use Sigmora's brand system (`packages/brand`), dark theme, real data only — no
placeholder numbers anywhere (no real data ⇒ show none).

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **API key takes days** | Request it **today**. Build against fixtures that follow the documented response shapes; swap to live as soon as it lands. If it hasn't arrived by 10-10, resubmit the form and ask in Discord `#api-help`. |
| Silent empty results from bad params | Typed, validated client; a dev-mode assertion on empty results for the hero presets |
| Rate limits during judging (unpublished) | KV cache, replay fixtures, cached presets, per-IP caps |
| Kenya/Nairobi coverage unknown | Day-1 probes: `/search?query=Nairobi&types=urn:entity:locality`; insights `place` + `filter.location.query=Nairobi`; heatmap Nairobi. Pass → add a Nairobi preset and the "built from Nairobi" founder story. Fail → keep the story, keep the presets US. |
| Crowded "audience + pitch" lane | Lead with the critic loop + miss-rate number + Ship. Never describe Tastemaker as "an audience research tool". |
| Stage One screener misreads it as a wrapper | First 60 seconds of the README and demo = the trace panel + "Without Qloo" diff |
| Bandwidth (ElevenCreative 11-01, YouCam 11-02) | Feature cutoff ladder (§9); internal deadline 10-29; no second Qloo entry |
| Vercel deploy quota (Hobby = 100/day team-wide) | Batch pushes; don't push-to-test |
| LLM cost from public traffic | Daily cap; presets served from cache |
| Overclaiming | `evidence-status.md` claim/do-not-claim table; no unmeasured lift numbers |

---

## 9. Feature cutoff ladder

### P0 — the submission cannot ship without these

- [ ] Typed Qloo client (live + replay), cache, param validation
- [ ] Agent loop: resolve → demographics → cross-domain insights → generate →
      **Qloo critic (rank + explainability)** → pack
- [ ] Receipts on every cultural pick
- [ ] "Without Qloo" toggle
- [ ] Hero preset (indie release) end-to-end on the hosted demo, no login
- [ ] Public repo, MIT LICENSE showing in About, README, disclosure, SUBMISSION.md
- [ ] Hosted at a public URL, rate-limited

### P1 — high-value differentiation

- [ ] Heatmap "where to launch" + map UI
- [ ] Trending timing filter
- [ ] `analysis/compare` positioning gap
- [ ] Spotify/IMDb link seeding via `/entities`
- [ ] DTC + sports presets
- [ ] Culture Miss Rate benchmark published
- [ ] Ship to Sigmora (sandbox publisher on the public demo; real run in the video)
- [ ] `taste_research` step + taste critic inside this repo's Marketing agent
- [ ] ≤2-minute video

### P2 — cut immediately if P0 is at risk

- [ ] MCP server exposing Tastemaker tools
- [ ] Measure → re-query loop from real post performance
- [ ] Nairobi preset (only if the probe passes)
- [ ] Song Starter audience autofill
- [ ] Dogfood campaign metrics

---

## 10. Schedule (EAT)

| Dates | Goal | Exit check |
|---|---|---|
| **Oct 6** (today) | Register on Devpost, request the key ([form](https://forms.gle/zz12orkLHTAneLGz6)), join [Discord](https://discord.gg/rF9PKsD5Q7), read [qloo-hackathon-kit](https://github.com/qloo/qloo-hackathon-kit) | Key requested |
| Oct 7–10 | Public repo scaffold (official CLI), LICENSE, typed Qloo client against fixtures, agent loop skeleton, deterministic providers | `pnpm test` + fixture demo run end-to-end |
| Key arrives (~Oct 9–13) | Nairobi probes, live smoke of all 11 surfaces, record fixtures for presets | Every surface returns non-empty for the hero preset |
| Oct 11–17 | Critic loop + explainability receipts, "Without Qloo" diff, Taste Map UI, hero preset on the hosted URL | Hosted hero preset works for a stranger with no login |
| Oct 18–22 | Heatmap, trending, compare, Spotify seeding, 2 more presets, Sigmora `/v1` ship (sandbox), `taste_research` step in this repo | All P1 surfaces visible in the trace |
| Oct 23–25 | Benchmark run + `docs/benchmark.md`; dogfood campaign live | Miss-rate number on the README first screen |
| Oct 26–27 | Design polish at 390px and desktop, permalinks, rate limits, video, SUBMISSION.md | Fresh-browser judge path under 3 clicks |
| **Oct 28** | **Submit on Devpost** (editable until the deadline) | Submission shows "submitted" |
| Oct 29 18:00 | Internal freeze. Only fixes after this. | — |
| Oct 31 06:45 | Hard deadline | — |
| Nov 2–23 | Keep demo live, key valid, cache warm; watch the error rate | No downtime during judging |

---

## 11. Submission copy (draft — finalize after the benchmark)

**Title:** Tastemaker by Sigmora

**Tagline:** Every marketing agent guesses the culture. Tastemaker checks it.

**Description skeleton:**

1. *The problem* — AI marketing agents confidently pick references, collaborators,
   cities, and sounds their audience doesn't love. We measured it: **[X]%** of an
   LLM-only plan's cultural picks were hallucinated or bottom-tier for the target
   audience.
2. *What Tastemaker does* — plans a launch campaign and uses Qloo as the critic
   inside the agent loop: the LLM proposes, Qloo scores, low-affinity picks are
   replaced, and every surviving choice carries a receipt.
3. *What makes it Qloo-powered* — the 8+ surface table, one line each.
4. *Without Qloo* — the toggle, and the benchmark.
5. *Ship it* — the plan becomes produced assets scheduled through Sigmora.
6. *Responsible taste* — aggregate-only, no PII.
7. *New work disclosure* — Sigmora pre-existed; all Qloo integration, the agent, the
   critic loop, the UI, and the benchmark were built from 2026-10-06.
8. *Try it* — live URL, three presets, repo, video.

---

## 12. Sources

- Hackathon: [overview](https://qloo.devpost.com/), [rules](https://qloo.devpost.com/rules),
  [resources](https://qloo.devpost.com/resources), [kit](https://github.com/qloo/qloo-hackathon-kit)
- API: [hackathon guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide),
  [insights deep dive](https://docs.qloo.com/reference/insights-api-deep-dive),
  [parameters](https://docs.qloo.com/reference/parameters),
  [params by entity type](https://docs.qloo.com/reference/available-parameters-by-entity-type),
  [demographics](https://docs.qloo.com/reference/demographics-use-case),
  [heatmaps](https://docs.qloo.com/reference/heatmaps-use-case),
  [taste analysis](https://docs.qloo.com/reference/taste-analysis),
  [trending](https://docs.qloo.com/reference/get-trending),
  [compare](https://docs.qloo.com/reference/analysis-compare),
  [entities](https://docs.qloo.com/reference/get-entities),
  [harness on npm](https://registry.npmjs.org/@qloo/qloo-harness)
- 2025 winners: [gallery](https://qloo-hackathon.devpost.com/project-gallery),
  [GeoTaste](https://devpost.com/software/geotaste-your-agentic-qloo-taste-business-consultant),
  [Resonance AI](https://devpost.com/software/resonance-ai-1hjbf0),
  [Zesty](https://devpost.com/software/zesty), [Alloy](https://devpost.com/software/axiom-2bn391)
- Field: [NoBanks/qloo-mcp](https://github.com/NoBanks/qloo-mcp),
  [Headliner](https://github.com/StarKnightt/headliner),
  [Quorum](https://github.com/AkshayJohn03/Quorum),
  [Taste Brief](https://github.com/ShenJun93/taste-brief),
  [House Programme](https://github.com/yy5652-hash/house-programme)
- Qloo business: [homepage](https://www.qloo.com/),
  [Series C](https://www.adexchanger.com/ai/qloo-snags-25-million-in-series-c-funding-to-unravel-the-mystery-of-consumer-tastes/),
  [Gartner 2026](https://www.prnewswire.com/news-releases/qloo-recognized-in-the-set-diamonds-category-in-the-2026-gartner-emerging-tech-ai-to-watch-in-synthetic-popular-simulation-research-302878163.html),
  [Cedric seed](https://www.crainsnewyork.com/article/20131114/TECHNOLOGY/131119933/cedric-the-entertainer-backs-startup-qloo)
- Internal (private platform repo, not linked here): the autonomous agents spec,
  the Audiotool submission, the
  `sigmora-creator-duty` repo's `docs/` (spin-off template), and
  `products/COMPETITIONS/03_ACTIVE/all-things-agentic-2026/SIGMORA-TASKMASTER-WINNING-PLAYBOOK.md`
