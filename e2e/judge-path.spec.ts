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
  // Once finished, the address bar is a permalink to this exact run.
  await expect(page).toHaveURL(/\?run=[a-z0-9]+$/);
  const heroUrl = page.url();

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
  // The ROI line comes from the run's own measurements.
  await expect(page.getByText(/This plan took \d+ s/)).toBeVisible();

  // The trace names Qloo surfaces and shows every parameter of a call on demand.
  const trace = page.getByRole("region", { name: "Agent trace" });
  await expect(trace).toContainText(/\d+ Qloo calls · (1\d|[2-9]\d) Qloo surfaces/);
  await trace.getByRole("button", { name: /Qloo critic, pass 1/ }).click();
  await expect(trace).toContainText("feature.explainability=true");
  await expect(trace).toContainText("filter.results.entities=");
  await expect(page.getByRole("region", { name: "Taste Map" })).toBeVisible();
  await noHorizontalScroll(page);
  // Chart labels stay legible at phone width (rendered glyph boxes, not the declared size).
  const smallest = await page.getByRole("region", { name: "Taste Map" }).evaluate((el) => Math.min(...[...el.querySelectorAll("svg text")].map((t) => t.getBoundingClientRect().height)));
  expect(smallest).toBeGreaterThanOrEqual(9);

  // The same model without Qloo, audited by Qloo.
  const view = page.getByRole("group", { name: "Plan view" });
  await view.getByRole("button", { name: "Without Qloo" }).click();
  await expect(page.getByRole("heading", { name: "Campaign pack — without Qloo" })).toBeVisible();
  // Failures are annotated inline, not only on hover.
  await expect(pack.getByText(/Qloo affinity \d\.\d\d: .*Qloo's .*candidates/).first()).toBeVisible();
  await expect(pack.getByText("Not found in Qloo").first()).toBeVisible();
  await view.getByRole("button", { name: "With Qloo" }).click();
  await expect(page.getByRole("heading", { name: "Campaign pack", exact: true })).toBeVisible();

  // Another preset runs and becomes the permalink.
  await page.getByRole("button", { name: "Sports club: new fan market" }).click();
  await finished(page);
  await expect(page).toHaveURL(/\?run=[a-z0-9]+$/);
  expect(page.url()).not.toBe(heroUrl);
  await noHorizontalScroll(page);

  // Ship goes to the labeled sandbox: a real schedule, nothing posted.
  await page.getByRole("button", { name: "Schedule with Sigmora" }).click();
  const ship = page.getByRole("region", { name: "Ship" });
  await expect(ship).toContainText("nothing was posted");
  await expect(ship.getByRole("listitem").first()).toContainText("sandbox");

  expect(errors).toEqual([]);
});

test("a run permalink opens that exact run, in a fresh browser", async ({ page, browser }) => {
  await page.goto("/?preset=dtc-city");
  await finished(page);
  await expect(page).toHaveURL(/\?run=[a-z0-9]+$/);
  const permalink = page.url();
  const first = (await page.getByRole("region", { name: "Campaign pack" }).textContent()) ?? "";
  expect(first).not.toBe("");

  const other = await browser.newPage();
  await other.goto(permalink);
  await finished(other);
  await expect(other).toHaveURL(permalink);
  // It's the stored run, and the trace says so.
  await expect(other.getByRole("region", { name: "Agent trace" })).toContainText("Replay of a finished run");
  await expect(other.getByRole("region", { name: "Campaign pack" })).toHaveText(first);
  await other.close();
});

test("an unknown run permalink explains itself and offers the presets", async ({ page }) => {
  await page.goto("/?run=doesnotexist1");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("expired or never existed");
  await expect(page.getByRole("button", { name: "Indie artist: single launch" })).toBeEnabled();
});

test("the city map draws real tiles, and falls back to the SVG map when the tile host is down", async ({ page }) => {
  // A minimal style served locally keeps the tile path deterministic (no network in the test).
  await page.route("https://tiles.openfreemap.org/**", (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0b10" } }] } }),
  );
  await page.goto("/?preset=indie-release");
  await finished(page);
  await expect(page.getByTestId("tile-map")).toHaveAttribute("data-ready", "true");

  const down = await page.context().newPage();
  await down.route("https://tiles.openfreemap.org/**", (r) => r.abort());
  await down.goto("/?preset=indie-release");
  await finished(down);
  await expect(down.getByRole("img", { name: "Audience demand across the US" })).toBeVisible();
  await down.close();
});

test("a custom brief from the brief bar: a Spotify link alone, a fixed city and a comparable", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const bar = page.getByRole("form", { name: "Your own brief" });
  await bar.getByLabel(/Spotify artist \/ IMDb link/).fill("https://open.spotify.com/artist/687cZJR45JO7jhk1LHIbgq");
  await bar.getByRole("button", { name: /More details/ }).click();
  await bar.getByLabel("Who's launching").fill("Kofi Vale");
  await bar.getByLabel(/^City/).fill("Atlanta");
  await bar.getByLabel(/Position against/).fill("Burna Boy");
  await bar.getByRole("button", { name: "Plan & taste-check" }).click();
  await expect(page.getByText("Brief: Kofi Vale")).toBeVisible();
  await finished(page);
  const trace = page.getByRole("region", { name: "Agent trace" });
  await expect(trace).toContainText("/entities (external IDs)");
  await expect(trace).toContainText("Positioning vs. Burna Boy");
  await expect(page.getByRole("region", { name: "Taste Map" })).toContainText("Where in Atlanta");
  await noHorizontalScroll(page);
});

test("a shared ?b= brief is shown first and runs only on a click", async ({ page }) => {
  const brief = { family: "music", subject: "Kofi Vale", product: "debut EP", seeds: ["Tems"], ages: ["25_to_29"], goal: "Launch to 25–34s.", candidateCities: ["Atlanta", "Houston"] };
  await page.goto(`/?b=${Buffer.from(JSON.stringify(brief)).toString("base64url")}`);
  const shared = page.getByRole("region", { name: "Shared brief" });
  await expect(shared).toContainText("Shared brief: Kofi Vale for fans of Tems");
  await expect(page.getByRole("region", { name: "Campaign pack" })).toHaveCount(0);
  await shared.getByRole("button", { name: "Plan & taste-check it" }).click();
  await finished(page);
  await expect(shared).toHaveCount(0);
  await noHorizontalScroll(page);
});
