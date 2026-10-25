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
  const simulated = ((await page.getByRole("note").textContent()) ?? "").includes("Simulated Qloo data");
  // The core idea is on the first screen: the same model with and without Qloo, from this run's own receipts.
  const diff = page.getByRole("region", { name: "With and without Qloo" });
  await expect(diff).toContainText("Same model, no Qloo");
  await expect(diff).toContainText("With the Qloo critic");
  await expect(diff).toContainText("not shown");
  await expect(diff).not.toContainText("%");
  const top = await diff.boundingBox();
  expect(top?.y ?? Infinity, "the diff card starts in the first viewport").toBeLessThan(page.viewportSize()?.height ?? 0);
  // The plain model's worst picks, struck through with their notes.
  await expect(diff.locator(".line-through").first()).toBeVisible();
  if (simulated) await expect(diff).not.toContainText(/Not found in Qloo|\d\.\d\d/);

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
  const map = page.getByRole("region", { name: "Taste Map" });
  await expect(map).toBeVisible();
  // No real data, no numbers: simulated runs show shapes and ranks only, and the trace names no verdict count or score.
  if (simulated) {
    await expect(map).toContainText("simulated data, not Qloo");
    await expect(map).not.toContainText(/\d\.\d\d|[+−]\d/);
    await expect(trace).toContainText("picks checked by the offline simulator");
    await expect(trace).not.toContainText(/\d+ invented · |affinity \d|\d\.\d\d/);
  } else {
    await expect(map).toContainText(/\d\.\d\d/);
    await expect(trace).toContainText(/\d+ invented · \d+ low-affinity/);
  }
  await noHorizontalScroll(page);
  // Chart labels stay legible at phone width (rendered glyph boxes, not the declared size).
  const smallest = await page.getByRole("region", { name: "Taste Map" }).evaluate((el) => Math.min(...[...el.querySelectorAll("svg text")].map((t) => t.getBoundingClientRect().height)));
  expect(smallest).toBeGreaterThanOrEqual(9);

  // The same model without Qloo, audited by Qloo.
  // The toggle stays on screen while the reader is down in the pack.
  const view = page.getByRole("group", { name: "Plan view" });
  await pack.getByRole("heading", { name: "Cultural picks" }).scrollIntoViewIfNeeded();
  await expect(view).toBeInViewport();
  await view.getByRole("button", { name: "Without Qloo" }).click();
  await expect(view.getByRole("button", { name: "Without Qloo" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Campaign pack — without Qloo" })).toBeVisible();
  // Failures are annotated inline, not only on hover; simulated verdicts say so and print no numbers.
  if (simulated) {
    await expect(pack.getByText("Simulated: not in catalog").first()).toBeVisible();
    await expect(pack.getByText(/offline simulator/).first()).toBeVisible();
    await expect(pack).not.toContainText(/Not found in Qloo|Qloo-verified|affinity \d\.\d\d/);
  } else {
    await expect(pack.getByText(/Qloo affinity \d\.\d\d: .*Qloo's .*candidates/).first()).toBeVisible();
    await expect(pack.getByText("Not found in Qloo").first()).toBeVisible();
  }
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
  await expect(other.getByRole("region", { name: "Agent trace" })).toContainText("Instant: this exact run finished at");
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
  // Once a run is on screen the brief folds to one line; "Edit brief" opens the form.
  const bar = page.getByRole("form", { name: "Your own brief" });
  await expect(bar).toBeHidden();
  await page.getByRole("button", { name: "Edit brief" }).click();
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

test("audit any AI's plan: the sample plan in one click, every name with a verdict", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const panel = page.getByRole("region", { name: "Audit any AI's plan" });
  // Closed by default: one line under the diff card.
  const toggle = panel.getByRole("button", { name: /Audit any AI's plan/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("button", { name: "Try a sample plan" })).toBeHidden();
  await toggle.click();
  await panel.getByRole("button", { name: "Try a sample plan" }).click();
  await expect(panel.getByLabel("The plan, as the AI wrote it")).toHaveValue(/Collab targets: Ayra Starr/);
  const results = panel.getByRole("region", { name: "Audit results" });
  await expect(results.getByRole("listitem").first()).toBeVisible();
  await expect(results).toContainText("Kemi Adebayo-Rhodes");
  await expect(results).toContainText("The Highlife Hour");
  const simulated = ((await results.textContent()) ?? "").includes("simulated data, not Qloo");
  if (simulated) {
    await expect(results.getByText("Simulated: not in catalog").first()).toBeVisible();
    await expect(results).not.toContainText(/Not found in Qloo|Qloo-verified|\d\.\d\d/);
  } else {
    await expect(results.getByText("Not found in Qloo").first()).toBeVisible();
    await expect(results).toContainText(/checked by Qloo: \d+ not found in Qloo/);
  }
  // Each verdict chip opens its receipt, as in the pack.
  await results.getByRole("button", { expanded: false }).first().click();
  await expect(results.getByRole("button", { expanded: true }).first()).toBeVisible();
  await noHorizontalScroll(page);
});

test("the toggle bar jumps to the trace below the desktop layout", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const jump = page.getByRole("link", { name: /^Trace · \d+ Qloo calls/ });
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    // On desktop the trace is the left rail, already in view, so there is nothing to jump to.
    await expect(jump).toBeHidden();
    return;
  }
  const trace = page.getByRole("region", { name: "Agent trace" });
  await trace.getByRole("button", { name: "Hide steps" }).click();
  await page.getByRole("heading", { name: "Campaign pack", exact: true }).scrollIntoViewIfNeeded();
  await jump.click();
  // It opens the collapsed trace and lands on it.
  await expect(trace.getByRole("button", { name: "Hide steps" })).toBeVisible();
  await expect(trace.getByRole("heading", { name: "Agent trace" })).toBeInViewport();
  await expect(trace).toBeFocused();
});
