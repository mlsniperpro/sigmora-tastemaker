/**
 * Browser end-to-end test: the real app in a real Chromium at phone width,
 * with no credentials (replay mode, scripted model, sandbox publisher).
 *
 *   pnpm test:e2e
 *
 * Starts `next dev` on its own port. Set PLAYWRIGHT_CHROMIUM_PATH to use a
 * preinstalled Chromium instead of `pnpm exec playwright install chromium`.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = 3217;
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  projects: [
    {
      name: "phone-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: false,
    // No keys: Qloo answers from recorded fixtures (else the labeled simulator), drafts from the scripted model.
    env: { QLOO_MODE: "replay", QLOO_API_KEY: "", LLM_PROVIDER: "", LLM_API_KEY: "", SIGMORA_PUBLISH_MODE: "sandbox", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
