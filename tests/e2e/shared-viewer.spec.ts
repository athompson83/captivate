import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * A share link opens for someone with no account, no session and no server —
 * so the viewer is exercised the same way: a bundle opened from the file
 * system, driven only by the keys a link-holder has.
 *
 * The deck under the viewer is the shipped worked example, which makes this
 * double as the render test for the one deck every new user is invited to
 * open first.
 */

const ENTRY = "tests/e2e/fixtures/shared-viewer-mount.tsx";

let pageUrl: Promise<string> | null = null;

function fixtureUrl(): Promise<string> {
  pageUrl ??= bundleFixture(ENTRY);
  return pageUrl;
}

async function open(page: Page): Promise<{ problems: string[]; sceneCount: number }> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  await page.goto(await fixtureUrl());
  const sceneCount = await page.evaluate(() => window.sharedViewerFixture.mount());
  await page.waitForSelector("[data-view]");
  return { problems, sceneCount };
}

const status = (page: Page) => page.locator('[aria-live="polite"]');
const view = (page: Page) => page.locator("[data-view]").getAttribute("data-view");

test.describe("shared viewer", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("mounts the worked example without errors and starts on scene one", async ({ page }) => {
    const { problems, sceneCount } = await open(page);
    expect(sceneCount).toBeGreaterThanOrEqual(10);
    await expect(status(page)).toContainText(`Scene 1 of ${sceneCount}`);
    expect(await view(page)).toBe("scene");
    expect(problems).toEqual([]);
  });

  test("keys walk the whole deck and the last press pulls back to the world", async ({
    page,
  }) => {
    const { problems, sceneCount } = await open(page);

    // Enough presses for every scene and every build step the deck contains.
    for (let i = 0; i < sceneCount * 4; i += 1) {
      await page.keyboard.press("ArrowRight");
      if ((await view(page)) === "world") break;
    }

    expect(await view(page)).toBe("world");
    await expect(status(page)).toContainText(`Scene ${sceneCount} of ${sceneCount}`);

    // Back from the closing image returns to the final scene, not past it.
    await page.keyboard.press("ArrowLeft");
    expect(await view(page)).toBe("scene");
    await expect(status(page)).toContainText(`Scene ${sceneCount} of ${sceneCount}`);

    expect(problems).toEqual([]);
  });

  test("O toggles the overview from anywhere", async ({ page }) => {
    const { problems } = await open(page);

    await page.keyboard.press("o");
    expect(await view(page)).toBe("world");
    await page.keyboard.press("o");
    expect(await view(page)).toBe("scene");

    expect(problems).toEqual([]);
  });
});
