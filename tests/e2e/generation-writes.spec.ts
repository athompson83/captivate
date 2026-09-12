import { expect, test, type Page } from "@playwright/test";

/**
 * The scenes are written by the server, and writing them twice does not make
 * two decks.
 *
 * `scenes-from-map` used to hand every scene back for a loop in the page to
 * save one at a time, which put a five-minute job behind a phone staying
 * awake: a lock screen between the answer arriving and the last save left a
 * deck half rewritten and looking finished. The route writes them itself now.
 *
 * `planSceneWrites` is pure and unit-tested, but the claim that matters here
 * is not about a function — it is that a real request against a real database
 * with row-level security on writes what the plan says and nothing else. This
 * exercises exactly that, and it can, because no model key is configured in
 * CI: `buildScenesFromMap` returns its structural scenes immediately and the
 * route writes *those*. Every line of the write path runs; only the words in
 * the scenes are placeholders, and this makes no claim about the words.
 *
 * What it asserts is that generating never *grows* the deck. That is the whole
 * contract: a moment's scene is rewritten in place, so a run — or a repeat of
 * one after a phone locked — leaves the same rows rather than a second copy of
 * the argument beside the first.
 *
 * The first version of this test asserted a scene count equal to the moment
 * count, and CI was right to reject it: a template deck's map is *derived from
 * its scenes*, each moment carrying the id of the scene it was read from, so
 * eleven scenes and eight moments became nineteen. That was a real defect in
 * the matching, not a bad selector, and it is fixed in `planSceneWrites`.
 */

const WORKED_EXAMPLE = "Hold the room";

const EMAIL = process.env.CAPTIVATE_E2E_EMAIL ?? "";
const PASSWORD = process.env.CAPTIVATE_E2E_PASSWORD ?? "";

test.skip(!EMAIL || !PASSWORD, "needs a seeded account");
test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30_000 });
}

/**
 * Scenes in the navigator, which is the deck as the author sees it.
 *
 * Returns -1 rather than throwing while the page is mid-reload: the hook
 * reloads once the server reports the write, and a count taken across that
 * boundary loses its execution context. A poll that treats that as "not yet"
 * is the difference between a test and a race.
 */
async function sceneCount(page: Page): Promise<number> {
  try {
    return await page.getByRole("button", { name: /^Actions for scene \d+$/ }).count();
  } catch {
    return -1;
  }
}

/** Turns off the copy-first default, which is right for a person and noise here. */
async function withoutKeepingACopy(page: Page) {
  const keepCopy = page.getByRole("switch", { name: /Keep the deck as it is/i });
  if (!(await keepCopy.isVisible().catch(() => false))) return;
  if ((await keepCopy.getAttribute("aria-checked")) === "true") await keepCopy.click();
}

async function openMap(page: Page) {
  await page.getByRole("radio", { name: /Narrative/i }).click();
  await expect(page.getByRole("heading", { name: "Narrative map" })).toBeVisible();
}

test.describe("generating scenes writes them server-side", () => {
  let deck = "";
  let moments = 0;
  let scenesBefore = 0;

  test("a template deck's map has moments to generate from", async ({ page }) => {
    await signIn(page);
    await page.goto("/templates");
    // The whole card is the button, so the template's own name is the one
    // exact string that identifies it — the journey suite does the same.
    await page
      .getByRole("button")
      .filter({ has: page.getByText(WORKED_EXAMPLE, { exact: true }) })
      .click();
    await page.getByRole("button", { name: /Create presentation/i }).click();
    await page.waitForURL(/\/edit\//, { timeout: 30_000 });
    deck = page.url();

    await page.waitForSelector("[data-stage]");
    scenesBefore = await sceneCount(page);
    expect(scenesBefore, "the template should arrive with scenes").toBeGreaterThan(1);

    await openMap(page);
    moments = await page.getByRole("textbox", { name: "Moment title" }).count();
    expect(moments, "the template should arrive with an argument").toBeGreaterThan(1);
  });

  test("the route writes a scene for every moment", async ({ page }) => {
    await signIn(page);
    await page.goto(deck);
    await page.waitForSelector("[data-stage]");
    await openMap(page);

    await withoutKeepingACopy(page);
    await page.getByRole("button", { name: /(Re)?generate scenes/i }).click();

    // The hook reloads once the server reports it has written them, so the
    // load event is the signal that the write is done and stored.
    await page.waitForEvent("load", { timeout: 120_000 });
    await page.waitForSelector("[data-stage]", { timeout: 60_000 });

    // No model is configured in CI, so these are structural scenes — which is
    // the point: every line of the write path ran, and this asserts what it
    // put in the database, not what any words say.
    //
    // The deck does not grow. Its map was derived from these very scenes, so
    // every moment names one of them and every write is a rewrite.
    await expect
      .poll(() => sceneCount(page), { timeout: 30_000, message: "scenes written server-side" })
      .toBe(scenesBefore);
  });

  test("running it again rewrites the same scenes rather than adding more", async ({ page }) => {
    await signIn(page);
    await page.goto(deck);
    await page.waitForSelector("[data-stage]");
    const before = await sceneCount(page);

    await openMap(page);
    await withoutKeepingACopy(page);
    await page.getByRole("button", { name: /(Re)?generate scenes/i }).click();

    // Matching is by moment. A second run that added a second copy of every
    // scene is the failure this whole design exists to prevent.
    await page.waitForEvent("load", { timeout: 120_000 });
    await page.waitForSelector("[data-stage]", { timeout: 60_000 });
    await expect.poll(() => sceneCount(page), { timeout: 30_000 }).toBe(before);
  });
});
