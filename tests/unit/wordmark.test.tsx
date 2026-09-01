import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Wordmark } from "@/components/ui/wordmark";

/**
 * The company's name is the part that goes missing.
 *
 * "Captivate" was written out four times, in four files, each with its own
 * size and colour tokens — so adding "by Axtevi" to the header meant adding it
 * four times, and a fifth surface added later would have shipped without it
 * and looked correct in isolation. These tests hold both halves: that the
 * lockup names the product and the company, and that every shell gets its name
 * from the lockup rather than from a string of its own.
 */

const SHELLS = [
  "src/components/app-shell.tsx",
  "src/app/(auth)/layout.tsx",
  "src/components/marketing/site-chrome.tsx",
];

describe("the brand lockup", () => {
  it("names the product and the company it sits under", () => {
    render(<Wordmark />);

    expect(screen.getByText("Captivate")).toBeTruthy();
    expect(screen.getByText("by Axtevi")).toBeTruthy();
  });

  it("reads as one name to a screen reader", () => {
    // The two lines are a typographic split, not two separate labels, and the
    // symbol is decorative — so the lockup's text content is the accessible
    // name of whatever link wraps it, with nothing repeated inside it.
    const { container } = render(<Wordmark />);

    expect(container.textContent).toBe("Captivateby Axtevi");

    const symbol = container.querySelector("img");
    expect(symbol, "the lockup draws the brand symbol").toBeTruthy();
    // An `alt` of "Captivate" here would have a screen reader announce the
    // product twice in a row, once from the picture and once from the words
    // beside it. Empty, not absent: absent makes it an unlabelled image.
    expect(symbol?.getAttribute("alt")).toBe("");
  });

  it("draws the symbol at or above the size the kit sets a floor for", () => {
    // The kit's minimum for the icon on its own is 24px. Both sizes clear it;
    // the ribbon folds over itself twice, and below that it is a smudge.
    for (const size of ["sm", "md"] as const) {
      const { container } = render(<Wordmark size={size} />);
      const symbol = container.querySelector("img");

      expect(Number(symbol?.getAttribute("width"))).toBeGreaterThanOrEqual(24);
      expect(Number(symbol?.getAttribute("height"))).toBeGreaterThanOrEqual(24);
    }
  });

  it("carries the public site's palette when asked", () => {
    // The front door paints on a fixed palette and ignores the visitor's
    // colour scheme, so the app's semantic ink tokens would render the maker's
    // line nearly invisible there.
    const { container } = render(<Wordmark tone="sky" />);

    expect(container.innerHTML).toContain("--sky-ink-3");
    expect(container.innerHTML).not.toContain("text-ink-3");
  });

  it("is the only place any shell states the name", () => {
    for (const path of SHELLS) {
      const source = readFileSync(path, "utf8");

      expect(source, `${path} should render <Wordmark />`).toContain("<Wordmark");
      // A wordmark written out by hand is one that stops saying "by Axtevi"
      // the moment the lockup changes. Prose that happens to mention the
      // product is fine; a bare element containing only the name is not.
      expect(source, `${path} should not hand-write the wordmark`).not.toMatch(/>\s*Captivate\s*</);
    }
  });
});
