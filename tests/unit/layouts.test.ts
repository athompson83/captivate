import { describe, expect, it } from "vitest";
import {
  ALL_LAYOUTS,
  composeScene,
  extractContent,
  layoutSlots,
  relayoutScene,
} from "@/lib/editor/layouts";
import {
  SAFE_MARGIN,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  plainText,
  type SceneLayout,
} from "@/lib/schema/presentation";
import { SceneContent } from "@/lib/schema/presentation";

const NAMED_LAYOUTS = ALL_LAYOUTS.map((l) => l.value).filter((l) => l !== "custom");

describe("layout slots", () => {
  it.each(NAMED_LAYOUTS)("keeps %s slots on stage", (layout) => {
    const slots = layoutSlots(layout as SceneLayout);
    for (const [name, slot] of Object.entries(slots)) {
      const frames = Array.isArray(slot) ? slot : [slot];
      for (const f of frames) {
        if (!f) continue;
        expect(f.x, `${layout}.${name}.x`).toBeGreaterThanOrEqual(0);
        expect(f.y, `${layout}.${name}.y`).toBeGreaterThanOrEqual(0);
        expect(f.x + f.w, `${layout}.${name} right edge`).toBeLessThanOrEqual(STAGE_WIDTH + 0.001);
        expect(f.y + f.h, `${layout}.${name} bottom edge`).toBeLessThanOrEqual(
          STAGE_HEIGHT + 0.001,
        );
      }
    }
  });

  it("keeps text slots inside the safe area for text-only layouts", () => {
    // Media may bleed to the edge; text must not, or a projector crops it.
    for (const layout of ["bullets", "two-column", "three-up", "code"] as SceneLayout[]) {
      const slots = layoutSlots(layout);
      const textFrames = [slots.heading, slots.body, slots.bodyB, ...(slots.cards ?? [])].filter(
        Boolean,
      );
      for (const f of textFrames) {
        expect(f!.x, layout).toBeGreaterThanOrEqual(SAFE_MARGIN - 0.001);
        expect(f!.x + f!.w, layout).toBeLessThanOrEqual(STAGE_WIDTH - SAFE_MARGIN + 0.001);
      }
    }
  });

  it("gives three-up exactly three non-overlapping cards", () => {
    const slots = layoutSlots("three-up");
    expect(slots.cards).toHaveLength(3);
    const [a, b, c] = slots.cards!;
    expect(a.x + a.w).toBeLessThanOrEqual(b.x + 0.001);
    expect(b.x + b.w).toBeLessThanOrEqual(c.x + 0.001);
  });
});

describe("composeScene", () => {
  it.each(NAMED_LAYOUTS)("produces valid schema output for %s", (layout) => {
    const content = composeScene(layout as SceneLayout, {
      eyebrow: "Chapter 1",
      heading: "A heading",
      subheading: "A subheading",
      body: "Some body copy.",
      bullets: ["One", "Two", "Three"],
      bulletsB: ["Four", "Five"],
      quote: "A quotable line.",
      attribution: "Someone",
      caption: "A caption",
      cards: [
        { title: "A", body: "a" },
        { title: "B", body: "b" },
        { title: "C", body: "c" },
      ],
      chart: { chart: "column", data: [{ label: "x", value: 1 }], summary: "s" },
      code: { code: "const a = 1;", language: "js" },
      media: { url: "https://example.com/i.png", alt: "An image" },
    });

    expect(SceneContent.safeParse(content).success).toBe(true);
    expect(content.layout).toBe(layout);
    expect(content.elements.length).toBeGreaterThan(0);
  });

  it("only emits elements the layout actually has slots for", () => {
    // A statement scene is one idea. Passing bullets must not smuggle a list in.
    const content = composeScene("statement", {
      heading: "One idea",
      bullets: ["a", "b", "c", "d", "e"],
    });
    expect(content.elements.every((e) => e.type !== "list")).toBe(true);
  });

  it("always scrims a full-bleed image so overlaid text stays readable", () => {
    const content = composeScene("media-full", {
      heading: "Over the photo",
      media: { url: "https://example.com/i.jpg", alt: "photo" },
    });
    const image = content.elements.find((e) => e.type === "image");
    expect(image).toBeDefined();
    if (image?.type === "image") expect(image.scrim).toBeGreaterThan(0);
  });

  it("staggers lists of more than two items", () => {
    const content = composeScene("bullets", { heading: "H", bullets: ["a", "b", "c"] });
    const list = content.elements.find((e) => e.type === "list");
    if (list?.type === "list") expect(list.staggered).toBe(true);
  });

  it("gives elements increasing entrance delays so a scene builds in order", () => {
    const content = composeScene("bullets", { eyebrow: "E", heading: "H", bullets: ["a"] });
    const delays = content.elements.map((e) => e.animation.delay);
    const nonZero = delays.filter((d) => d > 0);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it("assigns unique element ids", () => {
    const content = composeScene("three-up", {
      heading: "H",
      cards: [
        { title: "A", body: "a" },
        { title: "B", body: "b" },
        { title: "C", body: "c" },
      ],
    });
    const ids = content.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("relayoutScene", () => {
  it("preserves the heading and bullets when switching layout", () => {
    const original = composeScene("bullets", {
      heading: "Recognising shock",
      bullets: ["Tachycardia", "Narrow pulse pressure", "Delayed capillary refill"],
    });

    const relaid = relayoutScene(original, "two-column");
    const extracted = extractContent(relaid);

    expect(extracted.heading).toBe("Recognising shock");
    expect(extracted.bullets).toEqual([
      "Tachycardia",
      "Narrow pulse pressure",
      "Delayed capillary refill",
    ]);
    expect(relaid.layout).toBe("two-column");
  });

  it("carries the background and transition across a relayout", () => {
    const original = {
      ...composeScene("bullets", { heading: "H", bullets: ["a"] }),
      background: { kind: "solid" as const, color: { kind: "hex" as const, hex: "#123456" } },
      transition: { type: "zoom" as const, duration: 1.2, direction: "up" as const },
    };

    const relaid = relayoutScene(original, "statement");
    expect(relaid.background).toEqual(original.background);
    expect(relaid.transition).toEqual(original.transition);
  });

  it("survives a round trip through every named layout without losing the heading", () => {
    let content = composeScene("title", { heading: "Persistent heading" });
    for (const layout of NAMED_LAYOUTS) {
      content = relayoutScene(content, layout as SceneLayout);
      const heading = content.elements.find((e) => e.type === "heading" || e.type === "quote");
      expect(heading, `lost heading at ${layout}`).toBeDefined();
      if (heading && (heading.type === "heading" || heading.type === "quote")) {
        expect(plainText(heading.content)).toBe("Persistent heading");
      }
    }
  });
});
