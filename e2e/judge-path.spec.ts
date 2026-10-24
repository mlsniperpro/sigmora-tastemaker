/** The judge's path through the hosted demo, in a real browser at 390 px, with no credentials. */
import { expect, test, type Page } from "@playwright/test";

const finished = (page: Page) => expect(page.getByRole("region", { name: "Campaign pack" })).toBeVisible();

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "page scrolls sideways at 390 px").toBeLessThanOrEqual(client);
}

test("hero preset → receipts → without-Qloo toggle → another preset → ship to the sandbox", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await finished(page);
  await expect(page).toHaveURL(/\?preset=indie-release$/);

  // Where the numbers came from is said plainly, and placeholder numbers are blanked.
  await expect(page.getByRole("note")).toContainText(/Simulated Qloo data|Replayed Qloo responses/);
  await expect(page.getByRole("note")).toContainText("Scripted model");
  const scoreboard = page.getByLabel("Scoreboard");
  await expect(scoreboard).toContainText("not shown");
  await expect(scoreboard).not.toContainText("%");

  // Every pick carries a receipt that opens.
  const pack = page.getByRole("region", { name: "Campaign pack" });
  const chip = pack.getByRole("button", { expanded: false }).first();
  await chip.click();
  await expect(pack.getByRole("button", { expanded: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Agent trace" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Taste Map" })).toBeVisible();
  await noHorizontalScroll(page);

  // The same model without Qloo, audited by Qloo.
  const view = page.getByRole("group", { name: "Plan view" });
  await view.getByRole("button", { name: "Without Qloo" }).click();
  await expect(page.getByRole("heading", { name: "Campaign pack — without Qloo" })).toBeVisible();
  await view.getByRole("button", { name: "With Qloo" }).click();
  await expect(page.getByRole("heading", { name: "Campaign pack", exact: true })).toBeVisible();

  // Another preset runs and becomes the permalink.
  await page.getByRole("button", { name: "Sports club: new fan market" }).click();
  await expect(page).toHaveURL(/\?preset=sports-club$/);
  await finished(page);
  await noHorizontalScroll(page);

  // Ship goes to the labeled sandbox: a real schedule, nothing posted.
  await page.getByRole("button", { name: "Schedule with Sigmora" }).click();
  const ship = page.getByRole("region", { name: "Ship" });
  await expect(ship).toContainText("nothing was posted");
  await expect(ship.getByRole("listitem").first()).toContainText("sandbox");

  expect(errors).toEqual([]);
});

test("a permalink reloads the same run", async ({ page }) => {
  await page.goto("/?preset=dtc-city");
  await finished(page);
  const first = (await page.getByRole("region", { name: "Campaign pack" }).textContent()) ?? "";
  expect(first).not.toBe("");
  await page.reload();
  await finished(page);
  await expect(page.getByRole("region", { name: "Campaign pack" })).toHaveText(first);
});
