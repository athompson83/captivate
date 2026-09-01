import { describe, expect, it } from "vitest";
import {
  MAX_DRAWING_STAGES,
  drawableScenes,
  drawingCap,
  normaliseDrawing,
  replaceMediaWithDrawing,
  replaceMediaWithPhoto,
} from "@/lib/editor/place-drawing";
import { composeScene } from "@/lib/editor/layouts";
import type { SceneContent } from "@/lib/schema/presentation";

/**
 * The pass that fills a generated deck's empty media slots with drawings.
 *
 * The property that matters most is the negative one: an image an author
 * put there — by upload, by URL, by any means — is never replaced. The
 * placeholder the layout composer creates is identifiable by having neither
 * a url nor an asset, and that is the only thing this touches.
 */

const drawing = {
  viewBox: { width: 800, height: 500 },
  paths: [
    { d: "M 100 100 L 700 100", stage: 0 },
    { d: "M 100 200 L 700 200", stage: 1 },
  ],
  stageLabels: ["First", "Second"],
  alt: "Two lines",
};

const withPlaceholder = () =>
  composeScene("split-right", {
    heading: "How it works",
    body: "The mechanism.",
    media: { url: "", alt: "the mechanism, drawn" },
  });

describe("replaceMediaWithDrawing", () => {
  it("swaps the empty placeholder for a staged drawing in the same frame", () => {
    const content = withPlaceholder();
    const placeholder = content.elements.find((el) => el.type === "image")!;
    const replaced = replaceMediaWithDrawing(content, drawing, "the mechanism");
    expect(replaced).not.toBeNull();
    const placed = replaced!.elements.find((el) => el.type === "drawing")!;
    expect(placed.type).toBe("drawing");
    if (placed.type === "drawing") {
      expect(placed.frame).toEqual(placeholder.frame);
      expect(placed.paths).toEqual(drawing.paths);
      expect(placed.prompt).toBe("the mechanism");
    }
    expect(replaced!.elements.some((el) => el.type === "image")).toBe(false);
    // The input was not mutated: mutate-based autosave depends on new objects.
    expect(content.elements.some((el) => el.type === "image")).toBe(true);
  });

  it("never replaces an image an author put there", () => {
    const content = composeScene("split-left", {
      heading: "A real photo",
      media: { url: "/api/assets/abc/content", alt: "their photo", assetId: "abc" },
    });
    expect(replaceMediaWithDrawing(content, drawing, "x")).toBeNull();
  });

  it("returns null when the scene has no media slot at all", () => {
    const content = composeScene("statement", { heading: "No media here" });
    expect(replaceMediaWithDrawing(content, drawing, "x")).toBeNull();
  });
});

describe("drawableScenes", () => {
  const scene = (layout: Parameters<typeof composeScene>[0], imagePrompt: string, url = "") => ({
    content: composeScene(layout, {
      heading: "h",
      media: { url, alt: "a" },
    }) as SceneContent,
    imagePrompt,
  });

  it("selects side-by-side scenes with a prompt and an empty slot, capped", () => {
    const scenes = [
      scene("split-left", "one"),
      scene("split-right", "two"),
      scene("split-left", "three"),
      scene("split-right", "four"),
    ];
    const picked = drawableScenes(scenes);
    expect(picked.map((s) => s.imagePrompt)).toEqual(["one", "two", "three"]);
  });

  it("skips full-bleed backdrops, blank prompts, and filled slots", () => {
    const scenes = [
      scene("media-full", "a backdrop wants a photograph"),
      scene("split-left", "   "),
      scene("split-right", "already has media", "https://example.com/x.png"),
    ];
    expect(drawableScenes(scenes)).toEqual([]);
  });

  it("honours the duration-derived cap", () => {
    const scenes = [
      scene("split-left", "one"),
      scene("split-right", "two"),
      scene("split-left", "three"),
      scene("split-right", "four"),
    ];
    expect(drawableScenes(scenes, drawingCap(1200)).map((s) => s.imagePrompt)).toEqual([
      "one",
      "two",
    ]);
  });
});

describe("drawingCap", () => {
  it("gives one drawing per ten minutes, at least one, at most six", () => {
    expect(drawingCap(300)).toBe(1); // 5 min
    expect(drawingCap(600)).toBe(1); // 10 min
    expect(drawingCap(900)).toBe(2); // 15 min
    expect(drawingCap(1200)).toBe(2); // 20 min
    expect(drawingCap(3600)).toBe(6); // 60 min
    expect(drawingCap(14_400)).toBe(6); // capped
    expect(drawingCap(0)).toBe(1); // no target set
  });

  it("draws twice as often when drawings are the only pictures there are", () => {
    // With no stock or image key, a drawing is the deck's whole visual
    // vocabulary. One per ten minutes gave a twenty-minute talk two pictures
    // and eighteen empty slots.
    expect(drawingCap(1200, true)).toBe(4); // 20 min
    expect(drawingCap(3600, true)).toBe(10); // 60 min, at the ceiling
    expect(drawingCap(14_400, true)).toBe(10); // capped
    expect(drawingCap(0, true)).toBe(1); // still one when no target is set

    // And the rate is unchanged where photographs are filling the rest.
    expect(drawingCap(1200, false)).toBe(2);
    expect(drawingCap(1200)).toBe(2);
    expect(drawingCap(Number.NaN)).toBe(1);
  });
});

describe("replaceMediaWithPhoto", () => {
  const photo = { url: "/api/assets/ph1/content", assetId: "ph1", alt: "a real photograph" };

  it("fills the empty placeholder in place, keeping the composed element", () => {
    const content = withPlaceholder();
    const placeholder = content.elements.find((el) => el.type === "image")!;
    const replaced = replaceMediaWithPhoto(content, photo);
    expect(replaced).not.toBeNull();
    const filled = replaced!.elements.find((el) => el.type === "image")!;
    if (filled.type === "image" && placeholder.type === "image") {
      expect(filled.url).toBe(photo.url);
      expect(filled.assetId).toBe(photo.assetId);
      expect(filled.alt).toBe(photo.alt);
      // Everything the composition decided survives the picture arriving.
      expect(filled.frame).toEqual(placeholder.frame);
      expect(filled.scrim).toBe(placeholder.scrim);
      expect(filled.animation).toEqual(placeholder.animation);
    }
    // The input was not mutated.
    const original = content.elements.find((el) => el.type === "image")!;
    if (original.type === "image") expect(original.url).toBe("");
  });

  it("keeps a cover veil's exit when its photograph arrives", () => {
    const cover = composeScene("cover", {
      heading: "The talk",
      media: { url: "", alt: "a night road" },
    });
    const replaced = replaceMediaWithPhoto(cover, photo)!;
    const veil = replaced.elements.find((el) => el.type === "image")!;
    if (veil.type === "image") {
      expect(veil.url).toBe(photo.url);
      expect(veil.animation.exit).toBe("zoom");
    }
  });

  it("never replaces an image an author put there", () => {
    const content = composeScene("split-left", {
      heading: "A real photo",
      media: { url: "/api/assets/abc/content", alt: "their photo", assetId: "abc" },
    });
    expect(replaceMediaWithPhoto(content, photo)).toBeNull();
  });
});

describe("a generated drawing is bounded before it is placed", () => {
  const made = (paths: { d: string; stage: number }[], stageLabels: string[] = []) => ({
    viewBox: { width: 400, height: 300 },
    paths,
    stageLabels,
    alt: "",
  });

  it("grows the box to hold ink the model drew outside it", () => {
    // The reported failure. A model declared a 400x300 box and drew out to
    // (900, 700); the renderer had `overflow: visible`, so the strokes that
    // escaped were painted across the bar chart beside them. Two drawing
    // fragments floating over a graph is what that looks like from the room.
    const safe = normaliseDrawing(made([{ d: "M 10 10 L 900 700", stage: 0 }]));

    expect(safe.viewBox.width).toBeGreaterThanOrEqual(900);
    expect(safe.viewBox.height).toBeGreaterThanOrEqual(700);
    // Grown, never cropped: the stroke is still all there.
    expect(safe.paths[0].d).toBe("M 10 10 L 900 700");
  });

  it("leaves a well-behaved drawing exactly as it is", () => {
    const original = made([{ d: "M 10 10 L 390 290", stage: 0 }]);
    const safe = normaliseDrawing(original);

    expect(safe.viewBox).toEqual({ width: 400, height: 300 });
    expect(safe.paths).toEqual(original.paths);
  });

  it("costs the presenter no more than three presses", () => {
    // The model was asked for "2 to 8 stages" and took it. Eight stages is
    // eight advances spent on one picture while an audience waits.
    const eight = made(
      Array.from({ length: 8 }, (_, stage) => ({ d: `M 0 0 L 10 ${stage}`, stage })),
      ["one", "two", "three", "four", "five", "six", "seven", "eight"],
    );
    const safe = normaliseDrawing(eight);

    const stages = new Set(safe.paths.map((p) => p.stage));
    expect(Math.max(...stages)).toBeLessThanOrEqual(MAX_DRAWING_STAGES - 1);
    expect(Math.max(...stages)).toBe(3); // stage 0 on arrival, then three presses
  });

  it("keeps the build in order when it compresses it", () => {
    // Folding must not shuffle the picture: what was drawn first still is.
    const six = made(
      Array.from({ length: 6 }, (_, stage) => ({ d: `M 0 0 L 10 ${stage}`, stage })),
    );
    const safe = normaliseDrawing(six);

    const folded = safe.paths.map((p) => p.stage);
    expect(folded).toEqual([...folded].sort((a, b) => a - b));
    // Spread across the presses rather than crammed into the first.
    expect(new Set(folded).size).toBe(MAX_DRAWING_STAGES);
  });

  it("keeps every stage label rather than dropping the folded ones", () => {
    const six = made(
      Array.from({ length: 6 }, (_, stage) => ({ d: `M 0 0 L 10 ${stage}`, stage })),
      ["axes", "bars", "labels", "trend", "callout", "conclusion"],
    );
    const safe = normaliseDrawing(six);

    // An author wrote these; folding two stages together must not lose one.
    const joined = safe.stageLabels.join(" ");
    for (const label of ["axes", "bars", "labels", "trend", "callout", "conclusion"]) {
      expect(joined).toContain(label);
    }
  });

  it("bounds the drawing on its way into the document, not afterwards", () => {
    // The swap is the last thing that touches a generated picture before it is
    // somebody's saved work, so it is where the guarantee has to hold.
    const content = withPlaceholder();
    const replaced = replaceMediaWithDrawing(
      content,
      made([{ d: "M 0 0 L 1200 900", stage: 0 }]),
      "a prompt",
    );

    const element = replaced?.elements.find((e) => e.type === "drawing");
    expect(element).toBeTruthy();
    if (element?.type === "drawing") {
      expect(element.viewBox.width).toBeGreaterThanOrEqual(1200);
      expect(element.viewBox.height).toBeGreaterThanOrEqual(900);
    }
  });
});

describe("how many drawings a deck of a given length gets", () => {
  it("doubles the rate when drawings are the only picture a scene can get", () => {
    // A twenty-minute talk. Photographs available: two drawings is right,
    // because photographs fill the rest. No stock provider: two drawings and
    // eighteen empty slots is the reported "one drawing for a 20 minute
    // presentation", so the rate has to rise.
    expect(drawingCap(20 * 60, false)).toBe(2);
    expect(drawingCap(20 * 60, true)).toBe(4);
  });

  it("is the stock provider that decides, not any image capability at all", () => {
    // The bug this exists for: `isPhotoFillConfigured()` is true when *only*
    // image generation is configured, and generation backfills the cover
    // alone. So a deployment with an image key and no stock key was told
    // photographs were coming to scenes that could never receive one.
    // `dressScenes` asks `isStockSearchConfigured` now; this pins the
    // arithmetic that made the difference visible.
    const fiftyMinutes = 50 * 60;
    expect(drawingCap(fiftyMinutes, false)).toBe(5);
    expect(drawingCap(fiftyMinutes, true)).toBe(10);
  });
});

describe("the box a drawing is measured into", () => {
  const made = (d: string) => ({
    viewBox: { width: 400, height: 300 },
    paths: [{ d, stage: 0 }],
    stageLabels: [],
    alt: "",
  });

  it("finds the endpoint of an arc, whose flags are not coordinates", () => {
    // The case the first version got wrong, and the reason it was wrong: an
    // arc takes seven numbers and only the last two are a point. Read
    // pairwise, `A 20 20 0 0 1 900 700` pairs a flag with the endpoint and
    // concludes the picture is twenty units wide — so the box stayed at 400
    // and the renderer clipped ink that really was at 900.
    const safe = normaliseDrawing(made("M 10 10 A 20 20 0 0 1 900 700"));
    expect(safe.viewBox.width).toBeGreaterThanOrEqual(900);
    expect(safe.viewBox.height).toBeGreaterThanOrEqual(700);
  });

  it("follows a horizontal line, which takes one ordinate and not two", () => {
    const safe = normaliseDrawing(made("M 10 10 H 950"));
    expect(safe.viewBox.width).toBeGreaterThanOrEqual(950);
  });

  it("follows a vertical line the same way", () => {
    const safe = normaliseDrawing(made("M 10 10 V 800"));
    expect(safe.viewBox.height).toBeGreaterThanOrEqual(800);
  });

  it("resolves relative commands against the point they start from", () => {
    // `m 500 400 l 400 300` ends at (900, 700). Treated as absolute it ends at
    // (400, 300) and fits the declared box, so the ink escapes unnoticed.
    const safe = normaliseDrawing(made("m 500 400 l 400 300"));
    expect(safe.viewBox.width).toBeGreaterThanOrEqual(900);
    expect(safe.viewBox.height).toBeGreaterThanOrEqual(700);
  });

  it("counts a curve's control points, which bound it", () => {
    const safe = normaliseDrawing(made("M 0 0 C 880 660 890 670 900 700"));
    expect(safe.viewBox.width).toBeGreaterThanOrEqual(900);
  });

  it("still leaves a drawing that fits exactly as it is", () => {
    const original = made("M 10 10 L 390 290 H 380 V 280 Z");
    expect(normaliseDrawing(original).viewBox).toEqual({ width: 400, height: 300 });
  });
});
