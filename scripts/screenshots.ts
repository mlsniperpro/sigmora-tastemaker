/**
 * Retake the README screenshots from a running app.
 *
 *   pnpm screenshots http://localhost:3000   # → docs/screenshots/*.png
 *
 * The page labels its own data source, and the scoreboard blanks its rates on
 * simulated or scripted runs, so offline screenshots carry no placeholder
 * rates. Retake against the live deployment once the keys are set.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
  // Element shots scroll the page, and the pinned With / Without Qloo bar would then cover the top of the panel.
  await desktop.addStyleTag({ content: ".sticky { position: static !important; }" });
  // The tile map draws after the page is ready: wait for it, or for the SVG map it falls back to.
  await desktop.locator('[data-testid="tile-map"][data-ready="true"], svg[aria-label="Audience demand across the US"]').first().waitFor({ timeout: 30_000 });
  await desktop.waitForTimeout(1500);
  await desktop.getByRole("region", { name: "Taste Map" }).screenshot({ path: `${out}/tastemap.png` });
  await desktop.getByRole("group", { name: "Plan view" }).getByRole("button", { name: "Without Qloo" }).click();
  await desktop.getByRole("heading", { name: "Campaign pack — without Qloo" }).waitFor();
  await desktop.getByRole("region", { name: "Campaign pack" }).screenshot({ path: `${out}/pack-without.png` });

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${base}/?preset=indie-release`);
  await ready(phone);
  await phone.screenshot({ path: `${out}/mobile.png` });
  // The link-preview card (src/app/opengraph-image.png): words only, so it never shows a placeholder number.
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#0b0b10;color:#ecebf4;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 88px;box-sizing:border-box">
    <div style="color:#b9f227;letter-spacing:.2em;font-weight:700;font-size:26px">TASTEMAKER BY SIGMORA</div>
    <div style="font-size:84px;font-weight:700;line-height:1.05;margin-top:22px">Don't guess the culture.<br>Query it.</div>
    <div style="font-size:30px;color:#9a99ad;margin-top:30px;max-width:960px;line-height:1.35">A marketing agent with Qloo as the critic in its loop: every cultural pick is scored against the audience, weak and invented picks are replaced, and every survivor carries a receipt.</div>
    <div style="display:flex;gap:14px;margin-top:40px;font-size:24px">
      <span style="border:2px solid #3ddc97;color:#3ddc97;border-radius:999px;padding:8px 20px">● Qloo-verified</span>
      <span style="border:2px solid #ff6b6b;color:#ff6b6b;border-radius:999px;padding:8px 20px;text-decoration:line-through">Low affinity</span>
      <span style="border:2px solid #ff4fa3;color:#ff4fa3;border-radius:999px;padding:8px 20px">Not found in Qloo</span>
    </div></body></html>`);
  await card.screenshot({ path: "src/app/opengraph-image.png" });
  writeFileSync("src/app/opengraph-image.alt.txt", "Tastemaker by Sigmora: don't guess the culture, query it. A marketing agent with Qloo as the critic in its loop.\n");
  console.log(`Wrote ${out}/{desktop,tastemap,pack-without,mobile}.png from ${base}, and src/app/opengraph-image.png`);
} finally {
  await browser.close();
}
