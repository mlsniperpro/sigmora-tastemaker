TESTED_COMMIT: 14cb06b

# Break-it log: Tastemaker

Every run below is on the code at `TESTED_COMMIT` (14cb06b; the commits after it touch only Markdown and `.agent/`), in its own git worktree so no edit can land mid-run.

## Deep property runs

- `FC_NUM_RUNS=100000 pnpm exec vitest run --testTimeout=0` on 14cb06b: 36 files, 533/533 passed (466a68a: 525/525; every audited commit since passed too).
- Earlier finds, all fixed at the root with a regression test:
  - b5cd475: `isTitlePart` rejected a whole subtitle containing "with" (counterexample `["aa","aa"]`, `["aa","with","aa"]`, seed -2001805414); fixed in 5268c3e, the seed now passes.
  - 7256be0: `normName("_fC")` not idempotent; 1d9175e: `median([0,-0,5e-324])` order-dependent (both earlier sessions).

## Soak (full suite with fresh random seeds, `FC_NUM_RUNS=500 FC_SEED=<random>`)

- 14cb06b: 40/40 rounds passed.
- Since 466a68a (60/60): 96cd706, 48f84b6, 84c34d1 40/40 each; soaks on 4e908c4, d506412 and 43c3d54 were stopped by container restarts or superseded by a fix.
- Earlier this session: 295b64a 39/39, ee1540b 40/40, 153d2ea 40/40, fd60092 40/40, 506cea1 40/40, b5cd475 40/40; 8c6f8f4 34/40, the 6 failures being tests edited mid-run in the main checkout, after which soaks moved to their own worktree.

## Failure injection (in the suite, run on every round)

- Qloo: 429 then retried, 500 on optional surfaces, the nationwide heatmap failing (cities rank nothing and say why), a heatmap whose cells lie elsewhere, the location filter failing for a city, budget and deadline cuts mid-critic, a malformed reply (`QlooSchemaError`, hidden from visitors), a live failure falling back to a recording.
- Model: 401/529, a reply that isn't the provider's JSON (HTML gateway page, wrong shape), choice and polish failures, baseline draft failure.
- KV: half a pair, missing on a hosted paid deploy (build fails), outage (budget fails closed).
- Owner: a shared `?b=` brief, a cache hit and a join never become the owner's run; tests verified to fail without each fix.
- Recordings: a filled recording passes the committed-recordings test, a stale key (one extra param), an empty heatmap and an unranked city each fail it; `pnpm fixtures:record` against a fake Qloo leaves the committed file unchanged when a heatmap call fails (exit 1), and documented `{ lat, lng }` / swapped locality coordinates still rank (0 metros before the fix, 11 after).
- Health: a rejected nationwide heatmap or an empty fixed-market heatmap (step still "done") is never cached as healthy (fails without the fix).
- Credentials: `pnpm test` passes with `QLOO_API_KEY`, `LLM_*` and `KV_*` exported (tests clear them); the e2e server blanks every credential.

## Replay e2e

- `pnpm test:e2e` on 14cb06b: 40/40 passed, phone-390 and desktop-1440, including the tile-map stall fallback, the refused clipboard, `?b=` / `?measure=` waiting for a click, the unreadable `?b=` notice and the branded 404.

## Fresh-clone README run (14cb06b)

- `pnpm install` → `pnpm demo` for the three presets: 75 / 60 / 75 Qloo calls → `pnpm test` 533/533 → `pnpm benchmark`: "NOT A MEASUREMENT" → `next build` + `next start`: `GET /` 200, `/nope` 404, `POST /api/run` streams. (466a68a, cloned from GitHub, also checked the items below.)
- `pnpm build` compiles; `next start`: `GET /` 200, `/nope` 404 (branded), `/docs/judging.md` 307 to the repo, `POST /api/run` streams 32 events, MCP lists `taste_check`, `audit_plan`, `plan_campaign`.
- Production in Chromium (MapLibre style stubbed): the tile map draws at 390 and 1440 px; three cold loads at each width with no console errors.

## Load

- `pnpm bench:latency`: the hero preset's 75 Qloo calls at 300 ms each under the 4/s throttle take 15.1 s.
- `pnpm audit --prod`: no known vulnerabilities (maplibre-gl 6.4.1).
