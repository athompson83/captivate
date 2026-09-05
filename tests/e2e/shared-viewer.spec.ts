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

async function open(
  page: Page,
  variant: "mount" | "mountWithAside" = "mount",
  settled = true,
): Promise<{ problems: string[]; sceneCount: number }> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  await page.goto(await fixtureUrl());
  const sceneCount = await page.evaluate((which) => window.sharedViewerFixture[which](), variant);
  await page.waitForSelector("[data-view]");
  // Every deck opens wide for a beat; most of these start once it has landed.
  if (settled) await page.waitForSelector("[data-view]:not([data-opening])");
  return { problems, sceneCount };
}

const status = (page: Page) => page.locator('[aria-live="polite"]');
const view = (page: Page) => page.locator("[data-view]").getAttribute("data-view");

test.describe("shared viewer", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("mounts the worked example without errors, opens wide, and lands on scene one", async ({
    page,
  }) => {
    const { problems, sceneCount } = await open(page, "mount", false);
    expect(sceneCount).toBeGreaterThanOrEqual(10);

    // The opening beat: the whole argument first, then the dive. Read from
    // inside the page, because the beat is shorter than our round trips.
    expect(await page.evaluate(() => window.sharedViewerFixture.firstView())).toBe("opening");
    const stage = page.locator("[data-view]");
    await expect(stage).toHaveAttribute("data-view", "scene");
    await expect(stage).not.toHaveAttribute("data-opening", "");

    await expect(status(page)).toContainText(`Scene 1 of ${sceneCount}`);
    expect(problems).toEqual([]);
  });

  test("keys walk the whole deck and the last press pulls back to the world", async ({ page }) => {
    const { problems, sceneCount } = await open(page);

    // A real key first, so the walk below is not the only evidence that
    // trusted input reaches the handler at all.
    await page.keyboard.press("ArrowRight");
    expect(await view(page)).toBe("scene");

    const presses = await page.evaluate(
      (cap) => window.sharedViewerFixture.walk("ArrowRight", cap),
      sceneCount * 4,
    );
    expect(presses, "never reached the pulled-back view").not.toBeNull();

    expect(await view(page)).toBe("world");
    await expect(status(page)).toContainText(`Scene ${sceneCount} of ${sceneCount}`);
    // The closing image is named after the deck.
    await expect(page.locator("[data-closing]")).toBeVisible();

    // Back from the closing image returns to the final scene, not past it.
    await page.keyboard.press("ArrowLeft");
    expect(await view(page)).toBe("scene");
    await expect(page.locator("[data-closing]")).toHaveCount(0);
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

  test.describe("asides", () => {
    test("the linear walk steps over the detail scene", async ({ page }) => {
      const { problems, sceneCount } = await open(page, "mountWithAside");

      // The deck has one more scene than the running order it reports.
      await expect(status(page)).toContainText(`Scene 1 of ${sceneCount}`);

      const presses = await page.evaluate(
        (cap) => window.sharedViewerFixture.walk("ArrowRight", cap),
        (sceneCount + 1) * 4,
      );
      expect(presses).not.toBeNull();

      // Walking to the end never entered the aside: the reader who never
      // clicked the hotspot saw only the argument.
      await expect(status(page)).not.toContainText("Detail");
      await expect(status(page)).toContainText(`Scene ${sceneCount} of ${sceneCount}`);
      expect(problems).toEqual([]);
    });

    test("the keyboard dives into an aside without advancing back out of it", async ({ page }) => {
      const { problems } = await open(page, "mountWithAside");

      const hotspot = page.getByRole("button", { name: /^Expand: / });
      await expect(hotspot).toBeVisible();

      // The bug this pins: Enter both activates the focused button and is a
      // global "next", so the dive and the advance out of it landed in one
      // keystroke and the reader saw nothing change.
      await hotspot.focus();
      await page.keyboard.press("Enter");
      await expect(status(page)).toContainText("Detail: The aside");
      expect(await view(page)).toBe("scene");

      // And the way out is the next press, once focus has left the control.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("ArrowRight");
      await expect(status(page)).not.toContainText("Detail");

      expect(problems).toEqual([]);
    });

    test("Space activates a hotspot without advancing either", async ({ page }) => {
      const { problems } = await open(page, "mountWithAside");

      await page.getByRole("button", { name: /^Expand: / }).focus();
      await page.keyboard.press("Space");
      await expect(status(page)).toContainText("Detail: The aside");

      expect(problems).toEqual([]);
    });
  });
});
