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

// Tests run on the offline stack whatever the shell exports: an exported Qloo, model or KV credential (say, after
// `vercel env pull`) must never make a test spend live quota or write to the production store. Tests that need a
// variable stub it themselves.
import { EnvSchema } from "@/lib/config";

// Removed once for the whole run (vi.stubEnv would be restored after each test, bringing the exported value back).
for (const key of Object.keys(EnvSchema.shape)) Reflect.deleteProperty(process.env, key);
