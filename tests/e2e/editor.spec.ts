import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The signed-in editor, in a browser, with no account.
 *
 * Everything behind sign-in has been untested for the whole life of this
 * project, for one mechanical reason: the routes need a Supabase session, and
 * mounting the components instead failed in the bundler on `server-only`. The
 * stub plugin in `fixtures/build.ts` removes that reason, so the editor now
 * runs here with its real store, autosave, shortcuts and canvas.
 *
 * The assertions are chosen around the failure this repository actually keeps
 * having, which `AGENTS.md` states as a rule: **a local edit that marks nothing
 * dirty is not saved**. Section renames shipped broken for an entire release
 * because the store updated, the screen looked right, and autosave was never
 * told. That defect is invisible to a screenshot, invisible to a unit test of
 * the reducer, and invisible in jsdom — it only appears once the store, the
 * autosave hook and the component tree are running at once, which is here.
 */

const ENTRY = "tests/e2e/fixtures/editor-mount.tsx";

let bundled: Promise<string> | null = null;
const fixtureUrl = () => (bundled ??= bundleFixture(ENTRY));

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  await page.goto(await fixtureUrl());
  await page.waitForSelector("body[data-ready=true]", { state: "attached" });
  await page.evaluate(() => window.editorFixture.mount());
  return problems;
}

test.describe("the editor", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("mounts the real editor without a session and without errors", async ({ page }) => {
    const problems = await open(page);

    // Something from the deck has to be on screen. Waiting on a bare selector
    // would pass against an empty shell that mounted and rendered nothing.
    await expect(page.getByText("The opening claim").first()).toBeVisible({ timeout: 20_000 });

    // StrictMode double-invokes effects, so a hook that is not idempotent —
    // the camera teardown bug in `AGENTS.md` was one — surfaces here.
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("a scene edit marks the scene dirty, so autosave has a reason to look", async ({ page }) => {
    await open(page);
    await expect(page.getByText("The opening claim").first()).toBeVisible({ timeout: 20_000 });

    const before = await page.evaluate(() => window.editorFixture.dirty());
    expect(before.dirtyScenes, "a freshly loaded deck is not dirty").toEqual([]);

    const after = await page.evaluate(() => window.editorFixture.renameSection("Overture"));

    // The rename must land in the store *and* in `dirtySections`. Asserting
    // only the first is precisely the mistake that shipped: the label was
    // updated, the sidebar showed it, and the reload showed the old one.
    expect(after.dirtySections, "renaming a movement must mark it dirty").toHaveLength(1);
  });

  test("undo marks what it reverted, or the revert is lost too", async ({ page }) => {
    await open(page);
    await expect(page.getByText("The opening claim").first()).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => window.editorFixture.renameSection("Overture"));
    const afterEdit = await page.evaluate(() => window.editorFixture.dirty());
    expect(afterEdit.dirtySections).toHaveLength(1);

    // Undo is a mutation like any other. An undo that reverts the store without
    // marking the reverted rows leaves the *old* value on screen and the *new*
    // one in the database — the same bug, pointing the other way.
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate(() => window.editorFixture.dirty());
    expect(afterUndo.dirtySections, "undo must mark what it reverted").toHaveLength(1);
  });
});
