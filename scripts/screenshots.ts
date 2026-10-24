/**
 * Retake the README screenshots from a running app.
 *
 *   pnpm screenshots http://localhost:3000   # → docs/screenshots/*.png
 *
 * The page labels its own data source, and the scoreboard blanks its rates on
 * simulated or scripted runs, so offline screenshots carry no placeholder
 * rates. Retake against the live deployment once the keys are set.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const out = "docs/screenshots";
mkdirSync(out, { recursive: true });

async function ready(page: Page) {
  await page.getByRole("region", { name: "Campaign pack" }).waitFor({ timeout: 120_000 });
  // Hide the `next dev` indicator when shooting a local dev server; production builds don't render it.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await desktop.goto(`${base}/?preset=indie-release`);
  await ready(desktop);
  await desktop.screenshot({ path: `${out}/desktop.png` });
  await desktop.getByRole("region", { name: "Taste Map" }).screenshot({ path: `${out}/tastemap.png` });
  await desktop.getByRole("group", { name: "Plan view" }).getByRole("button", { name: "Without Qloo" }).click();
  await desktop.getByRole("heading", { name: "Campaign pack — without Qloo" }).waitFor();
  await desktop.getByRole("region", { name: "Campaign pack" }).screenshot({ path: `${out}/pack-without.png` });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${base}/?preset=indie-release`);
  await ready(phone);
  await phone.screenshot({ path: `${out}/mobile.png` });
  console.log(`Wrote ${out}/{desktop,tastemap,pack-without,mobile}.png from ${base}`);
} finally {
  await browser.close();
}
