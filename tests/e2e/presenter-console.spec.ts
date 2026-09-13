import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The presenter console, in a real browser at a real size.
 *
 * `/present/[id]/console` is the second window — notes, timers, the next
 * scene — and behind sign-in like the stage, so it had only ever been
 * rendered in jsdom, where nothing has a width. Mounted alone
 * (`fixtures/presenter-console-mount.tsx`) it can be measured: whether a
 * phone's window holds it, and whether a desktop's holds it in two columns.
 */

const ENTRY = "tests/e2e/fixtures/presenter-console-mount.tsx";

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
  await page.evaluate(() => window.presenterConsoleFixture.mount());
  await page.getByRole("region", { name: "Presenter notes" }).waitFor();
  return problems;
}

/** Right edges past the window, leaving out the filmstrip, which scrolls sideways by design. */
async function offscreen(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => !el.closest('[aria-label="All scenes"]'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
      })
      .map((el) => `<${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? ""}>`)
      .slice(0, 8),
  );
}

test.describe("the presenter console", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("fits a phone's window", async ({ page }) => {
    const problems = await open(page, 390, 844);

    // The header's one unwrapping row set the whole console's width: 600px
    // in a 390px window, every pane cut at the edge, the timers and the
    // close button off it, the notes clipped mid-sentence.
    const root = page.locator("[data-console-root]");
    expect((await root.boundingBox())!.width).toBeLessThanOrEqual(390);
    expect(await offscreen(page), "past the right edge of a 390px window").toEqual([]);
    await expect(page.getByRole("link", { name: "Close presenter console" })).toBeInViewport({
      ratio: 1,
    });
    const notes = page.getByRole("region", { name: "Presenter notes" });
    const box = (await notes.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(problems).toEqual([]);
  });

  test("stands in two columns on a desktop", async ({ page }) => {
    await open(page, 1440, 900);
    const scene = (await page.getByRole("region", { name: "Current scene" }).boundingBox())!;
    const notes = (await page.getByRole("region", { name: "Presenter notes" }).boundingBox())!;
    // Beside, not below: the notes start to the right of the scene.
    expect(notes.x).toBeGreaterThan(scene.x + scene.width - 1);
    expect(await offscreen(page)).toEqual([]);
  });
});
