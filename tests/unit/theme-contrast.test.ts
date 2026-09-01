import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, oklabToHex, parseOklch } from "@/lib/utils/color";

/**
 * Light-theme tokens, read out of `globals.css` rather than copied into this
 * file. A hand-mirrored copy cannot fail when the real stylesheet drifts, which
 * makes it exactly the kind of guard that passes while the shipped palette
 * regresses — and the regression below is one that actually happened.
 */
const GLOBALS = resolve(process.cwd(), "src/app/globals.css");

function lightTokens(): Record<string, string> {
  const css = readFileSync(GLOBALS, "utf8");
  // The first `:root { … }` block is the light theme; `[data-theme="dark"]`
  // redefines the same names afterwards and must not be picked up here.
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root) throw new Error("could not find the :root token block in globals.css");

  const tokens: Record<string, string> = {};
  for (const [, name, value] of root[1].matchAll(/^\s*--([\w-]+):\s*(oklch\([^)]*\));/gm)) {
    tokens[name] = value;
  }
  return tokens;
}

/**
 * The public site's palette, which lives on `.marketing` rather than `:root`
 * because the front door deliberately ignores the visitor's colour scheme.
 * It had no contrast coverage at all until the action moved to violet, which
 * is a change that can only be made safely with the numbers in front of you.
 */
function skyTokens(): Record<string, string> {
  const css = readFileSync(GLOBALS, "utf8");
  const block = /\.marketing\s*\{([\s\S]*?)\n  \}/.exec(css);
  if (!block) throw new Error("could not find the .marketing token block in globals.css");
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(/^\s*--([\w-]+):\s*(oklch\([^)]*\));/gm)) {
    tokens[name] = value;
  }
  return tokens;
}

function darkTokens(): Record<string, string> {
  const css = readFileSync(GLOBALS, "utf8");
  const block = /\[data-theme="dark"\][^{]*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) throw new Error("could not find the dark token block in globals.css");
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(/^\s*--([\w-]+):\s*(oklch\([^)]*\));/gm)) {
    tokens[name] = value;
  }
  return tokens;
}

const TOKENS = lightTokens();
const DARK = darkTokens();
const SKY = skyTokens();

function token(name: string): string {
  const value = TOKENS[name];
  if (!value) throw new Error(`--${name} is not an oklch() token in globals.css's :root`);
  return value;
}

const hex = (oklch: string) => oklabToHex(parseOklch(oklch));

// WCAG AA for normal text.
const MIN_BODY_CONTRAST = 4.5;

describe("light theme contrast after the warmth bump", () => {
  it("reads the real tokens out of globals.css", () => {
    // Guards the parser itself: if the regex stops matching, every contrast
    // assertion below would vacuously pass on an empty token set.
    expect(Object.keys(TOKENS).length).toBeGreaterThan(10);
    expect(token("surface-base")).toMatch(/^oklch\(/);
    expect(token("text-primary")).toMatch(/^oklch\(/);
  });

  it("keeps primary text readable on every surface", () => {
    for (const surface of ["surface-base", "surface-sunken", "surface-raised"]) {
      expect(
        contrastRatio(hex(token("text-primary")), hex(token(surface))),
        `text-primary on ${surface}`,
      ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
    }
  });

  it("keeps secondary text readable on the base surface", () => {
    expect(
      contrastRatio(hex(token("text-secondary")), hex(token("surface-base"))),
    ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
  });

  it("keeps muted body text readable on every light surface", () => {
    for (const surface of [
      "surface-base",
      "surface-sunken",
      "surface-raised",
      "surface-overlay",
      "surface-inset",
    ]) {
      expect(
        contrastRatio(hex(token("text-muted")), hex(token(surface))),
        `text-muted on ${surface}`,
      ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
    }
  });

  it("keeps success body text readable on its tinted and recessed surfaces", () => {
    for (const surface of ["success-soft", "surface-sunken", "surface-inset"]) {
      expect(
        contrastRatio(hex(token("success")), hex(token(surface))),
        `success on ${surface}`,
      ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
    }
  });

  /**
   * `--surface-raised` and `--surface-overlay` are the two surfaces whose
   * lightness the warmth bump changed. Keep the full status/accent set guarded
   * there in addition to the targeted body-text pairings above.
   */
  it("keeps every status and accent tone AA-legible on the two surfaces that were lightened", () => {
    const foregrounds = [
      "text-primary",
      "text-secondary",
      "accent-text",
      "ai-text",
      "danger",
      "success",
    ];

    for (const fg of foregrounds) {
      for (const surface of ["surface-raised", "surface-overlay"]) {
        expect(
          contrastRatio(hex(token(fg)), hex(token(surface))),
          `${fg} on ${surface}`,
        ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
      }
    }
  });
});

/**
 * Everything above reads the light block. The dark theme is the one most of
 * this application is looked at in, and it had never been held to the same
 * threshold — which is how `--text-muted` came to be 4.11:1 on
 * `--surface-overlay`, the ground of every menu and popover in the product,
 * and stay there. The defect was invisible because the guard did not look.
 */
describe("dark theme contrast", () => {
  const SURFACES = [
    "surface-base",
    "surface-sunken",
    "surface-raised",
    "surface-overlay",
    "surface-inset",
  ];

  const dark = (name: string) => {
    const value = DARK[name];
    if (!value) throw new Error(`--${name} is not an oklch() token in the dark block`);
    return value;
  };

  it("reads the real dark tokens out of globals.css", () => {
    expect(Object.keys(DARK).length).toBeGreaterThan(10);
    for (const surface of SURFACES) expect(dark(surface)).toMatch(/^oklch\(/);
  });

  it("keeps every ink readable on every dark surface", () => {
    for (const ink of ["text-primary", "text-secondary", "text-muted"]) {
      for (const surface of SURFACES) {
        expect(
          contrastRatio(hex(dark(ink)), hex(dark(surface))),
          `${ink} on ${surface}`,
        ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
      }
    }
  });

  it("keeps every status and accent tone AA-legible on every dark surface", () => {
    for (const fg of ["accent-text", "ai-text", "danger", "success"]) {
      for (const surface of SURFACES) {
        expect(
          contrastRatio(hex(dark(fg)), hex(dark(surface))),
          `${fg} on ${surface}`,
        ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
      }
    }
  });
});

/**
 * The primary action, in both themes.
 *
 * A filled violet button with a label on it is the most-clicked thing in the
 * product and was the one pairing with no assertion at all — so the brand
 * kit's "violet leads action" could have been adopted at any lightness and
 * nothing would have objected. The kit's own violet clears AA with white by a
 * margin of about a point; that margin is what this protects.
 */
describe("the primary action carries its label", () => {
  for (const [theme, tokens] of [
    ["light", TOKENS],
    ["dark", DARK],
  ] as const) {
    it(`meets AA in the ${theme} theme, at rest and under a pointer`, () => {
      const contrast = tokens["accent-contrast"];
      if (!contrast) throw new Error(`--accent-contrast missing from ${theme}`);

      // Hover included. On a dark ground the natural direction for a hover is
      // to lighten, which is also the direction that costs contrast — and a
      // label that is legible until you reach for it is not legible.
      for (const state of ["accent", "accent-hover"]) {
        const fill = tokens[state];
        if (!fill) throw new Error(`--${state} missing from ${theme}`);

        expect(
          contrastRatio(hex(contrast), hex(fill)),
          `accent-contrast on ${state} (${theme})`,
        ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
      }
    });
  }
});

/**
 * The front door.
 *
 * Its call to action used to be the kit's 5% emphasis colour, and moving it to
 * violet is the kind of change that reads as an improvement and quietly costs
 * a contrast ratio: the brand's violet is a *fill*, and as text on midnight it
 * is 3.4:1. The fill and the ink that sits on it are one decision, so they are
 * asserted as one.
 */
describe("the public site's palette", () => {
  const sky = (name: string) => {
    const value = SKY[name];
    if (!value) throw new Error(`--${name} is not an oklch() token on .marketing`);
    return value;
  };

  it("reads the real .marketing tokens out of globals.css", () => {
    expect(Object.keys(SKY).length).toBeGreaterThan(8);
    expect(sky("sky-ground")).toMatch(/^oklch\(/);
  });

  it("carries a label on the action it fills", () => {
    expect(
      contrastRatio(hex(sky("sky-action-ink")), hex(sky("sky-action"))),
    ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
    expect(
      contrastRatio(hex(sky("sky-action-ink")), hex(sky("sky-action-hover"))),
    ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
  });

  it("keeps every ink and accent readable on both grounds", () => {
    for (const fg of ["sky-ink", "sky-ink-2", "sky-ink-3", "sky-action-text", "sky-amber"]) {
      for (const ground of ["sky-ground", "sky-deep"]) {
        expect(
          contrastRatio(hex(sky(fg)), hex(sky(ground))),
          `${fg} on ${ground}`,
        ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
      }
    }
  });

  it("keeps every stop of the emphasised phrase readable", () => {
    // `.lit-text` clips a four-stop sweep into a heading. It used to take the
    // identity ramp, which is fill-grade: its indigo is 2.79:1 on this ground,
    // so the opening word of the phrase was under the 3:1 floor that even
    // large text has. Held to 4.5:1 rather than 3:1 — the phrase is set large
    // today, and a stop that only clears the large-text floor is one type
    // change away from failing.
    for (const stop of ["sky-indigo-text", "sky-action-text", "sky-magenta-text", "sky-amber"]) {
      for (const ground of ["sky-ground", "sky-deep"]) {
        expect(
          contrastRatio(hex(sky(stop)), hex(sky(ground))),
          `${stop} on ${ground}`,
        ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
      }
    }
  });

  it("does not use the action's fill value as text", () => {
    // The distinction the two tokens exist for. If they ever converge, one of
    // them is being used for the wrong half of the job.
    expect(sky("sky-action")).not.toBe(sky("sky-action-text"));
    expect(contrastRatio(hex(sky("sky-action")), hex(sky("sky-ground")))).toBeLessThan(
      MIN_BODY_CONTRAST,
    );
  });
});

/**
 * The warning pair, in both themes.
 *
 * Added with the generated-image guardrail, which is the first thing in the app
 * to put body text on a warning surface. A guardrail nobody can read is not a
 * guardrail, so it is held to the same threshold as any other prose — and to
 * both themes, because the earlier regression here was a token that was fine in
 * one and not the other.
 */
describe("the warning surface carries readable text", () => {
  it("meets AA in the light theme", () => {
    const ratio = contrastRatio(hex(token("warning-text")), hex(token("warning-soft")));
    expect(ratio).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
  });

  it("meets AA in the dark theme", () => {
    const dark = (name: string) => {
      const value = DARK[name];
      if (!value) throw new Error(`--${name} is not an oklch() token in the dark block`);
      return value;
    };
    const ratio = contrastRatio(hex(dark("warning-text")), hex(dark("warning-soft")));
    expect(ratio).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
  });
});
