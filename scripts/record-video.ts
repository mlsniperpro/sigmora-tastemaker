/**
 * Record the ≤2-minute judge-path walkthrough as a captioned screen video.
 *
 *   pnpm video https://tastemaker.example.com   # → video/tastemaker-walkthrough.webm
 *
 * Needs Playwright's Chromium (`pnpm exec playwright install chromium`, or
 * PLAYWRIGHT_CHROMIUM_PATH). Record against a deployment with a live Qloo
 * key: the video should show real data, and the banner will say so if it doesn't.
 */
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = join(process.cwd(), "video");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: outDir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();

async function caption(text: string, ms: number) {
  await page.evaluate((t: string) => {
    let el = document.getElementById("__cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__cap";
      el.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;max-width:900px;padding:14px 22px;border-radius:14px;background:rgba(10,10,16,.92);color:#fff;font:600 22px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.5);border:1px solid #b9f227";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await page.waitForTimeout(ms);
}

await page.goto(`${base}/?preset=indie-release`);
await page.waitForSelector("text=Cultural picks", { timeout: 60000 });
await caption("AI marketing agents guess the culture. Tastemaker checks it with Qloo.", 5000);
await caption("An indie Afro-fusion artist launches a single. The agent plans the campaign…", 4500);
await caption("…and every step calls Qloo: demographics, taste tags, culture map, cities, trends, compare.", 6000);
await page.locator('section[aria-label="Taste Map"]').first().scrollIntoViewIfNeeded();
await caption("The Taste Map: who over-indexes, their vocabulary, and where to play first.", 6000);
await page.locator("text=Cultural picks").first().scrollIntoViewIfNeeded();
await caption("The model proposes. Qloo scores every pick. Weak or invented picks get replaced.", 5500);
await page.locator('section[aria-label="Campaign pack"] button[aria-expanded]').first().click();
await caption("Every pick carries a receipt: affinity, what drove it, its trend, and the exact Qloo call.", 6500);
await page.mouse.wheel(0, -4000);
const view = page.getByRole("group", { name: "Plan view" });
await view.getByRole("button", { name: "Without Qloo" }).click();
await page.waitForTimeout(400);
await page.locator("text=Cultural picks").first().scrollIntoViewIfNeeded();
await caption("Without Qloo: same model, no grounding. Invented names, wrong references, wrong city.", 7000);
await page.mouse.wheel(0, -4000);
await caption("That gap is the Culture Miss Rate, measured on every run.", 4500);
await view.getByRole("button", { name: "With Qloo" }).click();
await page.getByRole("button", { name: "Sports club: new fan market" }).click();
await page.waitForSelector("text=Cultural picks", { timeout: 60000 });
await caption("It generalizes: a football club picking its first US watch-party city…", 5000);
await page.getByRole("button", { name: "DTC brand: new city" }).click();
await page.waitForSelector("text=Cultural picks", { timeout: 60000 });
await caption("…or a skincare brand entering Atlanta.", 4000);
await page.locator('section[aria-label="Ship"]').first().scrollIntoViewIfNeeded();
await page.getByRole("button", { name: "Schedule with Sigmora" }).click();
await caption("Then it ships: the verified pack is scheduled through Sigmora.", 5000);
await page.mouse.wheel(0, -6000);
await caption("Don't guess the culture. Query it. Tastemaker by Sigmora.", 5000);

await ctx.close();
await browser.close();
const webm = readdirSync(outDir).filter((f) => f.endsWith(".webm") && !f.startsWith("tastemaker-")).pop();
if (webm) renameSync(join(outDir, webm), join(outDir, "tastemaker-walkthrough.webm"));
console.log(`Saved ${join(outDir, "tastemaker-walkthrough.webm")} (~80 s). Add a voice-over or music, then upload.`);
