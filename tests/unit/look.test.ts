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

describe("what the review found", () => {
  const service = readFileSync("src/lib/ai/service.ts", "utf8");
  const deckRoute = readFileSync("src/app/api/ai/scenes-from-map/route.ts", "utf8");
  const createRoute = readFileSync("src/app/api/ai/create-from-map/route.ts", "utf8");

  it("writes the journey from a fresh read, only the two fields it owns, with the saved look winning", () => {
    // Read again after the minutes the scene call takes, so an author's edits
    // meanwhile are not written over by the snapshot from the top.
    const afterScenes = deckRoute.slice(deckRoute.indexOf("const readJourney"));
    expect(afterScenes).toContain("const before = await readJourney()");
    expect(afterScenes).toContain("const current = await readJourney()");
    expect(afterScenes).toContain("...current,");
    expect(afterScenes).toContain("room && !current.backdrop.url");
    // The author's saved look goes into the generation and wins there.
    expect(deckRoute).toContain('look: deck?.journey.look ?? ""');
    expect(service).toMatch(/const look = fixedLook\.trim\(\) \|\| result\.data\.look\.trim\(\);/);
  });

  it("gives the room only what the route has left, and aborts it at the deadline", () => {
    for (const route of [deckRoute, createRoute]) {
      expect(route).toContain("const started = Date.now()");
      expect(route).toMatch(/maxDuration \* 1000 - \(Date\.now\(\) - started\) - ROUTE_RESERVE_MS/);
      expect(route).toContain("budgetMs: Math.min(ROOM_BUDGET_MS, remaining)");
    }
    const room = service.slice(service.indexOf("export async function dressRoom"));
    expect(room).toContain("if (budget < ROOM_MIN_MS) return null");
    expect(room).toContain("const deadline = AbortSignal.timeout(budget)");
    expect(room).toContain("signal: deadline");
    expect(room).toContain("if (!generated.ok || deadline.aborted) return null");
    expect(room).not.toContain("Promise.race");
  });

  it("applies the saved look to a picture generated from the picker", () => {
    const generate = readFileSync("src/app/api/ai/visuals/generate/route.ts", "utf8");
    expect(generate).toContain("pictureBrief(prompt, look, paletteWords(getTheme(deck.theme_id)))");
  });
});

describe("a room from stock", () => {
  const service = readFileSync("src/lib/ai/service.ts", "utf8");
  const deckRoute = readFileSync("src/app/api/ai/scenes-from-map/route.ts", "utf8");
  const createRoute = readFileSync("src/app/api/ai/create-from-map/route.ts", "utf8");

  it("asks the writer for the place's search words, defaulted so an older answer still parses", () => {
    expect(service).toContain("The room: write \\`roomQuery\\`");
    const parsed = GeneratedScenes.parse({
      scenes: [{ layout: "title", heading: "A" }],
      look: "Documentary, dusk.",
    });
    expect(parsed.roomQuery).toBe("");
    expect(
      GeneratedScenes.parse({
        scenes: [{ layout: "title", heading: "A" }],
        roomQuery: "hospital corridor night",
      }).roomQuery,
    ).toBe("hospital corridor night");
  });

  it("finds the room in stock where it cannot be made, from the writer's words and never the title", () => {
    const room = service.slice(service.indexOf("export async function dressRoom"));
    // The made room first; the found one only when that is not possible.
    expect(room).toMatch(/const made = await generateRoom\(/);
    expect(room).toMatch(
      /if \(made\) return made;\s*return roomFromStock\(roomQuery, presentationId, alt\);/,
    );
    const found = room.slice(
      room.indexOf("async function roomFromStock"),
      room.indexOf("export async function buildSingleScene"),
    );
    expect(found).toContain("if (!query || !isStockSearchConfigured()) return null;");
    expect(found).toContain(
      'fillWithStockPhoto(query, "", presentationId, { slotAspect: 16 / 9 })',
    );
    expect(found).not.toContain("title");
    // A photograph has detail a made room was told not to: dimmed a little more.
    expect(found).toContain("dim: 0.55");
    expect(room.slice(0, room.indexOf("async function roomFromStock"))).toContain("dim: 0.5 }");
  });

  it("is handed the writer's words by both deck routes", () => {
    expect(createRoute).toContain("roomQuery: built.data.roomQuery");
    expect(deckRoute).toContain("roomQuery: result.data.roomQuery");
    expect(service).toContain("const roomQuery = result.data.roomQuery.trim();");
    expect(service).toMatch(
      /return \{ ok: true, data: \{ source: "model", scenes, look, roomQuery \} \};/,
    );
  });
});
