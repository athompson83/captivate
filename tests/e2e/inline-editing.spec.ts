import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * Typing into a scene element on the editor canvas.
 *
 * The editable node is a `contentEditable` whose `onInput` writes to the store
 * on every keystroke — so the element changes on every keystroke, and so does
 * the text derived from it. While React rendered that text as a child, it
 * diffed against its own previous virtual text rather than against the DOM the
 * author had just typed into: it replaced the text node, and the caret
 * collapsed to the start. The second character of any edit landed in front of
 * the first.
 *
 * Nothing short of a browser can see that. jsdom implements neither
 * `innerText` — which `commitText` reads — nor a caret, so a component test
 * would assert on `undefined` and pass either way.
 */

const ENTRY = "tests/e2e/fixtures/inline-edit-mount.tsx";

let pageUrl: Promise<string> | null = null;

function fixtureUrl(): Promise<string> {
  pageUrl ??= bundleFixture(ENTRY);
  return pageUrl;
}

async function open(page: Page, seed = ""): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  await page.goto(await fixtureUrl());
  await page.evaluate((s) => window.inlineEditFixture.mount(s), seed);
  await page.waitForSelector('[role="textbox"]');
  return problems;
}

const stored = (page: Page) => page.evaluate(() => window.inlineEditFixture.storedText());
const shown = (page: Page) => page.evaluate(() => window.inlineEditFixture.domText());

test.describe("inline editing", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  test("types characters in the order they were pressed", async ({ page }) => {
    const problems = await open(page);

    // Three characters is the whole test. One always worked; the caret was
    // sent back to the start before the second arrived, so "abc" came out
    // reversed — and nobody could write a heading.
    await page.keyboard.type("abc");

    expect(await stored(page), "the store holds the text in the wrong order").toBe("abc");
    expect(await shown(page)).toBe("abc");
    expect(problems).toEqual([]);
  });

  test("appends to text that was already there", async ({ page }) => {
    // The caret is placed at the end when editing begins, so this is a plain
    // continuation — and it also proves the seeded text survived the mount.
    const problems = await open(page, "Sepsis");

    expect(await shown(page)).toBe("Sepsis");
    await page.keyboard.type(" kills");

    expect(await stored(page)).toBe("Sepsis kills");
    expect(problems).toEqual([]);
  });

  test("keeps a longer edit intact", async ({ page }) => {
    const problems = await open(page);
    const sentence = "Recognise it before the blood pressure falls";

    await page.keyboard.type(sentence);

    expect(await stored(page)).toBe(sentence);
    expect(problems).toEqual([]);
  });
});
