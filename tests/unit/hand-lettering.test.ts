import { describe, expect, it } from "vitest";
import { THEMES, ThemeFonts, getTheme, themeCssVars } from "@/lib/schema/theme";

/**
 * The hand that letters the drawings: every theme has one, the stage
 * publishes it, and a theme stored before it existed still parses to it.
 */

describe("lettered by the same hand", () => {
  it("every theme letters its drawings in the same print hand", () => {
    expect(THEMES.length).toBeGreaterThan(0);
    for (const theme of THEMES) {
      expect(theme.fonts.hand).toBe("var(--font-hand)");
      expect(theme.fonts.hand).not.toBe(theme.fonts.sans);
      expect(themeCssVars(theme)["--stage-font-hand"]).toBe("var(--font-hand)");
    }
  });

  it("a stored theme without a hand parses to it", () => {
    const fonts = ThemeFonts.parse({ display: "serif", sans: "sans-serif", mono: "monospace" });
    expect(fonts.hand).toBe("var(--font-hand)");
    expect(getTheme("midnight").fonts.hand).toBe("var(--font-hand)");
  });
});
