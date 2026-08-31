import { describe, expect, it } from "vitest";
import { getTheme } from "@/lib/schema/theme";
import { SceneElement, type Scene } from "@/lib/schema/presentation";
import {
  SLIDE_SIZES,
  boxOf,
  describeOmissions,
  drawingSvg,
  planDeck,
  pointsFor,
  slideOrder,
} from "@/lib/export/deck-plan";

/**
 * Flattening a journey into slides.
 *
 * The translation is lossy by nature — a deck is linear and Captivate's is
 * not — so the thing worth testing is not that it produces slides but *what
 * it does with the parts that have no slide equivalent*. The rule is that
 * nothing an author wrote is silently discarded: it survives on the slide,
 * survives in the notes, or is counted where the export dialog can say so.
 */

const THEME = getTheme("midnight");
const DECK = { title: "Shock", aspectRatio: "16:9" };

let nextId = 0;
const id = () => `00000000-0000-4000-8000-${String((nextId += 1)).padStart(12, "0")}`;

/**
 * Built through the schema rather than hand-shaped.
 *
 * Every element the export sees has been parsed on its way out of the
 * database, so its defaults are filled in — `style`, `animation`, `opacity`.
 * A hand-made fixture without them tests a shape that cannot occur and misses
 * the ones that can.
 */
function element(over: Record<string, unknown> & { type: SceneElement["type"] }): SceneElement {
  return SceneElement.parse({
    id: id(),
    frame: { x: 10, y: 10, w: 50, h: 20, rotation: 0 },
    ...over,
  });
}

function scene(over: Partial<Scene> & { id: string; elements: SceneElement[] }): Scene {
  return {
    id: over.id,
    presentationId: "00000000-0000-4000-8000-00000000ffff",
    sectionId: null,
    position: over.position ?? 0,
    title: over.title ?? "Scene",
    content: {
      layout: "custom",
      background: { kind: "theme" },
      elements: over.elements,
    } as Scene["content"],
    placement: null,
    momentId: null,
    speakerNotes: over.speakerNotes ?? "",
    durationSeconds: null,
    flowRole: over.flowRole ?? "main",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const heading = (text: string) => element({ type: "heading", level: 1, content: [{ text }] });

describe("geometry", () => {
  it("places a scene's normalised units on the slide, unchanged", () => {
    // One renderer serves the editor, the room and this, because geometry is
    // 0-100 and never pixels. A scene cannot look different in PowerPoint.
    const box = boxOf({ x: 50, y: 25, w: 25, h: 50, rotation: 0 }, SLIDE_SIZES["16:9"]);
    expect(box.x).toBeCloseTo(SLIDE_SIZES["16:9"].width / 2, 5);
    expect(box.y).toBeCloseTo(SLIDE_SIZES["16:9"].height / 4, 5);
    expect(box.w).toBeCloseTo(SLIDE_SIZES["16:9"].width / 4, 5);
  });

  it("uses the 4:3 canvas when the deck is 4:3", () => {
    const plan = planDeck(
      { ...DECK, aspectRatio: "4:3" },
      [scene({ id: id(), elements: [] })],
      THEME,
    );
    expect(plan.size).toEqual(SLIDE_SIZES["4:3"]);
  });

  it("turns the theme's type scale into points a projector can read", () => {
    const h1 = pointsFor(THEME.scale.h1, SLIDE_SIZES["16:9"].width);
    const body = pointsFor(THEME.scale.body, SLIDE_SIZES["16:9"].width);
    expect(h1).toBeGreaterThan(body);
    // A heading under about 30pt is unreadable from the back of a room, and
    // the whole point of the stage's scale is that it never is.
    expect(h1).toBeGreaterThan(30);
  });
});

describe("what becomes a slide", () => {
  it("keeps an aside next to the scene that dives into it", () => {
    const asideId = id();
    const parent = scene({
      id: id(),
      title: "Parent",
      elements: [
        element({
          type: "heading",
          level: 1,
          content: [{ text: "Parent" }],
          hotspot: { targetSceneId: asideId, label: "" },
        }),
      ],
    });
    const aside = scene({ id: asideId, title: "Aside", flowRole: "detail", elements: [] });
    const after = scene({ id: id(), title: "After", elements: [] });

    // Stored order puts the aside last; the export puts it after its parent.
    const order = slideOrder([parent, after, aside]);
    expect(order.map((s) => s.title)).toEqual(["Parent", "Aside", "After"]);
  });

  it("keeps an aside nothing points at rather than dropping it", () => {
    // It is still the author's writing. Orphaned, not deleted.
    const orphan = scene({ id: id(), title: "Orphan", flowRole: "detail", elements: [] });
    const main = scene({ id: id(), title: "Main", elements: [] });
    expect(slideOrder([main, orphan]).map((s) => s.title)).toEqual(["Main", "Orphan"]);
  });

  it("marks which slides are asides rather than beats of the talk", () => {
    const aside = scene({ id: id(), title: "Aside", flowRole: "detail", elements: [] });
    const main = scene({ id: id(), title: "Main", elements: [] });
    const plan = planDeck(DECK, [main, aside], THEME);
    expect(plan.slides.map((s) => s.aside)).toEqual([false, true]);
  });
});

describe("the dive survives as a link", () => {
  it("points a hotspot at the slide the camera would have flown to", () => {
    const asideId = id();
    const parent = scene({
      id: id(),
      elements: [
        element({
          type: "heading",
          level: 1,
          content: [{ text: "Click me" }],
          hotspot: { targetSceneId: asideId, label: "More" },
        }),
      ],
    });
    const aside = scene({ id: asideId, flowRole: "detail", elements: [] });

    const plan = planDeck(DECK, [parent, aside], THEME);
    const shape = plan.slides[0].shapes[0];
    expect(shape.kind).toBe("text");
    // Slide 2 is the aside, placed right after its parent.
    expect("linkToSlide" in shape ? shape.linkToSlide : undefined).toBe(2);
    expect(plan.omissions.some((o) => o.kind === "hotspot")).toBe(false);
  });

  it("counts a hotspot whose target is not in the export instead of writing a dead link", () => {
    const parent = scene({
      id: id(),
      elements: [
        element({
          type: "heading",
          level: 1,
          content: [{ text: "Broken" }],
          hotspot: { targetSceneId: "missing", label: "" },
        }),
      ],
    });
    const plan = planDeck(DECK, [parent], THEME);
    const shape = plan.slides[0].shapes[0];
    expect("linkToSlide" in shape ? shape.linkToSlide : undefined).toBeUndefined();
    expect(plan.omissions.find((o) => o.kind === "hotspot")?.count).toBe(1);
  });
});

describe("nothing is silently discarded", () => {
  it("says when a build-up was flattened", () => {
    const built = scene({
      id: id(),
      elements: [
        element({
          type: "text",
          content: [{ text: "Second" }],
          animation: {
            entrance: "fade",
            delay: 0,
            duration: 0.5,
            emphasis: "none",
            onAdvance: true,
            exit: "none",
          },
        }),
      ],
    });
    const plan = planDeck(DECK, [built], THEME);
    // The element is still on the slide; what is lost is only its timing.
    expect(plan.slides[0].shapes).toHaveLength(1);
    expect(plan.omissions.find((o) => o.kind === "build")?.detail).toMatch(/at once/i);
  });

  it("carries a video's address into the notes rather than leaving a hole", () => {
    const withVideo = scene({
      id: id(),
      speakerNotes: "Play this after the question.",
      elements: [
        element({
          type: "video",
          assetId: null,
          url: "https://example.com/clip.mp4",
          poster: "",
          autoplay: false,
        }),
      ],
    });
    const plan = planDeck(DECK, [withVideo], THEME);
    expect(plan.slides[0].shapes).toHaveLength(0);
    expect(plan.slides[0].notes).toContain("https://example.com/clip.mp4");
    expect(plan.slides[0].notes).toContain("Play this after the question.");
    expect(plan.omissions.find((o) => o.kind === "video")).toBeTruthy();
  });

  it("names a drawing's stages in the notes, since a slide cannot draw itself", () => {
    const drawn = scene({
      id: id(),
      elements: [
        element({
          type: "drawing",
          viewBox: { width: 100, height: 60 },
          paths: [{ d: "M0 0 L10 10", stage: 0 }],
          stageLabels: ["The vessel", "The leak"],
          ink: "accent",
          strokeWidth: 2,
          paceSeconds: 1.6,
          prompt: "",
          alt: "A leaking vessel",
        }),
      ],
    });
    const plan = planDeck(DECK, [drawn], THEME);
    expect(plan.slides[0].notes).toContain("The vessel → The leak");
    expect(plan.slides[0].shapes[0].kind).toBe("drawing");
  });

  it("counts an icon rather than pretending it made it across", () => {
    const withIcon = scene({
      id: id(),
      elements: [element({ type: "icon", name: "heart", color: null, strokeWidth: 1.75 })],
    });
    const plan = planDeck(DECK, [withIcon], THEME);
    expect(plan.slides[0].shapes).toHaveLength(0);
    expect(plan.omissions.find((o) => o.kind === "icon")).toBeTruthy();
  });

  it("skips a hidden element, because the room never saw it", () => {
    const withHidden = scene({
      id: id(),
      elements: [
        element({
          type: "heading",
          level: 1,
          content: [{ text: "Hidden" }],
          hidden: true,
        }),
      ],
    });
    expect(planDeck(DECK, [withHidden], THEME).slides[0].shapes).toHaveLength(0);
  });

  it("gives every omission a sentence somebody can read", () => {
    const messy = scene({
      id: id(),
      elements: [
        element({ type: "icon", name: "heart", color: null, strokeWidth: 1.75 }),
        element({ type: "embed", url: "https://example.com", title: "" }),
      ],
    });
    const lines = describeOmissions(planDeck(DECK, [messy], THEME).omissions);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length).toBeGreaterThan(20);
  });
});

describe("content that does survive", () => {
  it("carries a heading's words and its weight", () => {
    const withHeading = scene({ id: id(), elements: [heading("Shock is a clinical diagnosis")] });
    const shape = planDeck(DECK, [withHeading], THEME).slides[0].shapes[0];
    expect(shape.kind).toBe("text");
    if (shape.kind !== "text") return;
    expect(shape.runs.map((r) => r.text).join("")).toBe("Shock is a clinical diagnosis");
    expect(shape.fontSize).toBeGreaterThan(30);
  });

  it("keeps a list a list rather than flattening it to a paragraph", () => {
    const withList = scene({
      id: id(),
      elements: [
        element({
          type: "list",
          ordered: false,
          items: [[{ text: "One" }], [{ text: "Two" }]],
        }),
      ],
    });
    const shape = planDeck(DECK, [withList], THEME).slides[0].shapes[0];
    expect(shape.kind).toBe("bullets");
    if (shape.kind !== "bullets") return;
    expect(shape.items).toHaveLength(2);
  });

  it("keeps a chart as data, so it stays editable in PowerPoint", () => {
    const withChart = scene({
      id: id(),
      elements: [
        element({
          type: "chart",
          chart: "column",
          title: "Survival",
          data: [{ label: "A", value: 3 }],
          showValues: true,
        }),
      ],
    });
    const shape = planDeck(DECK, [withChart], THEME).slides[0].shapes[0];
    expect(shape.kind).toBe("chart");
    if (shape.kind !== "chart") return;
    expect(shape.points).toEqual([{ label: "A", value: 3 }]);
  });

  it("uppercases text the stage would have uppercased", () => {
    // On the stage it is a rendering transform; a slide has no equivalent that
    // survives editing, so the words are transformed here instead.
    const shouty = scene({
      id: id(),
      elements: [
        element({
          type: "text",
          content: [{ text: "quietly" }],
          style: {
            size: 1,
            weight: 400,
            align: "left",
            valign: "top",
            italic: false,
            underline: false,
            uppercase: true,
            lineHeight: 1.2,
            letterSpacing: 0,
          },
        }),
      ],
    });
    const shape = planDeck(DECK, [shouty], THEME).slides[0].shapes[0];
    if (shape.kind !== "text") throw new Error("expected text");
    expect(shape.runs[0].text).toBe("QUIETLY");
  });
});

describe("colour", () => {
  it("resolves a token against the deck's theme, not to a default", () => {
    // Resolving "hex or give up" turned every themed colour into the default
    // ink — which on a dark theme is the one colour guaranteed to be
    // invisible on the surface it was meant to sit on.
    const accented = scene({
      id: id(),
      elements: [
        element({
          type: "heading",
          level: 1,
          content: [{ text: "Accented" }],
          style: { color: { kind: "token", token: "accent" } },
        }),
      ],
    });
    const shape = planDeck(DECK, [accented], THEME).slides[0].shapes[0];
    if (shape.kind !== "text") throw new Error("expected text");
    expect(shape.color).toBe(THEME.tokens.accent);
    expect(shape.color).not.toBe(THEME.tokens.ink);
  });

  it("takes a literal hex as written", () => {
    const literal = scene({
      id: id(),
      elements: [
        element({
          type: "heading",
          level: 1,
          content: [{ text: "Literal" }],
          style: { color: { kind: "hex", hex: "#123456" } },
        }),
      ],
    });
    const shape = planDeck(DECK, [literal], THEME).slides[0].shapes[0];
    if (shape.kind !== "text") throw new Error("expected text");
    expect(shape.color).toBe("#123456");
  });

  it("paints the slide with a solid scene background, and the theme's canvas otherwise", () => {
    const plain = scene({ id: id(), elements: [] });
    expect(planDeck(DECK, [plain], THEME).slides[0].background.color).toBe(THEME.tokens.canvas);
  });
});

describe("the drawing's SVG", () => {
  it("is a standalone document with the theme's ink, not a colour the model chose", () => {
    const svg = drawingSvg(
      {
        type: "drawing",
        viewBox: { width: 100, height: 50 },
        paths: [{ d: "M0 0 L10 10", stage: 0 }],
        strokeWidth: 2,
      } as never,
      "#ABCDEF",
    );
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('stroke="#ABCDEF"');
    expect(svg).toContain('fill="none"');
  });
});
