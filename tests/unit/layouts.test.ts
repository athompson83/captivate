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
    };

    const relaid = relayoutScene(original, "statement");
    expect(relaid.background).toEqual(original.background);
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

describe("an accented claim", () => {
  it("carries the emphasis as a token, so re-theming moves it", () => {
    const content = composeScene("statement", {
      heading: "When the system pauses,",
      headingAccent: "survival falls.",
    });
    const heading = content.elements.find((e) => e.type === "heading");
    expect(heading).toBeTruthy();
    if (heading?.type !== "heading") return;

    expect(heading.content).toHaveLength(2);
    expect(heading.content[0].color).toBeUndefined();
    expect(heading.content[1]).toMatchObject({
      text: "survival falls.",
      color: { kind: "token", token: "accent" },
    });
    // One element, not two: auto-fit and wrapping still see one block of type.
    expect(content.elements.filter((e) => e.type === "heading")).toHaveLength(1);
  });

  it("survives a change of layout instead of flattening back to one colour", () => {
    const original = composeScene("statement", {
      heading: "When the system pauses,",
      headingAccent: "survival falls.",
    });
    const relaid = relayoutScene(original, "title");
    const heading = relaid.elements.find((e) => e.type === "heading");
    if (heading?.type !== "heading") throw new Error("no heading");

    expect(heading.content.some((run) => run.color?.kind === "token")).toBe(true);
    expect(heading.content.map((r) => r.text).join("")).toContain("survival falls.");
  });

  it("is just a heading when no accent is given", () => {
    const content = composeScene("statement", { heading: "One idea" });
    const heading = content.elements.find((e) => e.type === "heading");
    if (heading?.type !== "heading") throw new Error("no heading");
    expect(heading.content).toEqual([{ text: "One idea" }]);
  });
});

/**
 * What a composed scene must not do.
 *
 * These are the failures a schema check cannot see: `composeScene` returned a
 * perfectly valid `SceneContent` in every case below, and the scene was still
 * wrong on a projector. All three were found by rendering the fifteen layouts
 * and looking at them.
 */
describe("a scene composed from content the author gave", () => {
  it("degrades a cover to a title slide when the editor has no picture for it", () => {
    // Composing a cover always lays down a veil, because generation fills
    // that slot from a stock search afterwards. The editor's "change layout"
    // control has no sourcing pass, so choosing Cover for a scene whose image
    // slot is empty drew a full-bleed grey placeholder with the deck's title
    // on it, over the same title beneath — one scene, two headings.
    const source = composeScene("split-left", {
      heading: "Recognising shock",
      media: { url: "", alt: "" },
    });
    const covered = relayoutScene(source, "cover");

    expect(covered.layout).toBe("cover");
    expect(covered.elements.filter((element) => element.type === "heading")).toHaveLength(1);
    expect(covered.elements.some((element) => element.id.startsWith("veil_"))).toBe(false);
  });

  it("keeps the veil when the scene does have a picture", () => {
    const source = composeScene("split-left", {
      heading: "Recognising shock",
      media: { url: "https://example.com/theatre.jpg", alt: "A lecture theatre" },
    });
    expect(relayoutScene(source, "cover").elements.some((el) => el.id.startsWith("veil_"))).toBe(
      true,
    );
  });

  it("still composes an empty veil for generation to fill later", () => {
    // The dress pass sources a photograph *after* the scene exists, so this
    // placeholder is the thing it fills. Removing it would mean no generated
    // deck could ever get a cover photograph at all.
    const composed = composeScene("cover", {
      heading: "Recognising shock",
      media: { url: "", alt: "a night road" },
    });
    const veil = composed.elements.find((el) => el.id.startsWith("veil_") && el.type === "image");
    expect(veil).toBeDefined();
    expect(veil && "animation" in veil ? veil.animation.exit : null).toBe("zoom");
  });

  it("renders bullets into every layout that has somewhere to put them", () => {
    // `closing` had a heading and a subheading but no body slot, so every
    // bullet handed to it vanished — including in five shipped templates.
    const bullets = ["Treat perfusion, not numbers", "Trust the skin", "Escalate early"];
    const withBody = (NAMED_LAYOUTS as SceneLayout[]).filter((layout) => layoutSlots(layout).body);

    expect(withBody).toContain("closing");
    expect(withBody.length).toBeGreaterThan(4);

    for (const layout of withBody) {
      const rendered = JSON.stringify(composeScene(layout, { heading: "H", bullets }).elements);
      for (const bullet of bullets) {
        expect(rendered, `${layout} dropped "${bullet}"`).toContain(bullet);
      }
    }
  });

  it("has no layout that accepts a body and then throws the bullets away", () => {
    // The inverse of the above, stated as the invariant it really is: a slot
    // that exists must be filled, and a layout with no slot — a title, a
    // section marker — is a misuse the editor prevents rather than a silent
    // loss here.
    for (const layout of NAMED_LAYOUTS as SceneLayout[]) {
      const composed = composeScene(layout, { heading: "H", bullets: ["One"] });
      const hasList = composed.elements.some((element) => element.type === "list");
      expect(hasList, layout).toBe(Boolean(layoutSlots(layout).body));
    }
  });

  it("leaves a bulleted list ranged left, even where the layout is centred", () => {
    // Centred lines against left-hand markers reads as a rendering fault. The
    // closing layout centres the list's *frame* instead.
    const composed = composeScene("closing", { heading: "Take away", bullets: ["One", "Two"] });
    const list = composed.elements.find((element) => element.type === "list");
    expect(list).toBeDefined();
    expect(list && "style" in list ? list.style.align : null).toBe("left");

    const slots = layoutSlots("closing");
    const body = slots.body!;
    // Centred as a block: equal air either side.
    expect(body.x).toBeCloseTo(100 - (body.x + body.w), 1);
  });
});

/**
 * Type sizes, as a floor rather than a taste.
 *
 * The theme's `scale.body` exists so body text can be read from the back of a
 * room. Composing a list at 0.56 of it put bullets at around twenty pixels on
 * a 1600-pixel stage — legible on a laptop while writing, and not from row
 * fifteen. Growing them is safe because `fitTextSize` only ever shrinks.
 */
describe("composed text is sized to be read from the back of a room", () => {
  const sizeOf = (
    layout: SceneLayout,
    type: string,
    content: Parameters<typeof composeScene>[1],
  ) => {
    const element = composeScene(layout, content).elements.find((e) => e.type === type);
    return element && "style" in element ? element.style.size : null;
  };

  it("sets a list near the theme's own body scale", () => {
    expect(
      sizeOf("bullets", "list", { heading: "H", bullets: ["One", "Two"] }),
    ).toBeGreaterThanOrEqual(0.85);
  });

  it("sets a card's body high enough to read across three columns", () => {
    const size = sizeOf("three-up", "callout", {
      heading: "H",
      cards: [{ title: "Skin", body: "Colour and temperature." }],
    });
    expect(size).toBeGreaterThanOrEqual(0.6);
  });

  it("sets code high enough that a room can read it", () => {
    const size = sizeOf("code", "code", {
      heading: "H",
      code: { code: "const x = 1;", language: "ts" },
    });
    expect(size).toBeGreaterThanOrEqual(0.55);
  });
});
