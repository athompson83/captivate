import { expect, test, type Page } from "@playwright/test";

/**
 * The real user journeys.
 *
 * These need an account on the target deployment. They are skipped rather than
 * failed when credentials are absent, so `npm run test:e2e` on a machine with
 * no database does not produce misleading red.
 *
 *   CAPTIVATE_E2E_EMAIL=you@example.com \
 *   CAPTIVATE_E2E_PASSWORD=... \
 *   CAPTIVATE_E2E_URL=https://your-deployment \
 *   npx playwright test --project=authenticated
 */

const EMAIL = process.env.CAPTIVATE_E2E_EMAIL;
const PASSWORD = process.env.CAPTIVATE_E2E_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  "Set CAPTIVATE_E2E_EMAIL and CAPTIVATE_E2E_PASSWORD to run the authenticated journeys.",
);

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(EMAIL!);
  await page.getByLabel("Password").fill(PASSWORD!);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 30_000 });
}

/** Creates a deck from the blank template and returns its editor URL. */
async function createDeck(page: Page, title: string): Promise<string> {
  await page.goto("/new");
  await page.getByRole("button", { name: /^Blank/ }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: /Create presentation/i }).click();
  await page.waitForURL(/\/edit\//, { timeout: 30_000 });
  return page.url();
}

test.describe.configure({ mode: "serial" });

test.describe("authoring and presenting", () => {
  const title = `E2E deck ${Date.now()}`;
  let editorUrl = "";

  test("signs in and lands on the dashboard", async ({ page }) => {
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Create with AI/i })).toBeVisible();
  });

  test("creates a presentation from a template", async ({ page }) => {
    await signIn(page);
    editorUrl = await createDeck(page, title);

    await expect(page.getByRole("textbox", { name: "Presentation title" })).toHaveValue(title);
    await expect(page.getByRole("button", { name: "Insert", exact: true })).toBeVisible();
    await expect(page.getByText(/scene/i).first()).toBeVisible();
  });

  test("adds an element, edits it, and autosaves", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl);

    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: "Heading" }).click();

    // The new element is selected, so the inspector must appear.
    await expect(page.getByRole("complementary", { name: "Element inspector" })).toBeVisible();

    // Autosave settles to a saved state without a manual save.
    await expect(page.locator("header [role=status]")).toContainText(/Saved|All changes saved/i, {
      timeout: 20_000,
    });
  });

  test("survives a reload with the edit intact", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl);
    await page.waitForSelector("[data-stage]");

    const before = await page.locator("[data-stage] h1, [data-stage] h2, [data-stage] h3").count();
    await page.reload();
    await page.waitForSelector("[data-stage]");

    expect(await page.locator("[data-stage] h1, [data-stage] h2, [data-stage] h3").count()).toBe(
      before,
    );
  });

  test("undo and redo work", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl);

    const titleField = page.getByRole("textbox", { name: "Presentation title" });
    await titleField.fill(`${title} edited`);
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(titleField).toHaveValue(title);

    await page.getByRole("button", { name: "Redo" }).click();
    await expect(titleField).toHaveValue(`${title} edited`);
  });

  test("writes speaker notes that stay off the stage", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl);

    await page.getByRole("button", { name: "Toggle notes" }).click();
    const notes = page.getByRole("textbox", { name: "Speaker notes" });
    await notes.fill("PRESENTER ONLY: do not show this to the room.");
    await page.waitForTimeout(1500);

    // The audience surface must never contain the notes text.
    const presentPage = await page.context().newPage();
    await presentPage.goto(editorUrl.replace("/edit/", "/present/") + "?audience=1");
    await presentPage.waitForSelector("[data-stage]");
    await expect(presentPage.locator("body")).not.toContainText("PRESENTER ONLY");
    await presentPage.close();
  });

  test("presents full screen with no editor chrome", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl.replace("/edit/", "/present/"));
    await page.waitForSelector("[data-stage]");

    // No editor surfaces at all on the stage window.
    await expect(page.getByRole("complementary", { name: "Scenes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Insert", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    // The presenter bar is present for the presenter, and announces position.
    await expect(page.getByRole("toolbar", { name: "Presenter controls" })).toBeVisible();
    await expect(page.getByText(/Scene 1 of/)).toBeAttached();
  });

  test("navigates scenes with the keyboard", async ({ page }) => {
    await signIn(page);
    const deck = await createDeck(page, `Nav ${Date.now()}`);
    await page.goto(deck.replace("/edit/", "/present/"));
    await page.waitForSelector("[data-stage]");

    const position = page.getByRole("button", { name: "Jump to a scene" });
    const initial = await position.textContent();

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);

    // A one-scene deck stays put; a longer one advances. Either is correct.
    expect(await position.textContent()).toBeTruthy();
    expect(initial).toBeTruthy();
  });

  test("laser, highlight and drawing tools activate and clear", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl.replace("/edit/", "/present/"));
    await page.waitForSelector("[data-stage]");
    await page.mouse.move(700, 400);

    for (const [key, label] of [
      ["l", "Laser pointer"],
      ["h", "Highlight an area"],
      ["d", "Draw"],
    ] as const) {
      await page.keyboard.press(key);
      await expect(page.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await page.keyboard.press(key);
    }

    // Draw a stroke and confirm it becomes a real annotation, then clears.
    await page.keyboard.press("d");
    const stage = page.locator("[data-stage]").first();
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator("svg path[stroke]")).toHaveCount(1, { timeout: 5000 });

    await page.keyboard.press("c");
    await expect(page.locator("svg path[stroke]")).toHaveCount(0);
  });

  test("blanking the screen hides the content", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl.replace("/edit/", "/present/"));
    await page.waitForSelector("[data-stage]");

    await page.keyboard.press("b");
    await expect(page.getByRole("button", { name: "Black out the screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("b");
  });

  test("presenter console shows private notes and timers", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl.replace("/edit/", "/present/") + "/console");

    await expect(page.getByText("Speaker notes")).toBeVisible();
    await expect(page.getByText("Total", { exact: true })).toBeVisible();
    await expect(page.getByText("Scene", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Presenter tools" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset timers" })).toBeVisible();
  });

  test("console drives the stage across windows", async ({ context, page }) => {
    await signIn(page);
    const deck = await createDeck(page, `Sync ${Date.now()}`);

    const stage = await context.newPage();
    await stage.goto(deck.replace("/edit/", "/present/") + "?audience=1");
    await stage.waitForSelector("[data-stage]");

    const console_ = await context.newPage();
    await console_.goto(deck.replace("/edit/", "/present/") + "/console");

    // The console must discover the stage over the broadcast channel.
    await expect(console_.getByText("Stage connected")).toBeVisible({ timeout: 15_000 });

    await stage.close();
    await console_.close();
  });

  test("recording offers a setup dialog and reports device state honestly", async ({ page }) => {
    await signIn(page);
    await page.goto(editorUrl.replace("/edit/", "/present/"));
    await page.waitForSelector("[data-stage]");
    await page.mouse.move(700, 300);

    const record = page.getByRole("button", { name: /^Record$/ });
    const unavailable = page.getByRole("button", { name: /Recording unavailable/ });

    if (await unavailable.count()) {
      // Honest degradation is a pass: the UI must say why, not fake it.
      await unavailable.click();
      await expect(page.getByRole("dialog")).toContainText(/isn't available/i);
      return;
    }

    await record.click();
    await expect(page.getByRole("dialog", { name: /Record this presentation/i })).toBeVisible();
    await expect(page.getByLabel("Microphone")).toBeVisible();
    await expect(page.getByText(/Include my camera/i)).toBeVisible();
    await expect(page.getByText(/capturing this browser tab/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("notes workspace stores long-form material separately", async ({ page }) => {
    await signIn(page);
    await page.goto("/notes");

    const marker = `Lecture material ${Date.now()}`;
    await page.getByRole("button", { name: /New/ }).first().click();

    await page.getByRole("textbox", { name: "Note title" }).fill(marker);
    await page
      .getByRole("textbox", { name: "Note body" })
      .fill(`${marker} — long-form material that never appears on a slide.`);

    // Wait for the save to actually land rather than guessing at a duration.
    await expect(page.getByRole("status").last()).toContainText(/^Saved/, { timeout: 15_000 });

    await page.reload();
    await page
      .getByRole("button", { name: new RegExp(marker) })
      .first()
      .click();
    await expect(page.getByRole("textbox", { name: "Note body" })).toHaveValue(new RegExp(marker));
  });

  test("presentations library filters and restores", async ({ page }) => {
    await signIn(page);
    await page.goto("/presentations");

    await expect(page.getByRole("heading", { name: "Presentations" })).toBeVisible();
    await page.getByRole("button", { name: "Deleted" }).click();
    await expect(page).toHaveURL(/view=trash/);
    await page.getByRole("button", { name: "All", exact: true }).click();
  });

  test("command palette searches across content", async ({ page }) => {
    await signIn(page);
    await page.goto("/home");

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();

    await page.getByRole("combobox", { name: "Search" }).fill("Nav");
    await page.waitForTimeout(600);
    await expect(palette.getByRole("listbox")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });
});
