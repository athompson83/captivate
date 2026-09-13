import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The notes workspace, in a real browser at a real size.
 *
 * Mounted alone (`fixtures/notes-mount.tsx`) its header can be measured:
 * whether the note's title, the one thing the pane is for, keeps its width
 * beside the controls on a phone.
 */

const ENTRY = "tests/e2e/fixtures/notes-mount.tsx";

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
  await page.evaluate(() => window.notesFixture.mount());
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeVisible();
  return problems;
}

test.describe("the notes workspace", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("keeps the note's title on a phone", async ({ page }) => {
    const problems = await open(page, 390, 844);
    const title = page.getByRole("textbox", { name: "Note title" });
    const del = page.getByRole("button", { name: "Delete note" });

    // The header row wrapped, but the title shrank first: at 390px it was
    // 70px wide — "Why att" — beside the picker, the deck link and delete.
    // Under its floor the controls take a row of their own instead.
    const t = (await title.boundingBox())!;
    const d = (await del.boundingBox())!;
    expect(t.width).toBeGreaterThanOrEqual(180);
    expect(d.y).toBeGreaterThan(t.y + t.height - 1);
    expect(d.x + d.width).toBeLessThanOrEqual(391);
    expect(problems).toEqual([]);
  });

  test("keeps the controls beside the title on a desktop", async ({ page }) => {
    await open(page, 1440, 900);
    const t = (await page.getByRole("textbox", { name: "Note title" }).boundingBox())!;
    const d = (await page.getByRole("button", { name: "Delete note" }).boundingBox())!;
    // One row: the delete button's centre is within the title's height.
    expect(Math.abs(d.y + d.height / 2 - (t.y + t.height / 2))).toBeLessThan(t.height);
  });
});
