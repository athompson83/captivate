import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { cardTitle, shapeLine, shareCard } from "@/lib/marketing/share-card";
import { getTheme } from "@/lib/schema/theme";

/**
 * A share link pasted into a chat unfurls as the deck's own card: its title
 * in its own theme, the shape of the thing beneath. Built as plain markup so
 * it can be read here without rasterising anything.
 */
describe("the share card", () => {
  it("shows the deck's title in its own theme, with its shape beneath", () => {
    const html = renderToStaticMarkup(
      shareCard({
        title: "Hold the room",
        description: "A talk about talks.",
        themeId: "midnight",
        scenes: 11,
        movements: 4,
      }),
    );
    expect(html).toContain("Hold the room");
    expect(html).toContain("A talk about talks.");
    expect(html).toContain("11 scenes · 4 movements");
    expect(html).toContain(getTheme("midnight").tokens.canvas);
    expect(html).toContain(getTheme("midnight").tokens.accent);
  });

  it("falls back to a generic card for a link that resolves to nothing", () => {
    const html = renderToStaticMarkup(shareCard(null));
    expect(html).toContain("A shared presentation");
    expect(html).not.toContain("scenes");
  });

  it("cuts a long title on a word, and says one scene in the singular", () => {
    const long =
      "A title that goes on and on about a great many things for far longer than any card could hold in one line";
    const cut = cardTitle(long);
    expect(cut.length).toBeLessThanOrEqual(92);
    expect(cut.endsWith("…")).toBe(true);
    // Cut on a word: the original has a space where the cut was made.
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(long[cut.length - 1]).toBe(" ");
    expect(cardTitle("   ")).toBe("A shared presentation");
    expect(
      shapeLine({ title: "", description: "", themeId: "paper", scenes: 1, movements: 1 }),
    ).toBe("1 scene");
    expect(
      shapeLine({ title: "", description: "", themeId: "paper", scenes: 0, movements: 3 }),
    ).toBe("");
  });

  it("is served by the viewer route through the same resolver the viewer uses", () => {
    // The claim is about what the route reads: the one SECURITY DEFINER
    // resolver, so the card can never show what the viewer would not.
    const source = readFileSync("src/app/v/[token]/opengraph-image.tsx", "utf8");
    expect(source).toContain("getSharedDeck(token)");
    expect(source).toContain("shareCard(");
    expect(source).toMatch(/export const size = SHARE_CARD_SIZE/);
    expect(source).toMatch(/export const contentType = "image\/png"/);
    expect(source).not.toContain("speakerNotes");
  });
});
