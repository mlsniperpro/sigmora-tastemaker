#!/usr/bin/env bash
# Every check for Tastemaker, as a contributor or CI would run it. No credentials needed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
# Property tests at a higher example count than the default 100.
FC_NUM_RUNS=5000 pnpm exec vitest run --testTimeout=0
# The judge path in a real browser, replay mode, phone and desktop.
pnpm test:e2e
pnpm build
