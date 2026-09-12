import { expect, test } from "@playwright/test";
import { bundleFixture } from "./fixtures/build";

/**
 * The phrase that matters, underlined by hand.
 *
 * The stroke is measured from where the phrase's line fragments land, so it
 * can only be checked where text is laid out: one stroke per line the phrase
 * wraps onto, each the width of its line and just above its bottom, sketched
 * when the scene performs and simply there when it does not.
 */

const FIXTURE = "tests/e2e/fixtures/hand-mark-mount.tsx";

let url: Promise<string> | null = null;
const fixtureUrl = () => (url ??= bundleFixture(FIXTURE));

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const mark = document.querySelector<HTMLElement>("[data-hand-mark]")!;
    const svg = document.querySelector<SVGSVGElement>("svg.hm")!;
    const host = svg.parentElement!.getBoundingClientRect();
    const rects = [...mark.getClientRects()].map((r) => ({
      x: r.left - host.left,
      width: r.width,
      bottom: r.bottom - host.top,
    }));
    const paths = [...svg.querySelectorAll<SVGPathElement>("path")].map((p) => {
      const b = p.getBBox();
      return {
        x: b.x,
        width: b.width,
        bottom: b.y + b.height,
        drawn: p.classList.contains("dp-drawn"),
        length: p.style.getPropertyValue("--dp-len"),
        strokeWidth: Number(p.getAttribute("stroke-width")),
      };
    });
    return { rects, paths, fontSize: parseFloat(getComputedStyle(mark).fontSize) };
  });
}

test.describe("the phrase that matters, underlined by hand", () => {
  test("one stroke per line the phrase wraps onto, each under its own line, sketched on arrival", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.handMark.mount(true));
    await page.waitForSelector("svg.hm path");
    await page.waitForTimeout(300);
    const { rects, paths, fontSize } = await measure(page);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    expect(paths).toHaveLength(rects.length);
    for (const [i, path] of paths.entries()) {
      expect(Math.abs(path.x - rects[i].x)).toBeLessThan(3);
      expect(Math.abs(path.width - rects[i].width)).toBeLessThan(4);
      expect(path.bottom).toBeLessThan(rects[i].bottom + 1);
      expect(path.bottom).toBeGreaterThan(rects[i].bottom - fontSize * 0.5);
      expect(path.strokeWidth).toBeCloseTo(fontSize * 0.07, 1);
      expect(path.drawn).toBe(true);
      expect(Number(path.length)).toBeGreaterThan(rects[i].width * 0.9);
    }
  });

  test("follows the words when they change under it", async ({ page }) => {
    // Codex, reviewing the PR: the mark was measured on mount and on resize,
    // so an author editing the phrase in place — or a theme changing the
    // face — left the stroke where the old words had been.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.handMark.mount(false));
    await page.waitForSelector("svg.hm path");
    const before = await measure(page);
    expect(before.rects.length).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.handMark.reword("Reassess"));
    await page.waitForFunction(() => document.querySelectorAll("svg.hm path").length === 1);
    const after = await measure(page);
    expect(after.rects).toHaveLength(1);
    expect(after.paths).toHaveLength(1);
    expect(Math.abs(after.paths[0].x - after.rects[0].x)).toBeLessThan(3);
    expect(Math.abs(after.paths[0].width - after.rects[0].width)).toBeLessThan(4);
    expect(after.paths[0].width).toBeLessThan(before.paths[0].width);
  });

  test("is simply there when the scene is not performed", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(await fixtureUrl());
    await page.evaluate(() => window.handMark.mount(false));
    await page.waitForSelector("svg.hm path");
    const { rects, paths } = await measure(page);
    expect(paths).toHaveLength(rects.length);
    expect(paths.every((p) => !p.drawn && p.length === "")).toBe(true);
  });
});
