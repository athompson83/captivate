// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { composeScene } from "@/lib/editor/layouts";
import { createElement } from "@/lib/editor/element-factory";
import { ImageElement, parseSceneContent } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { Stage } from "@/components/stage/stage";

/**
 * How a picture meets the page.
 *
 * The owner's brief was to get out of the slides-at-right-angles mindset,
 * and the right angles are in the content: a photograph ending at a hard
 * vertical line beside a heading is a slide, whatever the camera does. So
 * every composed picture is soft — rounded and feathered on every side —
 * and the renderer masks it rather than clipping it. Stored rows that
 * predate the field keep the hard edge they had; an author can choose
 * either from the inspector.
 */

const theme = getTheme("midnight");

describe("the image edge", () => {
  it("defaults to hard for stored rows that predate the field", () => {
    const parsed = ImageElement.parse({
      id: "i1",
      type: "image",
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      url: "",
    });
    expect(parsed.edge).toBe("hard");
  });

  it("is soft on every composed picture, the veil included", () => {
    for (const layout of ["split-left", "split-right", "media-full", "explainer"] as const) {
      const content = composeScene(layout, {
        heading: "H",
        media: { url: "https://example.com/i.jpg", alt: "a" },
        cards: [{ title: "a", body: "b" }],
      });
      const image = content.elements.find((el) => el.type === "image");
      expect(image?.type === "image" && image.edge, layout).toBe("soft");
    }
    const cover = composeScene("cover", {
      heading: "H",
      media: { url: "https://example.com/i.jpg", alt: "a" },
    });
    const veil = cover.elements.find((el) => el.type === "image" && el.id.startsWith("veil_"));
    expect(veil?.type === "image" && veil.edge).toBe("soft");
  });

  it("is soft on a picture an author inserts", () => {
    const image = createElement("image");
    expect(image.type === "image" && image.edge).toBe("soft");
  });

  it("feathers a soft picture on all four sides and rounds it generously", () => {
    const { content } = parseSceneContent({
      version: 1,
      layout: "custom",
      background: { kind: "theme" },
      elements: [
        { ...createElement("image"), id: "soft", url: "https://example.com/i.jpg", edge: "soft" },
        { ...createElement("image"), id: "hard", url: "https://example.com/i.jpg", edge: "hard" },
      ],
      themeOverride: null,
    });
    const { container } = render(
      <Stage content={content} theme={theme} aspect="16:9" fixedScale={1} />,
    );
    const boxes = [...container.querySelectorAll("img")].map(
      (img) => img.parentElement as HTMLElement,
    );
    const [soft, hard] = boxes;
    expect(soft.style.maskImage).toContain("to right");
    expect(soft.style.maskImage).toContain("to bottom");
    expect(parseFloat(soft.style.borderRadius)).toBeGreaterThan(
      parseFloat(hard.style.borderRadius),
    );
    expect(hard.style.maskImage).toBe("");
  });
});
