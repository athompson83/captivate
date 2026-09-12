import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_LOOK,
  GENERATED_PER_DECK,
  colourWords,
  paletteWords,
  pictureBrief,
  roomBrief,
} from "@/lib/ai/look";
import { pickGenerated, shapeFor } from "@/lib/ai/picture-plan";
import { GeneratedScenes } from "@/lib/ai/schemas";
import { JourneyConfig } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";

/**
 * A look for every deck: one sentence of visual direction the scene writer
 * sets, kept on the journey, folded into every prompt an image model is
 * given with the theme's palette in words; a few pictures generated to it,
 * the cover first, the rest found; and the room behind the show made to it.
 */

describe("the palette in words", () => {
  it("names a colour by its lightness and hue, and a grey as a grey", () => {
    expect(colourWords("#0F1117")).toBe("near-black");
    expect(colourWords("#FFFFFF")).toBe("off-white");
    expect(colourWords("#F0B858")).toMatch(/^(mid|pale) (amber|orange|yellow)$/);
    expect(colourWords("#0F6FCB")).toMatch(/blue$/);
    expect(colourWords("#F26DBD")).toMatch(/(magenta|rose)$/);
    expect(colourWords("#2E7D4F")).toMatch(/(green|teal)$/);
  });

  it("describes a theme as its ground and its accents", () => {
    const words = paletteWords(getTheme("midnight"));
    expect(words).toContain("near-black ground");
    expect(words).toMatch(/(amber|orange|yellow) accents/);
    const paper = paletteWords(getTheme("paper"));
    expect(paper).toContain("off-white ground");
  });
});

describe("the briefs", () => {
  it("carry the scene, the look, the palette and the things never to draw", () => {
    const brief = pictureBrief(
      "A paramedic at an open ambulance door.",
      "Ink and wash.",
      "a pale ground",
    );
    expect(brief.startsWith("A paramedic at an open ambulance door. Ink and wash.")).toBe(true);
    expect(brief).toContain("Colour world: a pale ground");
    expect(brief).toContain("No text, no lettering");
  });

  it("take the default look when the writer set none, and stay within the provider's limit", () => {
    const brief = pictureBrief("x".repeat(240), "", "y");
    expect(brief).toContain(DEFAULT_LOOK);
    expect(brief.length).toBeLessThanOrEqual(1000);
  });

  it("ask for a room that is empty at the centre and carries the talk's own light", () => {
    const room = roomBrief("Whole Blood in the Field", "Documentary, dusk.", "a deep blue ground");
    expect(room).toContain('"Whole Blood in the Field"');
    expect(room).toContain("empty at the centre");
    expect(room).toContain("no people");
    expect(room).toContain("Documentary, dusk.");
    expect(room).toContain("a deep blue ground");
  });
});

describe("which pictures are made", () => {
  it("the cover first, then the full-bleed, then the sides, in the deck's order, capped", () => {
    const picked = pickGenerated(
      [
        { index: 0, layout: "split-left" },
        { index: 1, layout: "cover" },
        { index: 2, layout: "explainer" },
        { index: 3, layout: "media-full" },
        { index: 4, layout: "split-right" },
        { index: 5, layout: "split-left" },
      ],
      GENERATED_PER_DECK,
    );
    expect(picked).toEqual([1, 3, 0, 4]);
    expect(pickGenerated([{ index: 7, layout: "cover" }], 0)).toEqual([]);
  });

  it("asks for a tall picture for a tall slot", () => {
    expect(shapeFor(8 / 9)).toBe("tall");
    expect(shapeFor(16 / 9)).toBe("wide");
  });
});

describe("the look is kept", () => {
  it("on the journey, empty for every stored deck, and in the scene writer's answer", () => {
    expect(JourneyConfig.parse({}).look).toBe("");
    expect(JourneyConfig.safeParse({ look: "x".repeat(401) }).success).toBe(false);
    expect(GeneratedScenes.parse({ scenes: [{ heading: "h" }] }).look).toBe("");
  });

  it("is written by both deck routes, with the room, and only where a model wrote the deck", () => {
    for (const route of [
      "src/app/api/ai/scenes-from-map/route.ts",
      "src/app/api/ai/create-from-map/route.ts",
    ]) {
      const source = readFileSync(route, "utf8");
      expect(source, route).toContain("dressRoom(");
      expect(source, route).toMatch(/source === "model"/);
      expect(source, route).toContain("look:");
      expect(source, route).toContain("backdrop:");
    }
  });

  it("goes into every generated picture, and only the deck route may generate", () => {
    const service = readFileSync("src/lib/ai/service.ts", "utf8");
    expect(service).toContain("pictureBrief(scene.imagePrompt, look, palette)");
    expect(service).toMatch(/mayGenerate && isImageGenerationConfigured\(\)/);
    expect(service).toMatch(
      /await dressScenes\(scenes, presentationId, totalSeconds, \{ mayGenerate: true, look, themeId \}\)/,
    );
    const single = service.match(/await dressScenes\(\[scene\], presentationId, 0, \{([^}]*)\}\)/);
    expect(single).not.toBeNull();
    expect(single![1]).not.toContain("mayGenerate");
  });
});
