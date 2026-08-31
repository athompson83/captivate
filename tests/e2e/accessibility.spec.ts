import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { AxeResults, NodeResult, Result, RunOptions } from "axe-core";

/**
 * WCAG 2.1 A/AA over every page somebody can reach without an account.
 *
 * `MVP-007` is written in terms of what an author actually experiences, and an
 * automated pass is only part of that — roughly the third of the success
 * criteria a machine can decide at all. It is the part that regresses silently,
 * though: an icon button shipped without a name, a form control that lost its
 * label, a heading level skipped in a refactor. None of those show up in a
 * screenshot, and all of them are cheap to catch here.
 *
 * Two viewports because the landing page reflows: a control that is reachable
 * at 1512 can be clipped, hidden or unlabelled at 390, and the mobile layout is
 * a different tree rather than the same one narrowed.
 *
 * What this deliberately does not cover, so that a green run is not read as
 * more than it is:
 *
 *   * theme contrast on the stage. axe reads a computed background colour, and
 *     every theme paints a gradient, so it answers "incomplete" rather than
 *     pass or fail. The measured guard in `tests/unit/theme-contrast.test.ts`
 *     is the evidence there;
 *   * anything behind sign-in. These routes are the ones a server without
 *     database credentials can serve, which is exactly why the smoke project
 *     can run them;
 *   * keyboard and focus order, which is a judgement about whether the path
 *     makes sense, not a rule a scanner can decide.
 */

// Resolved rather than joined onto `node_modules`, so a hoisted or deduped
// install still finds it.
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** The routes reachable with no account and no database. */
const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/sign-in",
  "/sign-up",
  "/reset-password",
  "/update-password",
] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1512, height: 950 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// axe ships its own types, so the shape of a result is not restated here — a
// local subset drifts silently the first time a field is renamed under it.
declare global {
  interface Window {
    axe: { run: (context: Document, options: RunOptions) => Promise<AxeResults> };
  }
}

async function analyse(page: Page): Promise<AxeResults> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(
    async (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
    WCAG,
  );
}

/** What a reader needs to fix it: the rule, the element, and why it failed. */
function describe(violations: Result[]): string {
  const where = (node: NodeResult) =>
    node.target
      .map((selector) => (Array.isArray(selector) ? selector.join(" ") : selector))
      .join(" ");

  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 4)
        .map((node) => {
          const why = (node.failureSummary ?? "").replace(/\s+/g, " ").trim();
          return `      ${where(node)}\n        ${node.html.slice(0, 160)}\n        ${why}`;
        })
        .join("\n");
      return `  ${violation.id} (${violation.impact ?? "unknown"}) — ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

for (const viewport of VIEWPORTS) {
  test.describe(`accessibility at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of PUBLIC_ROUTES) {
      test(`${route} has no WCAG A/AA violations`, async ({ page }) => {
        const response = await page.goto(route);

        // A scan of the wrong page passes. `goto` resolves for a redirect and
        // for an error shell alike, and an error page has no alt text to be
        // missing and no form control to be unlabelled — so it scores zero
        // violations and this test goes green while the route is broken. Three
        // of these routes have no render assertion anywhere else in the suite,
        // so nothing would have caught it. Prove the page arrived first.
        expect(response?.status(), `${route} did not respond`).toBeLessThan(400);
        expect(new URL(page.url()).pathname, `${route} redirected`).toBe(route);
        await expect(
          page.locator("h1, h2").first(),
          `${route} rendered no heading, so it is probably an error shell`,
        ).toBeVisible();

        // The hero runs a WebGL flight and the marketing sections animate in.
        // Scanning mid-entrance measures a tree that no reader ever sees.
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(route === "/" ? 2500 : 800);

        const result = await analyse(page);
        expect(
          result.violations,
          `${route} at ${viewport.width}x${viewport.height}:\n${describe(result.violations)}`,
        ).toEqual([]);
      });
    }
  });
}

/**
 * The scan is real.
 *
 * A zero is worth nothing if the harness silently stopped scanning — a bad axe
 * path, a CSP that blocks the injected script, a `runOnly` typo that matches no
 * rule. Every one of those reports "no violations" on a page full of them. So
 * break a page on purpose and require that the same call notices: an image with
 * no alt text and a button with no accessible name, which are two of the
 * plainest failures there are.
 *
 * This is what makes the passes above evidence rather than an assumption.
 */
test("the scan detects violations that are really there", async ({ page }) => {
  await page.goto("/pricing");
  await page.waitForLoadState("domcontentloaded");

  const clean = await analyse(page);
  expect(clean.passes.length, "axe ran no rules at all").toBeGreaterThan(0);

  await page.evaluate(() => {
    const image = document.createElement("img");
    // A 1x1 GIF, inline: the rule under test is the missing alt, not the fetch.
    image.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    image.removeAttribute("alt");
    document.body.appendChild(image);

    const button = document.createElement("button");
    button.style.cssText = "width:40px;height:40px";
    document.body.appendChild(button);
  });

  const sabotaged = await analyse(page);
  const found = sabotaged.violations.map((violation) => violation.id);
  expect(found).toContain("image-alt");
  expect(found).toContain("button-name");
});
