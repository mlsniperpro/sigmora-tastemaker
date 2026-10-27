/** The judge's path through the hosted demo, in a real browser at 390 px, with no credentials. */
import { expect, test, type Page } from "@playwright/test";

const finished = (page: Page) => expect(page.getByRole("region", { name: "Campaign pack" })).toBeVisible();

/**
 * Every visible text node in the page's main element that is smaller than 12 px: its computed font size,
 * or for SVG text the size it is drawn at (computed size × the drawing's scale). Screen-reader-only text
 * (clipped to 1 px) isn't drawn, so it isn't counted.
 */
async function textBelow12px(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) throw new Error("no main element");
    const small: string[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || !el.checkVisibility({ checkOpacity: true, visibilityProperty: true })) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const computed = parseFloat(getComputedStyle(el).fontSize);
      const scale = el instanceof SVGGraphicsElement ? (el.getScreenCTM()?.a ?? 1) : 1;
      const size = computed * scale;
      if (size < 11.95) small.push(`${size.toFixed(1)}px <${el.tagName.toLowerCase()}> "${text.slice(0, 40)}"`);
    }
    return small;
  });
}

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
  const fold = page.viewportSize()?.height ?? 0;
  expect(top?.y ?? Infinity, "the diff card starts in the first viewport").toBeLessThan(fold);
  // The scripted model's plan without Qloo is the same for every brief of a kind, and says so.
  await expect(diff).toContainText("Scripted stand-in: a fixed sample plan for this category, not a model's answer to your brief.");
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    // On desktop the product is on the first screen: where to launch beside the diff, and the three columns below it.
    await expect(diff.getByRole("img", { name: /^Where to launch: / })).toBeInViewport();
    for (const name of ["Agent trace", "Taste Map", "Campaign pack"]) {
      const box = await page.getByRole("region", { name }).boundingBox();
      expect(box?.y ?? Infinity, `${name} starts in the first viewport`).toBeLessThan(fold - 120);
    }
  }
  // The plain model's worst picks, struck through with their notes.
  await expect(diff.locator(".line-through").first()).toBeVisible();
  if (simulated) await expect(diff).not.toContainText(/Not found in Qloo|\d\.\d\d/);

  // Every pick carries a receipt that opens.
  const pack = page.getByRole("region", { name: "Campaign pack" });
  const chip = pack.getByRole("button", { expanded: false }).first();
  await chip.click();
  await expect(pack.getByRole("button", { expanded: true }).first()).toBeVisible();
  // The ROI line comes from the run's own measurements. This run has a scripted model (and maybe simulated Qloo), so
  // it is an offline demo run and claims no duration.
  await expect(page.getByText(/Offline demo run/)).toBeVisible();
  await expect(page.getByText(/This plan took/)).toHaveCount(0);

  // The trace names Qloo surfaces and shows every parameter of a call on demand.
  const trace = page.getByRole("region", { name: "Agent trace" });
  // Calls the offline simulator answered are called simulated, in the trace header and in the sticky bar.
  if (simulated) {
    await expect(trace).toContainText(/\d+ simulated calls · (1\d|[2-9]\d) Qloo surfaces exercised \(simulated\)/);
    await expect(trace).not.toContainText(/\d+ Qloo calls/);
    if ((page.viewportSize()?.width ?? 0) < 1024) await expect(page.getByRole("link", { name: /^Trace · \d+ simulated calls/ })).toBeVisible();
  } else {
    await expect(trace).toContainText(/\d+ Qloo calls · (1\d|[2-9]\d) Qloo surfaces/);
    await expect(trace).not.toContainText("simulated calls");
  }
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
  await expect(pack).toContainText("Scripted stand-in: a fixed sample plan for this category");
  // Failures are annotated inline, not only on hover; simulated verdicts say so and print no numbers.
  if (simulated) {
    await expect(pack.getByText("Simulated: not in catalog").first()).toBeVisible();
    await expect(pack.getByText(/offline simulator/).first()).toBeVisible();
    await expect(pack).not.toContainText(/Not found in Qloo|Passes the Qloo bar|affinity \d\.\d\d/);
  } else {
    await expect(pack.getByText(/Qloo affinity \d\.\d\d: .*Qloo's .*candidates/).first()).toBeVisible();
    await expect(pack.getByText("Not found in Qloo").first()).toBeVisible();
  }
  await view.getByRole("button", { name: "With Qloo" }).click();
  await expect(page.getByRole("heading", { name: "Campaign pack", exact: true })).toBeVisible();

  // Another preset runs and becomes the permalink.
  await page.getByRole("button", { name: "Sports club: new fan market" }).click();
  // The hero stays on screen until the new run lands, then the address bar points at the new run.
  await expect.poll(() => page.url(), { timeout: 60_000 }).not.toBe(heroUrl);
  await expect(page).toHaveURL(/\?run=[a-z0-9]+$/);
  await finished(page);
  await noHorizontalScroll(page);

  // Ship goes to the labeled sandbox: a real schedule, nothing posted.
  await page.getByRole("button", { name: "Schedule with Sigmora" }).click();
  const ship = page.getByRole("region", { name: "Ship" });
  await expect(ship).toContainText("Sandbox: schedule computed, nothing posted.");
  await expect(ship.getByRole("listitem").first()).toContainText("sandbox");

  expect(errors).toEqual([]);
});

test("no text on the judge path is smaller than 12 px at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preset=indie-release");
  await finished(page);
  expect(await textBelow12px(page), "first load").toEqual([]);

  // A receipt opened (its GET URLs), the plan without Qloo, the brief form with its details, and an audit's results.
  const pack = page.getByRole("region", { name: "Campaign pack" });
  await pack.getByRole("button", { expanded: false }).first().click();
  await expect(pack.getByText(/^GET /).first()).toBeVisible();
  expect(await textBelow12px(page), "receipt open").toEqual([]);
  await page.getByRole("group", { name: "Plan view" }).getByRole("button", { name: "Without Qloo" }).click();
  await expect(page.getByRole("heading", { name: "Campaign pack — without Qloo" })).toBeVisible();
  expect(await textBelow12px(page), "without Qloo").toEqual([]);
  await page.getByRole("button", { name: "Edit brief" }).click();
  await page.getByRole("form", { name: "Your own brief" }).getByRole("button", { name: /More details/ }).click();
  expect(await textBelow12px(page), "brief form").toEqual([]);
  const panel = page.getByRole("region", { name: "Audit any AI's plan" });
  await page.getByRole("link", { name: "Paste any AI's plan" }).click();
  await panel.getByRole("button", { name: "Try a sample plan" }).click();
  await expect(panel.getByRole("region", { name: "Audit results" }).getByRole("listitem").first()).toBeVisible();
  expect(await textBelow12px(page), "audit results").toEqual([]);
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

test("an unknown run permalink says so at the top and shows the hero preset instead of an empty page", async ({ page }) => {
  await page.goto("/?run=doesnotexist1");
  const notice = page.getByRole("status").filter({ hasText: "expired or never existed" });
  await expect(notice).toContainText("That shared run has expired or never existed; here's the hero preset instead.");
  // At the top of the page, above the header and in the first viewport, not below the fold.
  const box = await notice.boundingBox();
  expect(box?.y ?? Infinity, "the notice is in the first viewport").toBeLessThan(page.viewportSize()?.height ?? 0);
  expect(await page.getByRole("main").evaluate((m) => m.firstElementChild?.getAttribute("role"))).toBe("status");
  // The hero preset loads on its own: a finished plan, its permalink, and the preset marked as the one shown.
  await finished(page);
  await expect(page).toHaveURL(/\?run=[a-z0-9]+$/);
  expect(page.url()).not.toContain("doesnotexist1");
  await expect(page.getByRole("button", { name: "Indie artist: single launch" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Brief: Nia Sol")).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await noHorizontalScroll(page);
  // Picking something else clears the notice, which was about the link.
  await page.getByRole("button", { name: "Sports club: new fan market" }).click();
  await expect(notice).toHaveCount(0);
  await finished(page);
});

test("Edit brief opens with the brief on screen, and the audit panel's audience follows it until edited", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const bar = page.getByRole("form", { name: "Your own brief" });
  await page.getByRole("button", { name: "Edit brief" }).click();
  await expect(bar.getByLabel("Who's launching")).toHaveValue("Nia Sol");
  await expect(bar.getByLabel(/Your audience already loves/)).toHaveValue("Tems, Rema, Asake");
  await expect(bar.getByLabel(/Spotify artist \/ IMDb link/)).toHaveValue(/open\.spotify\.com\/artist\//);
  await expect(bar.getByRole("button", { name: "25 to 29" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.getByRole("button", { name: "24 & under" })).toHaveAttribute("aria-pressed", "false");
  await bar.getByRole("button", { name: /More details/ }).click();
  await expect(bar.getByLabel("What")).not.toHaveValue("");
  await expect(bar.getByLabel("Goal")).not.toHaveValue("");

  // Another run replaces the fields with its own brief.
  await page.getByRole("button", { name: "Sports club: new fan market" }).click();
  await finished(page);
  await page.getByRole("button", { name: "Edit brief" }).click();
  await expect(bar.getByLabel("Who's launching")).toHaveValue("Southbank FC");

  // The audit panel's audience is the brief's, and follows it while untouched.
  const panel = page.getByRole("region", { name: "Audit any AI's plan" });
  const names = panel.getByLabel(/The audience already loves/);
  await page.getByRole("link", { name: "Paste any AI's plan" }).click();
  const seeds = await names.inputValue();
  expect(seeds).not.toBe("");
  expect(seeds).not.toContain("Tems");
  await page.getByRole("button", { name: "Indie artist: single launch" }).click();
  await finished(page);
  await expect(names).toHaveValue("Tems, Rema, Asake");
  await expect(panel.getByRole("button", { name: "25 to 29" })).toHaveAttribute("aria-pressed", "true");
  // Once the reader has edited it, a new run leaves it alone.
  await names.fill("Phoebe Bridgers");
  await page.getByRole("button", { name: "Sports club: new fan market" }).click();
  await finished(page);
  await expect(names).toHaveValue("Phoebe Bridgers");
  await noHorizontalScroll(page);
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

test("a custom brief asks for who's launching instead of inventing a name", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const runs: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/run")) runs.push(r.url());
  });
  await page.getByRole("button", { name: "Edit brief" }).click();
  const bar = page.getByRole("form", { name: "Your own brief" });
  // "Edit brief" starts from the brief on screen; this one leaves "Who's launching" blank on purpose.
  await bar.getByLabel("Who's launching").fill("");
  await bar.getByLabel(/Your audience already loves/).fill("Phoebe Bridgers, boygenius");
  await bar.getByRole("button", { name: "Plan & taste-check" }).click();
  await expect(bar.getByRole("alert")).toHaveText("Say who's launching: the artist, brand or club the plan is for.");
  await expect(bar.getByLabel("Who's launching")).toBeFocused();
  await expect(bar.getByLabel("Who's launching")).toHaveAttribute("aria-invalid", "true");
  expect(runs).toEqual([]);
  await expect(page.getByText(/My launch/)).toHaveCount(0);
  await noHorizontalScroll(page);
});

test("a custom brief from the brief bar: a Spotify link alone, a fixed city and a comparable", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  // Once a run is on screen the brief folds to one line; "Edit brief" opens the form.
  const bar = page.getByRole("form", { name: "Your own brief" });
  await expect(bar).toBeHidden();
  await page.getByRole("button", { name: "Edit brief" }).click();
  await bar.getByLabel(/Spotify artist \/ IMDb link/).fill("https://open.spotify.com/artist/687cZJR45JO7jhk1LHIbgq");
  await bar.getByLabel("Who's launching").fill("Kofi Vale");
  await bar.getByRole("button", { name: /More details/ }).click();
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
  // Above the brief form, so a phone shows it without scrolling (audit 14).
  await expect(shared).toBeInViewport();
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
  // An audience of only commas is caught in the browser, in words, before anything is sent.
  const audits: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/audit")) audits.push(r.url());
  });
  await panel.getByLabel("The plan, as the AI wrote it").fill("Collab targets: Ayra Starr, Victony. Venue: The Masquerade.");
  await panel.getByLabel(/The audience already loves/).fill(" , ");
  await panel.getByRole("button", { name: "Audit every name" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Name at least one artist or brand your audience loves.");
  await expect(panel.getByLabel(/The audience already loves/)).toBeFocused();
  await expect(panel).not.toContainText(/Too small|expected array/);
  expect(audits).toEqual([]);
  await panel.getByRole("button", { name: "Try a sample plan" }).click();
  await expect(panel.getByLabel("The plan, as the AI wrote it")).toHaveValue(/Collab targets: Ayra Starr/);
  const results = panel.getByRole("region", { name: "Audit results" });
  await expect(results.getByRole("listitem").first()).toBeVisible();
  await expect(results).toContainText("Kemi Adebayo-Rhodes");
  await expect(results).toContainText("The Highlife Hour");
  const simulated = ((await results.textContent()) ?? "").includes("simulated data, not Qloo");
  if (simulated) {
    await expect(results.getByText("Simulated: not in catalog").first()).toBeVisible();
    await expect(results).not.toContainText(/Not found in Qloo|Passes the Qloo bar|\d\.\d\d/);
  } else {
    await expect(results.getByText("Not found in Qloo").first()).toBeVisible();
    await expect(results).toContainText(/checked by Qloo: \d+ not found in Qloo/);
  }
  // Each verdict chip opens its receipt, as in the pack.
  await results.getByRole("button", { expanded: false }).first().click();
  await expect(results.getByRole("button", { expanded: true }).first()).toBeVisible();
  await noHorizontalScroll(page);
});

test("the header's \"Paste any AI's plan\" opens the audit panel and lands on the plan box", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const cta = page.getByRole("link", { name: "Paste any AI's plan" });
  await expect(cta).toBeInViewport();
  const panel = page.getByRole("region", { name: "Audit any AI's plan" });
  await expect(panel.getByRole("button", { name: /Audit any AI's plan/ })).toHaveAttribute("aria-expanded", "false");
  await cta.click();
  await expect(panel.getByRole("button", { name: /Audit any AI's plan/ })).toHaveAttribute("aria-expanded", "true");
  const box = panel.getByLabel("The plan, as the AI wrote it");
  await expect(box).toBeFocused();
  await expect(box).toBeInViewport();
  await noHorizontalScroll(page);
});

test("the toggle bar jumps to the trace below the desktop layout", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const jump = page.getByRole("link", { name: /^Trace · \d+ (Qloo|simulated) calls/ });
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

test("flipping the plan view below the desktop layout brings the campaign pack into view", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const view = page.getByRole("group", { name: "Plan view" });
  await view.getByRole("button", { name: "Without Qloo" }).click();
  const heading = page.getByRole("heading", { name: "Campaign pack — without Qloo" });
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    // On desktop the page stays where the judge is looking.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    return;
  }
  await expect(heading).toBeInViewport();
  // Flipping back keeps the pack on screen, now the plan after the critic.
  await view.getByRole("button", { name: "With Qloo" }).click();
  await expect(page.getByRole("heading", { name: "Campaign pack", exact: true })).toBeInViewport();
});

test("offline, a custom brief's diff card doesn't pass off a preset's sample plan as the plan without Qloo", async ({ page }) => {
  await page.goto("/?preset=indie-release");
  await finished(page);
  const diff = page.getByRole("region", { name: "With and without Qloo" });
  // The preset's own scripted sample is shown, labelled.
  await expect(diff).toContainText("Scripted stand-in");
  await page.getByRole("button", { name: "Edit brief" }).click();
  const bar = page.getByRole("form", { name: "Your own brief" });
  await bar.getByLabel("Who's launching").fill("Zuri Bakes");
  await bar.getByLabel(/Your audience already loves/).fill("Taylor Swift, Nickelback");
  await bar.getByRole("button", { name: "Plan & taste-check" }).click();
  await expect(page.getByText("Brief: Zuri Bakes")).toBeVisible();
  await finished(page);
  await expect(diff).toContainText("For your own brief this needs a live model");
  await expect(diff).not.toContainText("Scripted stand-in");
  await noHorizontalScroll(page);
});

test("an unknown path gets the branded 404 with a way back to the demo", async ({ page }) => {
  const res = await page.goto("/nope");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page isn't part of Tastemaker.");
  await page.getByRole("link", { name: "Back to the demo" }).click();
  await finished(page);
});

test("a ?measure= link waits for a click before reading a campaign or spending a run", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) calls.push(r.url());
  });
  await page.goto("/?measure=c_demo-1");
  const ask = page.getByRole("region", { name: "Measure a campaign" });
  await expect(ask).toContainText("Measure campaign c_demo-1");
  await expect(ask).toBeInViewport();
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
  await ask.getByRole("button", { name: "Measure & re-plan" }).click();
  await expect.poll(() => calls.some((u) => u.includes("/api/"))).toBe(true);
});

test("a brief edited from someone's shared link still says so to the server, and a preset clears it", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/run") && r.method() === "POST") bodies.push(JSON.parse(r.postData() ?? "{}") as Record<string, unknown>);
  });
  const brief = { family: "music", subject: "Kofi Vale", product: "debut EP", seeds: ["Tems"], ages: ["25_to_29"], goal: "Launch to 25–34s.", candidateCities: ["Atlanta", "Houston"] };
  await page.goto(`/?b=${Buffer.from(JSON.stringify(brief)).toString("base64url")}`);
  await page.getByRole("region", { name: "Shared brief" }).getByRole("button", { name: "Plan & taste-check it" }).click();
  await finished(page);
  await page.getByRole("button", { name: "Edit brief" }).click();
  const bar = page.getByRole("form", { name: "Your own brief" });
  await bar.getByLabel("Who's launching").fill("Kofi Vale II");
  await bar.getByRole("button", { name: "Plan & taste-check" }).click();
  await expect(page.getByText("Brief: Kofi Vale II")).toBeVisible();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies.map((b) => b.shared)).toEqual([true, true]);
  // A preset starts clean.
  await page.getByRole("button", { name: "DTC brand: new city" }).click();
  await finished(page);
  await page.getByRole("button", { name: "Edit brief" }).click();
  await bar.getByLabel("Who's launching").fill("Own Brand");
  await bar.getByRole("button", { name: "Plan & taste-check" }).click();
  await expect(page.getByText("Brief: Own Brand")).toBeVisible();
  await expect.poll(() => bodies.length).toBe(4);
  expect(bodies[3]?.shared).toBeUndefined();
});
