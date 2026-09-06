import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The landing page's live demo, in a real browser.
 *
 * The unit tests prove the moves; this proves the mount — the whole
 * presentation engine inside a scrolling page, with the atmosphere's WebGL
 * and the camera's frame loop — raises no console error, and that its keys
 * are scoped to the focused stage rather than the page.
 */

const ENTRY = "tests/e2e/fixtures/live-demo-mount.tsx";

let pageUrl: Promise<string> | null = null;

function fixtureUrl(): Promise<string> {
  pageUrl ??= bundleFixture(ENTRY);
  return pageUrl;
}

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.goto(await fixtureUrl());
  await page.evaluate(() => window.liveDemoFixture.mount());
  await page.waitForSelector("[data-view]");
  return problems;
}

test.describe("the live demo", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("mounts the real world without errors and answers keys only when focused", async ({
    page,
  }) => {
    const problems = await open(page);
    const where = page.locator('[aria-live="polite"]');
    // It opens wide, as the stage does, then dives to scene one on its own.
    expect(await page.evaluate(() => window.liveDemoFixture.firstView())).toBe("opening");
    await expect(where).toContainText("Scene 1 of");
    await expect(page.locator("[data-view]")).not.toHaveAttribute("data-opening", "");

    // A key on the page, with nothing focused: the demo must not move.
    await page.keyboard.press("ArrowRight");
    await expect(where).toContainText("Scene 1 of");

    // Focus the stage and walk far enough to leave scene one.
    await page.locator("[data-view]").focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.press("ArrowRight");
    await expect(where).not.toContainText("Scene 1 of");

    await page.keyboard.press("o");
    await expect(page.locator("[data-view]")).toHaveAttribute("data-view", "world");

    // The camera loop has had time to run; nothing it did was an error.
    await page.waitForTimeout(800);
    expect(problems).toEqual([]);
  });
});
