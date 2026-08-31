import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { composeScene } from "@/lib/editor/layouts";
import { settleCover, drawableScenes } from "@/lib/editor/place-drawing";
import { buildStepCount } from "@/lib/present/motion";
import { layoutFor } from "@/lib/narrative/generate";
import { parseSceneContent } from "@/lib/schema/presentation";
import { Stage } from "@/components/stage/stage";
import { getTheme } from "@/lib/schema/theme";

/**
 * The cover: a title slide with a veil over it.
 *
 * The contract under test is the degradation chain — a cover with an image is
 * a full-bleed photograph plus a white display title that both lift on the
 * first advance; a cover whose image never arrived is exactly a title slide,
 * never a full-screen grey placeholder as the opening of someone's talk.
 */

const withImage = () =>
  composeScene("cover", {
    eyebrow: "Module 1",
    heading: "Ninety seconds without oxygen",
    subheading: "What the first minute decides",
    media: { url: "/api/assets/abc/content", alt: "a night road", assetId: "abc" },
  });

const withPlaceholder = () =>
  composeScene("cover", {
    heading: "Ninety seconds without oxygen",
    media: { url: "", alt: "a night road" },
  });

describe("composeScene cover", () => {
  it("lays a veil — image and display title — over a real title composition", () => {
    const content = withImage();
    const veil = content.elements.filter((el) => el.id.startsWith("veil_"));
    expect(veil).toHaveLength(2);

    const image = veil.find((el) => el.type === "image")!;
    expect(image.type).toBe("image");
    if (image.type === "image") {
      expect(image.frame).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
      expect(image.scrim).toBeGreaterThan(0);
    }
    expect(image.animation.exit).toBe("zoom");

    const title = veil.find((el) => el.type === "heading")!;
    expect(title.animation.exit).toBe("fade");

    // The veil is on top: both veil elements come after everything beneath.
    const firstVeilIndex = content.elements.findIndex((el) => el.id.startsWith("veil_"));
    expect(content.elements.slice(firstVeilIndex).every((el) => el.id.startsWith("veil_"))).toBe(
      true,
    );
  });

  it("keeps the beneath composition a finished title slide, already there when the veil lifts", () => {
    const content = withImage();
    const beneath = content.elements.filter((el) => !el.id.startsWith("veil_"));
    expect(beneath.length).toBeGreaterThanOrEqual(3); // eyebrow, heading, subheading
    for (const el of beneath) {
      expect(el.animation.entrance).toBe("none");
      expect(el.animation.exit).toBe("none");
    }
  });

  it("composes no veil at all without media — a cover degrades to a title slide", () => {
    const content = composeScene("cover", { heading: "The talk" });
    expect(content.layout).toBe("cover");
    expect(content.elements.some((el) => el.id.startsWith("veil_"))).toBe(false);
    expect(content.elements.some((el) => el.type === "image")).toBe(false);
  });

  it("survives the storage round trip with its exits intact", () => {
    const content = withImage();
    const reloaded = parseSceneContent(JSON.parse(JSON.stringify(content)));
    expect(reloaded.recovered).toBe(false);
    const image = reloaded.content.elements.find((el) => el.type === "image")!;
    expect(image.animation.exit).toBe("zoom");
    expect(reloaded.content.layout).toBe("cover");
  });

  it("defaults exit to none for content stored before exits existed", () => {
    const content = withImage();
    const stored = JSON.parse(JSON.stringify(content)) as {
      elements: { animation: Record<string, unknown> }[];
    };
    for (const el of stored.elements) delete el.animation.exit;
    const reloaded = parseSceneContent(stored);
    expect(reloaded.content.elements.length).toBeGreaterThan(0);
    for (const el of reloaded.content.elements) expect(el.animation.exit).toBe("none");
  });
});

describe("settleCover", () => {
  it("strips the whole veil when the image never got filled", () => {
    const settled = settleCover(withPlaceholder());
    expect(settled.elements.some((el) => el.id.startsWith("veil_"))).toBe(false);
    expect(settled.elements.some((el) => el.type === "image")).toBe(false);
    // The title slide beneath survives.
    expect(settled.elements.some((el) => el.type === "heading")).toBe(true);
  });

  it("leaves a filled cover exactly as it is", () => {
    const content = withImage();
    expect(settleCover(content)).toBe(content);
  });

  it("touches nothing on other layouts, placeholders included", () => {
    const split = composeScene("split-left", {
      heading: "h",
      media: { url: "", alt: "empty" },
    });
    expect(settleCover(split)).toBe(split);
  });
});

describe("the veil is a build step", () => {
  it("costs exactly one advance however many elements lift together", () => {
    // The image and the veil title are both dismissed by the same first
    // advance, so the dismissal is one step, not one per element.
    expect(buildStepCount(withImage().elements)).toBe(2);
  });

  it("costs nothing once settled", () => {
    expect(buildStepCount(settleCover(withPlaceholder()).elements)).toBe(1);
  });
});

describe("the cover in the generation pipeline", () => {
  it("opens the deck for hook-ish roles at index 0 when the choice is Captivate's", () => {
    expect(layoutFor("auto", "hook", 0)).toBe("cover");
    expect(layoutFor("imagery", "provocation", 0)).toBe("cover");
    // An explicit intent still wins, as it does everywhere else.
    expect(layoutFor("statement", "question", 0)).toBe("statement");
    // Only the opening: the same roles later are not covers.
    expect(layoutFor("auto", "hook", 3)).not.toBe("cover");
  });

  it("is never given line art — the drawing pass skips covers like backdrops", () => {
    const scenes = [{ content: withPlaceholder(), imagePrompt: "a night road" }];
    expect(drawableScenes(scenes, 6)).toEqual([]);
  });
});

describe("dismissal on the stage", () => {
  const theme = getTheme("midnight");

  const veilWrapper = (container: HTMLElement) => {
    const img = container.querySelector("img")!;
    expect(img).toBeTruthy();
    return img.closest('div[style*="pointer-events: none"]');
  };

  it("shows the veil at step 0 and dismisses it from the pointer at step 1, in play mode", () => {
    const shown = render(
      <Stage content={withImage()} theme={theme} aspect="16:9" fixedScale={1} play step={0} />,
    );
    expect(veilWrapper(shown.container)).toBeNull();
    shown.unmount();

    const dismissed = render(
      <Stage content={withImage()} theme={theme} aspect="16:9" fixedScale={1} play step={1} />,
    );
    expect(veilWrapper(dismissed.container)).not.toBeNull();
  });

  it("never dismisses outside play mode — the editor and thumbnails show the finished cover", () => {
    const { container } = render(
      <Stage content={withImage()} theme={theme} aspect="16:9" fixedScale={1} step={5} />,
    );
    expect(veilWrapper(container)).toBeNull();
  });
});
