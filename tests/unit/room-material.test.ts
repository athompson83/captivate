import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paletteOf } from "@/lib/present/ambient";
import { GRAIN_IMAGE, graphicBackdrop } from "@/lib/present/graphic-backdrop";
import { roomFor } from "@/lib/ai/look";
import { getTheme } from "@/lib/schema/theme";
import { GeneratedScene } from "@/lib/ai/schemas";
import { composeScene, extractContent, relayoutScene } from "@/lib/editor/layouts";
import { markedPhrase, richTextMark } from "@/lib/schema/presentation";

/**
 * A room with material, and the phrase that matters.
 *
 * Three washes on a flat field are a screen; a wall has a surface. And a
 * body's one phrase the room should keep is coloured in place, not appended.
 */

describe("the grain", () => {
  it("is a browser-made noise tile, laid over every drawn room away from its canvas", () => {
    // No bitmap in the repository and nothing fetched: the tile is an SVG
    // filter the browser rasterises once, stitched so the repeat has no seam.
    expect(GRAIN_IMAGE).toMatch(/^url\("data:image\/svg\+xml,/);
    const svg = decodeURIComponent(GRAIN_IMAGE.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain('type="fractalNoise"');
    expect(svg).toContain('stitchTiles="stitch"');
    // Monochrome: the grain is a material, never a tint.
    expect(svg).toContain('type="saturate" values="0"');

    for (const theme of ["midnight", "paper", "aurora", "chalk"]) {
      const palette = paletteOf(getTheme(theme));
      for (const graphic of ["aurora", "strata", "halo"] as const) {
        const room = graphicBackdrop(graphic, palette)!;
        const layers = room.backgroundImage.split(/, (?=url|radial|linear)/);
        const modes = room.backgroundBlendMode.split(", ");
        // The grain is the top layer, blended; the washes beneath it are not.
        // Screened onto a dark room (film), multiplied into a light one
        // (tooth): soft-light did nothing on a near-black ground.
        expect(layers[0], `${theme}/${graphic}`).toBe(GRAIN_IMAGE);
        expect(modes[0]).toBe(palette.canvas.L < 0.5 ? "screen" : "multiply");
        expect(modes.length).toBe(layers.length);
        expect(modes.slice(1).every((mode) => mode === "normal")).toBe(true);
      }
    }
  });

  it("is absent with the room, never on its own", () => {
    expect(graphicBackdrop("none", paletteOf(getTheme("midnight")))).toBeNull();
  });

  it("is deterministic", () => {
    // The same tile on every render, in the editor, on the projector and in a
    // recording: a seeded filter, not Math.random.
    expect(GRAIN_IMAGE).toContain("seed%3D%227%22");
    expect(readFileSync("src/lib/present/graphic-backdrop.ts", "utf8")).not.toMatch(
      /Math\.random|Date\.now/,
    );
  });
});

describe("the room chosen by the look", () => {
  it("stands a printed medium in front of strata and a lit one in front of a halo", () => {
    expect(roomFor("Ink and wash on cream paper, a thin red line as the motif.")).toBe("strata");
    expect(roomFor("An architectural model under a skylight; avoid people.")).toBe("strata");
    expect(roomFor("Documentary photography, available light, shallow depth.")).toBe("halo");
    expect(roomFor("Cinematic, one lamp in a dark ward, long shadows.")).toBe("halo");
  });

  it("keeps the aurora for anything it does not recognise, and for no look", () => {
    expect(roomFor("Cut paper in three layers, a museum diorama.")).toBe("strata");
    expect(roomFor("Bright vector illustration, flat colour, playful.")).toBe("aurora");
    expect(roomFor("")).toBe("aurora");
  });

  it("is applied by both deck routes, and only the first time a deck is given a look", () => {
    const deckRoute = readFileSync("src/app/api/ai/scenes-from-map/route.ts", "utf8");
    const createRoute = readFileSync("src/app/api/ai/create-from-map/route.ts", "utf8");
    expect(deckRoute).toContain("roomFor(result.data.look)");
    // A deck that already had a look keeps the room its author chose since.
    expect(deckRoute).toMatch(/!current\.look && result\.data\.look \? roomFor/);
    expect(createRoute).toContain("roomFor(built.data.look)");
    for (const route of [deckRoute, createRoute]) {
      expect(route).toContain("...room, graphic }");
      expect(route).toContain(
        "{ ...journey.backdrop, graphic }".replace(
          "journey",
          route === deckRoute ? "current" : "journey",
        ),
      );
    }
  });
});

describe("the phrase that matters", () => {
  const body =
    "Downstream of the block, the tissue is not diseased — it is unsupplied. Everything you do next is about reopening the pipe.";

  it("is coloured in place, in the accent token, leaving the words around it alone", () => {
    const runs = richTextMark(body, "it is unsupplied");
    expect(runs.map((r) => r.text).join("")).toBe(body);
    expect(runs).toHaveLength(3);
    expect(runs[1]).toEqual({
      text: "it is unsupplied",
      color: { kind: "token", token: "accent" },
    });
    expect(runs[0].color).toBeUndefined();
    expect(runs[2].color).toBeUndefined();
  });

  it("matches without regard to case, at the first occurrence, and at either end", () => {
    expect(richTextMark(body, "DOWNSTREAM of the block")[0]).toMatchObject({
      text: "Downstream of the block",
      color: { kind: "token", token: "accent" },
    });
    const tail = richTextMark(body, "reopening the pipe.");
    expect(tail.at(-1)).toMatchObject({ text: "reopening the pipe." });
    expect(tail.at(-1)!.color).toBeDefined();
    expect(tail).toHaveLength(2);
    expect(richTextMark("the pipe, the pipe", "the pipe")).toHaveLength(2);
  });

  it("marks nothing when the phrase is not in the body", () => {
    // Appending would put a fragment after the full stop. A writer who
    // paraphrased its own body has not earned a second sentence.
    expect(richTextMark(body, "survival falls")).toEqual([{ text: body }]);
    expect(richTextMark(body, "  ")).toEqual([{ text: body }]);
    expect(markedPhrase([{ text: body }])).toBe("");
  });

  it("reaches the stage through the composer and survives a re-layout", () => {
    const scene = composeScene("split-left", {
      heading: "A clot is a plumbing problem first.",
      body,
      bodyAccent: "it is unsupplied",
      media: { url: "", alt: "" },
    });
    const prose = scene.elements.find((el) => el.type === "text" && el.content.length === 3);
    expect(prose).toBeDefined();
    expect(prose!.type === "text" && markedPhrase(prose!.content)).toBe("it is unsupplied");

    const extracted = extractContent(scene);
    expect(extracted.body).toBe(body);
    expect(extracted.bodyAccent).toBe("it is unsupplied");

    const again = relayoutScene(scene, "takeaway");
    const kept = again.elements.find((el) => el.type === "text" && markedPhrase(el.content));
    expect(kept).toBeDefined();
  });

  it("is written by the scene writer, capped as a phrase, and materialised", () => {
    const parsed = GeneratedScene.parse({ heading: "x", body, bodyAccent: "it is unsupplied" });
    expect(parsed.bodyAccent).toBe("it is unsupplied");
    expect(GeneratedScene.parse({ heading: "x" }).bodyAccent).toBe("");
    expect(GeneratedScene.safeParse({ heading: "x", bodyAccent: "w".repeat(61) }).success).toBe(
      false,
    );
    const service = readFileSync("src/lib/ai/service.ts", "utf8");
    expect(service).toContain("bodyAccent: scene.bodyAccent || undefined");
    expect(service).toMatch(/copy it exactly into \\`bodyAccent\\`/);
  });
});
