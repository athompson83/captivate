import { describe, expect, it } from "vitest";
import {
  drawableScenes,
  drawingCap,
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
