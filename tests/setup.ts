/**
 * Property-test depth. The default (100 runs) keeps `pnpm test` fast; the deep
 * run (`pnpm test:deep`) sets FC_NUM_RUNS high and is left going for hours.
 * FC_SEED reproduces a failure the deep run printed.
 */
import { fc } from "@fast-check/vitest";

const runs = Number(process.env.FC_NUM_RUNS ?? "");
const seed = Number(process.env.FC_SEED ?? "");
fc.configureGlobal({
  ...(Number.isInteger(runs) && runs > 0 ? { numRuns: runs } : {}),
  ...(Number.isInteger(seed) && process.env.FC_SEED ? { seed } : {}),
});
