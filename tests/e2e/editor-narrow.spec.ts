import { expect, test, type Page } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The editor on a screen too narrow for its panels.
 *
 * `docs/DESIGN.md` has always said the navigator collapses and the inspector
 * stops taking width from the canvas on narrow screens. Neither happened. At
 * 390px the navigator asked for 212px and the inspector for another 272px — 484
 * of 390 — the scene was rendered **96px wide**, and twelve controls were
 * pushed as far as 158px past the right edge of a shell that is
 * `overflow-hidden`, so nothing could scroll to reach them. Present, Share and
 * the theme picker were on the page and could not be operated.
 *
 * The editor's own loading skeleton hid the sidebar with `hidden md:block`, so
 * the placeholder already described the layout the real components did not
 * implement. That is the shape of this whole spec: not a new opinion about
 * phones, but the documented behaviour, asserted.
 *
 * The strongest assertion here is the general one — **nothing may extend past
 * the right edge** — because it does not depend on which control happens to be
 * last in the header today. It fails against every defect listed above.
 *
 * jsdom cannot answer any of it: this is entirely about measured geometry
 * under a real layout engine at a real viewport size, which is what the
 * `lifecycle` project exists for.
 */

const ENTRY = "tests/e2e/fixtures/editor-mount.tsx";

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
  await page.waitForSelector("body[data-ready=true]", { state: "attached" });
  await page.evaluate(() => window.editorFixture.mount());
  await expect(page.getByRole("banner").or(page.locator("header")).first()).toBeVisible();
  return problems;
}

/**
 * Everything whose right edge is outside the window.
 *
 * A pixel of tolerance because a fractional layout width rounds either way and
 * a half-pixel is not a control anybody has lost.
 */
async function offscreen(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1;
      })
      .map((el) => `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}">`)
      .slice(0, 8),
  );
}

/** The widest rendered stage: the canvas one, rather than a navigator thumbnail. */
async function sceneWidth(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll("[data-stage]")].map(
        (el) => el.getBoundingClientRect().width,
      ),
    ),
  );
}

async function selectTheHeading(page: Page): Promise<void> {
  await page.locator("text=The opening claim").last().click({ force: true });
  await expect(page.getByRole("complementary", { name: "Element inspector" })).toBeVisible();
}

test.describe("the editor on a narrow screen", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await fixtureUrl();
  });

  for (const width of [320, 390]) {
    test(`nothing is pushed out of reach at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await open(page, width, 780);

      expect(await offscreen(page), "with nothing selected").toEqual([]);

      // Selecting is what used to summon the second 272px panel, and with it
      // the floating toolbar — which is 389px wide in one row and therefore
      // cannot be placed anywhere inside a 320px window without wrapping.
      await selectTheHeading(page);
      expect(await offscreen(page), "with an element selected").toEqual([]);

      // All three views, because the editor is three surfaces sharing a
      // header and each can lose a control off the side on its own. The
      // narrative map did: its header row wrapped but the controls inside it
      // did not, so the cluster stayed one 476px line and **Generate scenes**
      // — the whole point of the map gate — sat 86px past the right edge of a
      // pane with no sideways scroll.
      for (const view of ["Narrative", "Journey", "Scene"]) {
        await page.getByRole("radio", { name: view }).click();
        await expect(page.getByRole("radio", { name: view })).toHaveAttribute(
          "aria-checked",
          "true",
        );
        expect(await offscreen(page), `in the ${view} view`).toEqual([]);
      }

      expect(problems).toEqual([]);
    });
  }

  test("the map gate's own button is on the screen", async ({ page }) => {
    await open(page, 390, 780);
    await page.getByRole("radio", { name: "Narrative" }).click();

    // Named rather than left to the general rule above, because this is the
    // one control the whole narrative view exists to offer: review the
    // argument, then generate from it.
    const generate = page.getByRole("button", { name: "Generate scenes" });
    await expect(generate).toBeInViewport({ ratio: 1 });
  });

  test("the navigator collapses rather than taking half the window", async ({ page }) => {
    await open(page, 390, 780);

    // Not merely narrower — absent from the row. It was 212px of 390.
    const nav = page.getByRole("complementary", { name: "Scenes" });
    await expect(nav).toBeHidden();

    // The measurement that made this worth fixing: the scene came out 96px
    // wide, which is a thumbnail rather than something you can edit on.
    expect(await sceneWidth(page)).toBeGreaterThan(240);
  });

  test("opening the navigator covers the canvas instead of shrinking it", async ({ page }) => {
    await open(page, 390, 780);
    const before = await sceneWidth(page);

    await page.getByRole("button", { name: "Show scene navigator" }).click();
    const nav = page.getByRole("complementary", { name: "Scenes" });
    await expect(nav).toBeVisible();

    // Same scene, same size: the panel is over the canvas, not beside it.
    expect(await sceneWidth(page)).toBeCloseTo(before, 0);

    // And choosing a scene puts the canvas back, because the panel is standing
    // in front of the thing it just navigated to.
    await page.getByRole("button", { name: "Scene 2: Second" }).click();
    await expect(nav).toBeHidden();
  });

  test("the inspector takes height, not the canvas's width", async ({ page }) => {
    await open(page, 390, 780);
    await selectTheHeading(page);

    const inspector = page.getByRole("complementary", { name: "Element inspector" });
    const box = await inspector.boundingBox();
    expect(box).not.toBeNull();
    // Full width at the bottom rather than a 272px column: a column left the
    // scene 96px wide, and a sheet floating over the canvas hid the element
    // being styled, which is the one thing you are looking at while styling it.
    expect(box!.width).toBeGreaterThan(360);
    expect(await sceneWidth(page)).toBeGreaterThan(240);

    // A sheet needs a way out that is not "guess that the canvas deselects".
    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(inspector).toBeHidden();
  });

  test("a scene row says which scene it is", async ({ page }) => {
    await open(page, 1440, 900);

    // The accessible name used to be the ordinal run into whatever text the
    // thumbnail drew — "1The opening claim" — so a scene whose stage is a
    // photograph announced as a bare digit, and the author's own title for it
    // was nowhere in the name at all.
    await expect(page.getByRole("button", { name: "Scene 1: First" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Scene 2: Second" })).toBeVisible();
  });

  test("the save state is still a sentence something can announce", async ({ page }) => {
    await open(page, 390, 780);

    // `UX.md`: save state is a sentence, not a spinner. Below `lg` the sentence
    // carried `hidden`, which is `display: none` — still in the DOM, and so
    // still in `textContent`, but *not* in the accessibility tree. This
    // `aria-live` region therefore had nothing to announce, and the only thing
    // left on screen was a cloud icon that is itself `aria-hidden`.
    //
    // Visibility is the assertion, not text: an element `display: none` is not
    // visible and not announced, while the `sr-only` replacement is both
    // announced and — being a 1px clipped box rather than `display: none` —
    // visible to this check. Asserting `toHaveText` on the region passes either
    // way and proves nothing, which is how the first version of this test came
    // to pass against the defect it was written for.
    const status = page.getByRole("status");
    await expect(status.getByText("All changes saved")).toBeVisible();

    // And a failure is the one state that must be legible without a screen
    // reader too, so it is never reduced to the icon.
    await page.evaluate(() => window.editorFixture.setSaveState("error", "Network unreachable"));
    await expect(status.getByText("Couldn't save")).toBeInViewport();
  });

  test("the folded-away controls keep the roles they actually have", async ({ page }) => {
    await open(page, 390, 780);
    await page.getByRole("button", { name: "More editor controls" }).click();

    // The popover holds toggle buttons and a theme radiogroup. It was marked
    // `role="menu"` with `menuitemradio` themes inside, which is not a
    // structure that exists: a menu may only contain menu items, so the
    // aspect-ratio radiogroup beside them had no valid place at all and a
    // screen reader was handed a broken tree.
    //
    // Asserting by role is the point — these queries only match if the
    // semantics are the ones the controls really have.
    await expect(page.getByRole("radio", { name: /Midnight/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Toggle AI assistant" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
    expect(await page.locator('[role="menu"]').count()).toBe(0);
  });

  test("dismissing a popover puts the keyboard back where it was", async ({ page }) => {
    await open(page, 390, 780);

    const trigger = page.getByRole("button", { name: "More editor controls" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    // Tab *into* the popover first. This is the step that makes the test mean
    // anything: opening it leaves focus on the trigger, so an Escape pressed
    // straight afterwards has nothing to restore and passes against the
    // defect. The first version of this test did exactly that, and stayed
    // green with the whole fix removed.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Toggle notes" })).toBeFocused();

    // Escape then dropped focus on `body`, so the next Tab restarted at the
    // top of the document and a keyboard user lost their place. `Dialog` has
    // restored focus since #41; `Popover` had the same hole, and every menu in
    // the editor goes through it — this one most of all, since on a narrow
    // screen it is the only way to reach half the header.
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();

    // Dismissing by clicking something else leaves focus on what was clicked.
    // Stated as behaviour worth holding rather than as proof of the `stranded`
    // guard beside it: the click focuses its own target after the popover has
    // already closed, so this passes with or without that guard. The guard is
    // there for focus that has deliberately moved elsewhere, which this
    // fixture has no way to produce.
    await trigger.click();
    const elsewhere = page.getByRole("button", { name: /scene navigator/ });
    await elsewhere.click();
    await expect(elsewhere).toBeFocused();
  });

  test("the selection toolbar follows the stage across a resize", async ({ page }) => {
    // A short, wide window on purpose. `fitScale` takes the smaller of the two
    // fits, so here the stage is bound by height — and a width-only resize
    // then moves it sideways while leaving `scale` exactly as it was.
    //
    // That distinction is the whole test. `scale` is a dependency of the
    // effect that places this toolbar, so any resize that changes it re-runs
    // the effect and re-reads the stage no matter where the read lives. An
    // earlier version of this test resized 1440→900, which does change
    // `scale`, and passed against the defect it was written for.
    await open(page, 1400, 500);
    await selectTheHeading(page);

    // How far the toolbar's centre sits from the stage's centre. The selection
    // is the full-width heading, so the two should coincide; what matters is
    // that the offset does not grow when the window changes size.
    const drift = () =>
      page.evaluate(() => {
        const bar = document.querySelector('[role="toolbar"][aria-label="Selection actions"]');
        const stage = [...document.querySelectorAll("[data-stage]")].sort(
          (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width,
        )[0];
        if (!bar || !stage) return Number.NaN;
        const b = bar.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        return Math.abs((b.left + b.right) / 2 - (s.left + s.right) / 2);
      });

    expect(await drift()).toBeLessThan(8);

    // A resize moves the stage without changing `scale` — the canvas refits
    // and re-centres. Reading the stage once, outside the resize handler, left
    // the toolbar correctly clamped to the new window and anchored to where
    // the selection used to be.
    const scaleBefore = await page.evaluate(
      () => document.querySelector("[data-stage]")?.getBoundingClientRect().height ?? 0,
    );

    await page.setViewportSize({ width: 1300, height: 500 });
    await page.waitForTimeout(400);

    // Same height means same scale, which is what makes this the case the
    // effect's dependencies cannot catch.
    expect(
      await page.evaluate(
        () => document.querySelector("[data-stage]")?.getBoundingClientRect().height ?? 0,
      ),
    ).toBeCloseTo(scaleBefore, 0);
    expect(await drift()).toBeLessThan(8);
  });

  test("the wide layout is untouched", async ({ page }) => {
    await open(page, 1440, 900);

    const nav = page.getByRole("complementary", { name: "Scenes" });
    await expect(nav).toBeVisible();
    expect((await nav.boundingBox())!.width).toBeCloseTo(212, 0);

    const wide = await sceneWidth(page);
    await selectTheHeading(page);

    const inspector = page.getByRole("complementary", { name: "Element inspector" });
    expect((await inspector.boundingBox())!.width).toBeCloseTo(272, 0);
    // Beside the canvas, so the scene gives up room for it — which is the
    // desktop behaviour and is deliberately not what happens on a phone.
    expect(await sceneWidth(page)).toBeLessThan(wide);

    expect(await offscreen(page)).toEqual([]);
  });
});
