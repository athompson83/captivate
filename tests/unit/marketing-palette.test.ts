import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The front door's colour balance.
 *
 * The brand kit sets proportions, not just values: 60% midnight and paper
 * foundations, 25% navy and indigo structure, 10% violet for action, 5% coral
 * and amber for emphasis. The public site ran almost exactly the inverse —
 * every call to action, eyebrow, step numeral and feature icon was amber,
 * which is the 5% colour doing all of the 10% colour's work and most of the
 * page's accent besides.
 *
 * It was invisible because the token was named `--sky-amber`. A token named
 * for its hue cannot be wrong about its job; one named for its job can, so
 * the action is `--sky-action` now and the warm pair is emphasis by name.
 * This holds the line, because the failure mode is one reasonable-looking
 * button at a time.
 */

const SURFACES = [
  "src/app/page.tsx",
  "src/app/pricing/page.tsx",
  "src/components/marketing/site-chrome.tsx",
];

/** The tokens the kit reserves for emphasis, and the site for nothing else. */
const EMPHASIS = ["--sky-amber", "--sky-coral"];

describe("the public site spends its colours the way the kit does", () => {
  it("reads the surfaces it claims to", () => {
    // Without this, every assertion below passes on an empty string the day a
    // page is renamed — which is the only way a guard like this fails wrong.
    for (const path of SURFACES) {
      const source = readFileSync(path, "utf8");
      expect(source.length, `${path} is empty`).toBeGreaterThan(500);
      expect(source, `${path} no longer uses the sky palette`).toContain("--sky-");
    }
  });

  it("never fills a control with an emphasis colour", () => {
    for (const path of SURFACES) {
      const source = readFileSync(path, "utf8");

      for (const token of EMPHASIS) {
        // `bg-[var(--token)]` and `border-[var(--token)]` are the two ways a
        // colour becomes a control rather than an accent on one.
        expect(source, `${path} fills a control with ${token}`).not.toMatch(
          new RegExp(`\\bbg-\\[var\\(${token}\\)\\]`),
        );
      }
    }
  });

  it("routes every call to action through the action token", () => {
    // Each surface has at least one filled button, and the fill is violet.
    // `hover:` and the rest of Tailwind's variants prefix the utility, so the
    // resting fill is the one with nothing but whitespace or a quote in front
    // of it — otherwise a hover state counts as a second fill colour.
    const RESTING = /(?:^|["'\s])bg-\[var\((--sky-[\w-]+)\)\]/g;

    for (const path of SURFACES) {
      const source = readFileSync(path, "utf8");
      const filled = [...source.matchAll(RESTING)].map((m) => m[1]);

      expect(filled.length, `${path} has no filled control at all`).toBeGreaterThan(0);
      expect(
        new Set(filled),
        `${path} fills a control with something other than the action`,
      ).toEqual(new Set(["--sky-action"]));
    }
  });

  it("keeps a label legible on the action it sits on", () => {
    // The pairing, not just the fill: an action filled violet with the old
    // dark amber ink on it would satisfy every assertion above and be
    // unreadable. Every filled control names the action's own ink.
    for (const path of SURFACES) {
      const source = readFileSync(path, "utf8");
      const fills = source.split(/\bbg-\[var\(--sky-action\)\]/).slice(1);

      for (const [index, after] of fills.entries()) {
        expect(
          after.slice(0, 400),
          `${path}: filled control ${index + 1} does not label itself with --sky-action-ink`,
        ).toContain("--sky-action-ink");
      }
    }
  });
});
