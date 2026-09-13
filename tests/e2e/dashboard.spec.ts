import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The dashboard, in a real browser at a real size.
 *
 * `/presentations` is behind sign-in and a Supabase project, so the shell
 * and the library — the first thing a signed-in person sees — had only ever
 * been rendered in jsdom, where nothing has a width. Mounted alone
 * (`fixtures/dashboard-mount.tsx`) they can be measured: whether a phone's
 * window holds the cards, and whether the navigation can be reached.
 */

const ENTRY = "tests/e2e/fixtures/dashboard-mount.tsx";

let bundled: Promise<string> | null = null;
const fixtureUrl = () => (bundled ??= bundleFixture(ENTRY));

async function open(page: Page, width: number, height: number): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.setViewportSize({ width, height });
  await page.goto(await fixtureUrl());
  await page.evaluate(() => window.dashboardFixture.mount());
  await expect(page.getByRole("heading", { name: "Presentations" })).toBeVisible();
  return problems;
}

/** Everything whose right edge is past the window. */
async function offscreen(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
      })
      .map((el) => `<${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? ""}>`)
      .slice(0, 8),
  );
}

test.describe("the dashboard", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("fits a phone's window", async ({ page }) => {
    const problems = await open(page, 390, 844);

    // The library's grids left their one column implicit below `lg`, so it
    // was sized to its widest content: the cards ran past the window with
    // their right edges cut, and the folders beside them.
    expect(await offscreen(page), "past the right edge of a 390px window").toEqual([]);
    const card = page.getByRole("link", { name: /Hold the room/ }).first();
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(problems).toEqual([]);
  });

  test("opens its navigation over the page on a phone", async ({ page }) => {
    await open(page, 390, 844);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "Templates" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Templates" })).toBeInViewport({ ratio: 1 });
  });

  test("keeps its navigation beside the library on a desktop", async ({ page }) => {
    await open(page, 1440, 900);
    await expect(page.getByRole("link", { name: "Templates" })).toBeVisible();
    // More than one card per row: the grid is a grid, not a column.
    const first = (await page
      .getByRole("link", { name: /Hold the room/ })
      .first()
      .boundingBox())!;
    const second = (await page
      .getByRole("link", { name: /Sepsis/ })
      .first()
      .boundingBox())!;
    expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    expect(await offscreen(page)).toEqual([]);
  });
});
