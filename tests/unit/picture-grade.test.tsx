// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { composeScene } from "@/lib/editor/layouts";
import { createElement } from "@/lib/editor/element-factory";
import { ImageElement, parseSceneContent } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { Stage } from "@/components/stage/stage";
import { GRAIN_DATA_URL, coversStage, gradeCss } from "@/lib/present/grade";

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
  it("is in the theme's tokens and nothing else", () => {
    for (const grade of ["tint", "duotone"] as const) {
      const css = gradeCss(grade);
      expect(css.layers.length).toBeGreaterThan(0);
      for (const layer of css.layers) expect(layer.background).toMatch(/^var\(--stage-/);
      expect(css.grain).toBeGreaterThan(0);
    }
    expect(gradeCss("none")).toEqual({ filter: "", layers: [], grain: 0 });
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

  it("lays the accent and grain over a real picture, and nothing over a placeholder", () => {
    const container = stage([
      picture({ id: "tinted", grade: "tint" }),
      picture({ id: "duo", grade: "duotone" }),
      picture({ id: "plain", grade: "none" }),
      { ...createElement("image"), id: "empty", url: "", grade: "tint" },
    ]);
    const boxes = [...container.querySelectorAll("img")].map((img) => img.parentElement!);
    const [tinted, duo, plain] = boxes;
    expect(tinted.querySelectorAll("[data-grade='tint']")).toHaveLength(1);
    expect(tinted.querySelector("[data-grain]")).not.toBeNull();
    expect((tinted.querySelector("[data-grain]") as HTMLElement).style.backgroundImage).toBe(
      GRAIN_DATA_URL,
    );
    expect(tinted.querySelector("img")!.style.filter).toContain("saturate");
    expect(duo.querySelectorAll("[data-grade='duotone']")).toHaveLength(2);
    expect(plain.querySelector("[data-grade]")).toBeNull();
    expect(plain.querySelector("[data-grain]")).toBeNull();
    expect(container.querySelectorAll("[data-grade]")).toHaveLength(3);
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
