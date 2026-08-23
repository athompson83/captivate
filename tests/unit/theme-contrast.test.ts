import { describe, expect, it } from "vitest";
import { contrastRatio, oklabToHex, parseOklch } from "@/lib/utils/color";

// Mirrors the light-mode tokens in src/app/globals.css:37-56. Kept as literals
// (not imported from CSS) because Vitest doesn't parse CSS custom properties —
// if these drift from globals.css, this test's comment is the tripwire to
// update both together.
const LIGHT_TOKENS = {
  surfaceBase: "oklch(0.985 0.01 90)", // Task 1 target value, see Step 7
  surfaceSunken: "oklch(0.955 0.015 90)",
  surfaceRaised: "oklch(0.99 0.006 90)",
  textPrimary: "oklch(0.22 0.012 265)",
  textSecondary: "oklch(0.44 0.012 265)",
  textMuted: "oklch(0.6 0.012 265)",
};

const hex = (oklch: string) => oklabToHex(parseOklch(oklch));

// WCAG AA for normal text.
const MIN_BODY_CONTRAST = 4.5;

describe("light theme contrast after the warmth bump", () => {
  it("keeps primary text readable on every surface", () => {
    for (const surface of [
      LIGHT_TOKENS.surfaceBase,
      LIGHT_TOKENS.surfaceSunken,
      LIGHT_TOKENS.surfaceRaised,
    ]) {
      expect(contrastRatio(hex(LIGHT_TOKENS.textPrimary), hex(surface))).toBeGreaterThanOrEqual(
        MIN_BODY_CONTRAST,
      );
    }
  });

  it("keeps secondary text readable on the base surface", () => {
    expect(
      contrastRatio(hex(LIGHT_TOKENS.textSecondary), hex(LIGHT_TOKENS.surfaceBase)),
    ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
  });
});
