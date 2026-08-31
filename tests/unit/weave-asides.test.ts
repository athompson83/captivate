import { describe, expect, it } from "vitest";
import { weaveAsides, type GeneratedSceneDraft } from "@/lib/ai/weave-asides";
import { composeScene } from "@/lib/editor/layouts";
import { GeneratedScene } from "@/lib/ai/schemas";

/**
 * Asides become detail scenes wired to hotspots — after ids exist, in the
 * same payload. The properties that matter: a detail row lands right after
 * its parent with `flowRole: "detail"`, the parent's hotspot points at the
 * detail's actual id, and a deck with no asides comes out exactly as it went
 * in, row for row.
 */

let counter = 0;
const nextId = () => `id-${++counter}`;

const draft = (
  momentId: string,
  detail: GeneratedSceneDraft["detail"] = null,
  layout: Parameters<typeof composeScene>[0] = "bullets",
): GeneratedSceneDraft => ({
  momentId,
  title: `Scene ${momentId}`,
  content: composeScene(layout, { heading: `Scene ${momentId}`, bullets: ["a claim"] }),
  speakerNotes: "notes",
  detail,
});

const anAside = () => ({
  label: "See the mechanism",
  title: "The mechanism",
  content: composeScene("bullets", { heading: "The mechanism", bullets: ["how", "why"] }),
  speakerNotes: "aside notes",
});

describe("weaveAsides", () => {
  it("leaves a deck with no asides untouched, row for row", () => {
    const rows = weaveAsides([draft("m1"), draft("m2")], nextId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.flowRole)).toEqual(["main", "main"]);
    expect(rows.map((row) => row.momentId)).toEqual(["m1", "m2"]);
  });

  it("weaves the detail scene immediately after its parent, off the running order", () => {
    const rows = weaveAsides([draft("m1", anAside()), draft("m2")], nextId);
    expect(rows.map((row) => row.flowRole)).toEqual(["main", "detail", "main"]);
    const detail = rows[1];
    expect(detail.momentId).toBeNull();
    expect(detail.filedUnder).toBe("m1");
    expect(detail.title).toBe("The mechanism");
  });

  it("wires the parent's hotspot to the detail scene's actual id, with the aside's label", () => {
    const rows = weaveAsides([draft("m1", anAside())], nextId);
    const [parent, detail] = rows;
    const carrier = parent.content.elements.find((el) => el.hotspot !== null)!;
    expect(carrier).toBeTruthy();
    expect(carrier.hotspot).toEqual({
      targetSceneId: detail.id,
      label: "See the mechanism",
    });
  });

  it("prefers the most specific element as the carrier — a card over the heading", () => {
    const withCards = draft("m1", anAside(), "three-up");
    withCards.content = composeScene("three-up", {
      heading: "Three ideas",
      cards: [
        { title: "One", body: "first" },
        { title: "Two", body: "second" },
        { title: "Three", body: "third" },
      ],
    });
    const rows = weaveAsides([withCards], nextId);
    const carrier = rows[0].content.elements.find((el) => el.hotspot !== null)!;
    expect(carrier.type).toBe("callout");
  });

  it("drops an aside rather than weaving one no element can carry", () => {
    const bare = draft("m1", anAside());
    bare.content = { ...bare.content, elements: [] };
    const rows = weaveAsides([bare], nextId);
    expect(rows).toHaveLength(1);
    expect(rows[0].flowRole).toBe("main");
  });

  it("never mutates the input scene's content", () => {
    const input = draft("m1", anAside());
    const before = JSON.stringify(input.content);
    weaveAsides([input], nextId);
    expect(JSON.stringify(input.content)).toBe(before);
  });

  it("keeps row 0 a main scene whatever comes in — the seed-id swap depends on it", () => {
    const rows = weaveAsides([draft("m1", anAside()), draft("m2", anAside())], nextId);
    expect(rows[0].flowRole).toBe("main");
  });
});

describe("the aside at the schema boundary", () => {
  it("defaults to no aside and an empty photo query", () => {
    const scene = GeneratedScene.parse({ title: "T", layout: "bullets" });
    expect(scene.aside).toBeNull();
    expect(scene.photoQuery).toBe("");
  });

  it("accepts a real aside and holds its caps", () => {
    const scene = GeneratedScene.parse({
      title: "T",
      layout: "bullets",
      aside: { label: "See it", title: "Detail", bullets: ["one", "two"] },
    });
    expect(scene.aside?.label).toBe("See it");
    expect(() =>
      GeneratedScene.parse({
        title: "T",
        layout: "bullets",
        aside: { label: "x".repeat(61), title: "Detail" },
      }),
    ).toThrow();
  });
});
