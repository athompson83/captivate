// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { composeScene } from "@/lib/editor/layouts";
import { createElement } from "@/lib/editor/element-factory";
import { ImageElement, parseSceneContent } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { Stage } from "@/components/stage/stage";
import { GRAIN, applyGrade, coversStage, gradeMatrix } from "@/lib/present/grade";

/**
 * Pictures graded to the theme.
 *
 * Every picture a generated deck had was a stock photograph in its own colour
 * world beside a themed heading — a scrapbook page. A grade lays the deck's
 * own light over the photograph, and grain over that, in the theme's tokens
 * and nothing else, so a picture from anywhere reads as printed for this
 * deck. And a full-bleed picture is never feathered: the veil over a cover
 * showed the title scene's words through its rim.
 */

const theme = getTheme("midnight");

const picture = (over: Partial<ReturnType<typeof createElement>> & { id: string }) =>
  ({ ...createElement("image"), url: "https://example.com/i.jpg", ...over }) as never;

const stage = (elements: unknown[]) =>
  render(
    <Stage
      content={
        parseSceneContent({
          version: 1,
          layout: "custom",
          background: { kind: "theme" },
          elements,
          themeOverride: null,
        }).content
      }
      theme={theme}
      aspect="16:9"
      fixedScale={1}
    />,
  ).container;

describe("the grade", () => {
  it("is one colour matrix in the theme's tokens, and nothing for a picture left as shot", () => {
    for (const grade of ["tint", "duotone"] as const) {
      const matrix = gradeMatrix(grade, "#0F1117", "#F0B858");
      expect(matrix).toHaveLength(20);
      // Alpha is untouched, so a PNG's transparent parts stay transparent.
      expect(matrix!.slice(15)).toEqual([0, 0, 0, 1, 0]);
      expect(GRAIN[grade]).toBeGreaterThan(0);
    }
    expect(gradeMatrix("none", "#0F1117", "#F0B858")).toBeNull();
    expect(GRAIN.none).toBe(0);
  });

  it("tints toward the accent while keeping the picture's own light", () => {
    const matrix = gradeMatrix("tint", "#0F1117", "#F0B858")!;
    const [r, g, b] = applyGrade(matrix, [0.5, 0.5, 0.5]);
    // A mid grey warms toward an amber accent: red up, blue down.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    // Black stays dark and white stays light: a tint is not a wash.
    expect(applyGrade(matrix, [0, 0, 0]).every((v) => v < 0.05)).toBe(true);
    expect(applyGrade(matrix, [1, 1, 1]).every((v) => v > 0.75)).toBe(true);
  });

  it("puts a duotone between the canvas and the accent, whichever is the darker", () => {
    const dark = gradeMatrix("duotone", "#0F1117", "#F0B858")!;
    const [sr, sg, sb] = applyGrade(dark, [0, 0, 0]);
    // Shadows are the canvas on a dark theme.
    expect(sr).toBeLessThan(0.1);
    expect(sg).toBeLessThan(0.1);
    expect(sb).toBeLessThan(0.15);
    const [hr, hg, hb] = applyGrade(dark, [1, 1, 1]);
    // Highlights reach the accent, not white.
    expect(hr).toBeGreaterThan(0.85);
    expect(hb).toBeLessThan(0.5);
    expect(hg).toBeLessThan(hr);

    // On a white canvas the accent takes the shadows and white the highlights,
    // so the picture is never a white rectangle.
    const light = gradeMatrix("duotone", "#FFFFFF", "#0F6FCB")!;
    const shadow = applyGrade(light, [0, 0, 0]);
    expect(shadow[2]).toBeGreaterThan(shadow[0]);
    expect(shadow[0]).toBeLessThan(0.2);
    const highlight = applyGrade(light, [1, 1, 1]);
    expect(highlight.every((v) => v > 0.9)).toBe(true);
    const mid = applyGrade(light, [0.5, 0.5, 0.5]);
    expect(mid[2]).toBeGreaterThan(mid[0]);
    expect(mid[0]).toBeGreaterThan(0.2);
    expect(mid[0]).toBeLessThan(0.9);
  });

  it("is a tint on every composed picture, and none on a stored row that predates it", () => {
    for (const layout of [
      "split-left",
      "split-right",
      "media-full",
      "explainer",
      "cover",
    ] as const) {
      const content = composeScene(layout, {
        heading: "H",
        media: { url: "https://example.com/i.jpg", alt: "a" },
        cards: [{ title: "a", body: "b" }],
      });
      const image = content.elements.find((el) => el.type === "image");
      expect(image?.type === "image" && image.grade, layout).toBe("tint");
    }
    const stored = ImageElement.parse({
      id: "i1",
      type: "image",
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      url: "",
    });
    expect(stored.grade).toBe("none");
    const inserted = createElement("image");
    expect(inserted.type === "image" && inserted.grade).toBe("tint");
  });

  it("filters the picture's own pixels, defines the filter beside it, and touches nothing without a picture", () => {
    const container = stage([
      picture({ id: "tinted", grade: "tint" }),
      picture({ id: "duo", grade: "duotone" }),
      picture({ id: "plain", grade: "none" }),
      { ...createElement("image"), id: "empty", url: "", grade: "tint" },
    ]);
    const images = [...container.querySelectorAll("img")];
    const [tinted, duo, plain] = images;
    expect(tinted.style.filter).toMatch(/^url\("?#grade-/);
    expect(duo.style.filter).toMatch(/^url\("?#grade-/);
    expect(tinted.style.filter).not.toBe(duo.style.filter);
    expect(plain.style.filter).toBe("");
    // The filter is an SVG definition next to its picture: a colour matrix,
    // then grain composited inside the picture's alpha.
    const filters = [...container.querySelectorAll("filter")];
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter.querySelector("feColorMatrix")).not.toBeNull();
      expect(filter.querySelector("feComposite")?.getAttribute("in2")).toBe("SourceGraphic");
      expect(filter.querySelector("feBlend")?.getAttribute("mode")).toBe("overlay");
    }
    // No coloured layer over the box: a contained picture's gutters and a
    // PNG's transparent parts are left alone.
    expect(container.querySelector("[data-grain]")).toBeNull();
    expect(container.querySelectorAll("img[data-grade]")).toHaveLength(3);
  });
});

describe("a picture that is the whole stage", () => {
  it("is recognised by its frame, with a little tolerance", () => {
    expect(coversStage({ x: 0, y: 0, w: 100, h: 100 })).toBe(true);
    expect(coversStage({ x: 0.2, y: 0, w: 99.7, h: 100 })).toBe(true);
    expect(coversStage({ x: 50, y: 0, w: 50, h: 100 })).toBe(false);
    expect(coversStage({ x: 0, y: 0, w: 100, h: 60 })).toBe(false);
  });

  it("is never feathered, so the scene beneath a veil never shows through its rim", () => {
    const container = stage([
      picture({ id: "veil", edge: "soft", frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 } }),
      picture({ id: "half", edge: "soft", frame: { x: 50, y: 0, w: 50, h: 100, rotation: 0 } }),
    ]);
    const [veil, half] = [...container.querySelectorAll("img")].map((img) => img.parentElement!);
    expect(veil.style.maskImage).toBe("");
    expect(half.style.maskImage).toContain("to right");
  });
});
