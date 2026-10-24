TESTED_COMMIT: 3b25d12

# Break-it log: Tastemaker

## Deep property runs

- `FC_NUM_RUNS=20000 vitest run --testTimeout=0` on 1d9175e: 241/241 passed (37 s).
- `FC_NUM_RUNS=100000` on 7256be0: **failed**, `normName("_fC")` not idempotent. Fixed at the root in 3b25d12; `FC_SEED=654543244 FC_NUM_RUNS=100000` now passes.
- `FC_NUM_RUNS=200000` on the median property: passes after the -0 fix.

## Soak (full suite repeated with fresh random seeds, 500 runs per property)

- 60 rounds on 1d9175e: round 8 **failed**, `median([0,-0,5e-324])` order-dependent. Fixed at the root in 7256be0; regression test added.
- On 7256be0: round 9 **failed**, the live-stub test's two requests straddled a one-minute rate-limit window. Fixed in 3b25d12 by pinning the clock just after a minute boundary.
- 150 rounds on 3b25d12: running (results recorded here when done).

## Failure injection (in the suite)

- Qloo 429 mid-run, then retried (`tests/e2e/stub-live.test.ts`); Qloo 500 on compare and trending (`agent.test.ts`); KV down (`cache.test.ts`, `counter-guard-config.test.ts`); LLM 401 and 529 (`agent.test.ts`); LLM revise failure; baseline draft failure (`agent.test.ts`); malformed judge output (`judge.test.ts`); a live run failing over to a recorded run (`recorded.test.ts`); malformed Sigmora replies (`requery.test.ts`, `api.test.ts`).

## Replay e2e

- `pnpm test:e2e` on 3b25d12: 6/6 passed (phone-390 and desktop-1440).

## Fresh-clone README run (on 1d9175e)

- `git clone` → `pnpm install --frozen-lockfile` → `pnpm test` 241/241 → `pnpm demo` → `pnpm dev`: `GET /` 200 in 0.12 s; `POST /api/run` streamed a result; MCP `taste_check` answered.
