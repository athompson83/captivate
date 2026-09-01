import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * Whether a keyboard can get out of a modal.
 *
 * `Dialog` traps Tab by wrapping at either end: on the first focusable a
 * Shift+Tab goes to the last, on the last a Tab goes to the first. That covers
 * the two cases a trap is usually written for and misses the one a person
 * actually produces — focus on nothing.
 *
 * Clicking a dialog's title, its description or the prose in its body moves
 * focus to `body`. `document.activeElement` is then neither the first
 * focusable nor the last, both branches fall through, and the browser's own
 * sequential navigation takes over from the clicked node: out of the panel and
 * into the page behind it, which `aria-modal="true"` describes as unavailable
 * and nothing was making so.
 *
 * Which direction leaks depends on where that prose sits, so both variants of
 * the fixture are needed and neither test subsumes the other:
 *
 * - prose above the panel's last control → **Shift+Tab** is the way out;
 * - prose below it → **Tab** is the way out, and `ShortcutsDialog` is exactly
 *   that shape: a page of prose whose only focusable is the close button above
 *   it.
 *
 * Note that this needs a real click and not a programmatic `blur()`. Chromium
 * resumes tabbing from the sequential focus navigation starting point, which a
 * click moves to the clicked node and a `blur()` leaves on the element that was
 * focused — so a blur-based version of these tests passes against the unfixed
 * code while proving nothing.
 *
 * jsdom cannot answer any of it — it has no real sequential focus navigation —
 * and an axe scan will not either, because the markup is correct and the
 * behaviour is what is wrong. It needs a real browser with real tabbable
 * content behind a real modal, which is what the `lifecycle` project is for.
 */

const ENTRY = "tests/e2e/fixtures/dialog-mount.tsx";

let pageUrl: Promise<string> | null = null;

function fixtureUrl(): Promise<string> {
  pageUrl ??= bundleFixture(ENTRY);
  return pageUrl;
}

/** The footer-less variant, from the same bundle. */
async function noFooterUrl(): Promise<string> {
  return `${await fixtureUrl()}?nofooter`;
}

/** The variant whose marked control, and whose last control, are disabled. */
async function disabledUrl(): Promise<string> {
  return `${await fixtureUrl()}?disabled`;
}

test.describe("the dialog's focus trap", () => {
  test("opens with focus on the marked control, not the first one", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(await fixtureUrl());

    // Proves the fixture mounted before anything is concluded from it.
    await expect(page.getByRole("dialog")).toBeVisible();

    // `data-autofocus` marks Cancel. Asking for it in one selector list with
    // the fallbacks returned whichever matched first in *document* order — the
    // close button in the header — so the marker did nothing at all.
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("keeps Tab inside when focus is on a real control", async ({ page }) => {
    await page.goto(await fixtureUrl());
    await expect(page.getByRole("dialog")).toBeVisible();

    // Round the whole cycle twice: every stop must be inside the panel.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => window.focusInsideDialog()), `after ${i + 1} tabs`).toBe(
        true,
      );
    }
  });

  test("a click on the prose does not let Shift+Tab reach the page behind", async ({ page }) => {
    await page.goto(await fixtureUrl());
    await expect(page.getByRole("dialog")).toBeVisible();

    // Clicking a dialog's own description is an ordinary thing to do.
    await page.locator('[role="dialog"] p').first().click();
    expect(await page.evaluate(() => window.focusLabel())).toBe("(body)");

    await page.keyboard.press("Shift+Tab");

    const label = await page.evaluate(() => window.focusLabel());
    expect(
      await page.evaluate(() => window.focusInsideDialog()),
      `Shift+Tab from nothing escaped the modal and landed on "${label}"`,
    ).toBe(true);
  });

  test("a click below the last control does not let Tab reach the page behind", async ({
    page,
  }) => {
    await page.goto(await noFooterUrl());
    await expect(page.getByRole("dialog")).toBeVisible();

    // Inside the panel, below every control, and not on one: the shape of a
    // shortcut sheet or a share dialog being read rather than operated.
    await page.locator("[data-prose]").click({ position: { x: 8, y: 80 } });
    expect(await page.evaluate(() => window.focusLabel())).toBe("(body)");

    await page.keyboard.press("Tab");

    const label = await page.evaluate(() => window.focusLabel());
    expect(
      await page.evaluate(() => window.focusInsideDialog()),
      `Tab from nothing escaped the modal and landed on "${label}"`,
    ).toBe(true);
  });
  test("opens with focus on a control that can take it", async ({ page }) => {
    // `data-autofocus` marks a disabled Cancel here. Honouring the marker
    // without checking it can be focused opens the dialog with focus on
    // nothing — which is both the state the trap is worst at and the one this
    // whole spec is about.
    await page.goto(await disabledUrl());
    await expect(page.getByRole("dialog")).toBeVisible();

    expect(await page.evaluate(() => window.focusLabel())).not.toBe("(body)");
    expect(await page.evaluate(() => window.focusInsideDialog())).toBe(true);
  });

  test("does not strand the keyboard on a control that cannot take focus", async ({ page }) => {
    // The panel's last focusable-by-selector control is disabled, so a
    // Shift+Tab redirected to it moves nothing — and because the keydown was
    // already prevented, every subsequent Shift+Tab does the same. Stuck is a
    // worse outcome than the escape, because nothing on screen changes to say
    // the keyboard has stopped working.
    await page.goto(await disabledUrl());
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.locator('[role="dialog"] p').first().click();
    expect(await page.evaluate(() => window.focusLabel())).toBe("(body)");

    await page.keyboard.press("Shift+Tab");

    const label = await page.evaluate(() => window.focusLabel());
    expect(await page.evaluate(() => window.focusInsideDialog()), `landed on "${label}"`).toBe(
      true,
    );
  });
});
