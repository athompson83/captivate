import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * Placing the presenter on the stage, in a real browser.
 *
 * "users also need a way to resize their camera feed" — and the code to do it
 * was already there. What was missing was any way to find it: the handle was
 * fully transparent until the pointer was inside a 20px target hanging
 * outside the corner, and the drag it then performed added only the
 * *horizontal* component of the movement, so pulling the corner straight down
 * did nothing. A unit test on the handler would have passed on both counts.
 *
 * Chromium's fake capture device stands in for a camera, so this needs no
 * hardware, no server and no account.
 */

const ENTRY = "tests/e2e/fixtures/presenter-camera-mount.tsx";

let pageUrl: Promise<string> | null = null;
function fixtureUrl(): Promise<string> {
  pageUrl ??= bundleFixture(ENTRY);
  return pageUrl;
}

interface Settings {
  x: number;
  y: number;
  size: number;
}

async function settings(page: Page): Promise<Settings> {
  return page.evaluate(() => {
    const s = window.cameraSettings();
    return { x: s.x, y: s.y, size: s.size };
  });
}

async function openFixture(page: Page) {
  await page.goto(await fixtureUrl());
  await expect(page.getByRole("group", { name: /Presenter camera/i })).toBeVisible();
  // The feed only has a rect once the stream is attached.
  await page.waitForFunction(
    () => {
      const video = document.querySelector("video");
      return Boolean(video && video.videoWidth > 0);
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** A pointer press, move and release — pointer capture needs all three. */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2);
  await page.mouse.move(from.x + dx, from.y + dy);
  await page.mouse.up();
}

test.describe("the presenter camera on the stage", () => {
  test("opens exactly one camera track", async ({ page }) => {
    await openFixture(page);
    // Two is the shape of the defect the presenter saw in their recording:
    // themselves, twice, overlapping.
    expect(await page.evaluate(() => window.videoTracksOpened)).toBe(1);
  });

  test("the resize handle is visible without hunting for it", async ({ page }) => {
    await openFixture(page);
    const handle = page.getByRole("button", { name: "Resize presenter camera" });
    await expect(handle).toBeVisible();

    // It was `opacity-0` until hovered, so it was unfindable rather than
    // merely subtle. Anything above zero can be seen; hovering the feed —
    // not the handle — brings it fully up.
    const resting = await handle.evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(resting).toBeGreaterThan(0.15);

    await page.getByRole("group", { name: /Presenter camera/i }).hover();
    await expect
      .poll(async () => handle.evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeGreaterThan(0.95);
  });

  test("drags to a new position", async ({ page }) => {
    await openFixture(page);
    const before = await settings(page);
    const box = (await page.getByRole("group", { name: /Presenter camera/i }).boundingBox())!;
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, -180, -90);

    const after = await settings(page);
    expect(after.x).toBeLessThan(before.x - 0.1);
    expect(after.y).toBeLessThan(before.y - 0.1);
    expect(after.size).toBeCloseTo(before.size, 5);
  });

  test("cannot be dragged off the stage", async ({ page }) => {
    await openFixture(page);
    const box = (await page.getByRole("group", { name: /Presenter camera/i }).boundingBox())!;
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 900, 500);

    const after = await settings(page);
    expect(after.x + after.size / 2).toBeLessThanOrEqual(1.0001);
    const stage = (await page.locator("#stage").boundingBox())!;
    const feed = (await page.getByRole("group", { name: /Presenter camera/i }).boundingBox())!;
    expect(feed.x + feed.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(feed.y + feed.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  });

  test("resizes from the corner, including straight down", async ({ page }) => {
    await openFixture(page);
    const before = await settings(page);
    const handle = page.getByRole("button", { name: "Resize presenter camera" });
    const box = (await handle.boundingBox())!;

    // Purely vertical: the previous implementation ignored this entirely.
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 0, 90);
    const after = await settings(page);
    expect(after.size).toBeGreaterThan(before.size + 0.05);
  });

  test("resizes down to the minimum and no further", async ({ page }) => {
    await openFixture(page);
    const handle = page.getByRole("button", { name: "Resize presenter camera" });
    const box = (await handle.boundingBox())!;
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, -400, -400);
    expect((await settings(page)).size).toBeCloseTo(0.08, 5);
  });

  test("moves and resizes from the keyboard", async ({ page }) => {
    await openFixture(page);
    const feed = page.getByRole("group", { name: /Presenter camera/i });
    await feed.focus();
    const before = await settings(page);

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect((await settings(page)).x).toBeCloseTo(before.x - 0.04, 5);

    await page.keyboard.press("Shift+ArrowRight");
    expect((await settings(page)).size).toBeCloseTo(before.size + 0.02, 5);
  });

  test("shows the raw feed when background removal cannot load", async ({ page }) => {
    await openFixture(page);
    // A file:// fixture has no network, so the segmenter's model never
    // arrives. The presenter must still be visible: a missing nicety cannot
    // cost them their face on the stage.
    await page.evaluate(() => window.setBackground("remove"));
    await page.waitForTimeout(1200);
    const visible = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!video) return false;
      const style = getComputedStyle(video);
      return style.visibility !== "hidden" && video.videoWidth > 0;
    });
    expect(visible).toBe(true);
  });
});
