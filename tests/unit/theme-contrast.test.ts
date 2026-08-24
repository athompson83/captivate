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

  /**
   * `--surface-raised` and `--surface-overlay` are the only two surfaces whose
   * *lightness* the warmth bump touched — both came off pure white (L 1 → 0.99),
   * and that costs contrast against every foreground drawn on them. `--success`
   * sat at 4.54 against pure white and fell to 4.42, below AA, on real body
   * text: a success toast renders `text-success` on `bg-overlay`
   * (`src/components/ui/toast.tsx`).
   *
   * Only these two surfaces are asserted. `--surface-base`, `--surface-sunken`
   * and `--surface-inset` kept their lightness and gained only chroma, so their
   * ratios are within 0.01 of what they were before — any sub-AA pair there
   * (`--text-muted` throughout, `--success` on sunken/inset) is pre-existing
   * palette debt that the warmth bump neither caused nor is the place to fix.
   */
  it("keeps every status and accent tone AA-legible on the two surfaces that were lightened", () => {
    const foregrounds = ["text-primary", "text-secondary", "accent-text", "ai-text", "danger", "success"];

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
