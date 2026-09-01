import { describe, expect, it } from "vitest";
import { movementAt, movementsOf, nextMovement } from "@/components/present/movement-rail";
import { TEMPLATES, buildTemplateScenes, templateMovements } from "@/lib/templates/registry";
import { composeScene } from "@/lib/editor/layouts";
import type { Scene, Section } from "@/lib/schema/presentation";

function scene(i: number, sectionId: string | null, flowRole: "main" | "detail" = "main"): Scene {
  return {
    id: `00000000-0000-4000-8000-00000000000${i}`,
    presentationId: "00000000-0000-4000-8000-000000000fff",
    sectionId,
    position: i,
    flowRole,
    title: `Scene ${i}`,
    content: composeScene("statement", { heading: `Heading ${i}` }),
    placement: null,
    momentId: null,
    speakerNotes: "",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function section(id: string, title: string, label: string): Section {
  return {
    id,
    presentationId: "00000000-0000-4000-8000-000000000fff",
    title,
    label,
    purpose: "",
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("movements", () => {
  const sections = [section("a", "Opening", "OPEN"), section("b", "The evidence", "")];
  const scenes = [scene(0, "a"), scene(1, "a"), scene(2, "b"), scene(3, "b"), scene(4, "b")];

  it("groups consecutive scenes into movements", () => {
    const movements = movementsOf(scenes, sections);
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({ label: "OPEN", start: 0, end: 2 });
    expect(movements[1]).toMatchObject({ start: 2, end: 5 });
  });

  it("falls back to the section title where no short label is set", () => {
    // Every deck with sections gets a working rail without being re-authored.
    expect(movementsOf(scenes, sections)[1].label).toBe("The evidence");
  });

  it("keeps unsectioned scenes rather than dropping them", () => {
    // Half-organised is a normal state. Hiding the loose scenes would make the
    // rail lie about how long the presentation is.
    const mixed = [scene(0, null), scene(1, null), scene(2, "a")];
    const movements = movementsOf(mixed, sections);
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({ label: "", start: 0, end: 2 });
    expect(movements[1].label).toBe("OPEN");
  });

  it("does not merge two separate stretches of the same section", () => {
    // Returning to an earlier movement is a real narrative move; merging the
    // two stretches would draw one movement spanning the middle of the deck.
    const returning = [scene(0, "a"), scene(1, "b"), scene(2, "a")];
    expect(movementsOf(returning, sections)).toHaveLength(3);
  });

  it("identifies a returning section's movement by scene, not by section id", () => {
    // Because a section can appear twice, two movements legitimately share an
    // id — so resolving "which movement are we establishing?" by section id
    // silently picks the first stretch and numbers the signpost wrongly.
    // `present-root` looks the movement up by scene index for this reason.
    const returning = [scene(0, "a"), scene(1, "b"), scene(2, "a")];
    const movements = movementsOf(returning, sections);

    const bySectionId = movements.findIndex((m) => m.id === "a");
    expect(bySectionId).toBe(0); // the wrong stretch when we are in the second

    const byScene = movementAt(movements, 2);
    expect(byScene).toMatchObject({ id: "a", start: 2, end: 3 });
    expect(movements.indexOf(byScene!)).toBe(2);
  });

  it("locates the movement a scene is in", () => {
    const movements = movementsOf(scenes, sections);
    expect(movementAt(movements, 0)?.label).toBe("OPEN");
    expect(movementAt(movements, 4)?.label).toBe("The evidence");
    expect(movementAt(movements, 99)).toBeNull();
  });

  it("signposts the next movement only at the end of the current one", () => {
    // A signpost means something as a movement ends and nothing in the middle.
    const movements = movementsOf(scenes, sections);
    expect(nextMovement(movements, 0)).toBeNull();
    expect(nextMovement(movements, 1)?.label).toBe("The evidence");
    expect(nextMovement(movements, 4)).toBeNull();
  });

  it("handles a presentation with no scenes at all", () => {
    expect(movementsOf([], sections)).toEqual([]);
    expect(nextMovement([], 0)).toBeNull();
  });
});

describe("templates carry a shape", () => {
  it("gives every template scene a movement", () => {
    for (const template of TEMPLATES) {
      for (const scene of template.scenes) {
        expect(scene.movement, `${template.id} / ${scene.title}`).toBeTruthy();
      }
    }
  });

  it("produces more than one movement for every real template", () => {
    // The rail is worth nothing if a new presentation arrives without a shape,
    // and a single movement is not a shape.
    for (const template of TEMPLATES) {
      if (template.id === "blank") continue;
      const movements = templateMovements(buildTemplateScenes(template, "Test"));
      expect(movements.length, template.id).toBeGreaterThan(1);
    }
  });

  it("covers every scene with a movement, contiguously", () => {
    for (const template of TEMPLATES) {
      const scenes = buildTemplateScenes(template, "Test");
      const movements = templateMovements(scenes);
      expect(movements[0].start).toBe(0);
      expect(movements[movements.length - 1].end).toBe(scenes.length);
      for (let i = 1; i < movements.length; i += 1) {
        expect(movements[i].start).toBe(movements[i - 1].end);
      }
    }
  });

  it("merges consecutive scenes sharing a movement", () => {
    expect(
      templateMovements([{ movement: "OPEN" }, { movement: "OPEN" }, { movement: "CLOSE" }]),
    ).toEqual([
      { label: "OPEN", start: 0, end: 2 },
      { label: "CLOSE", start: 2, end: 3 },
    ]);
  });

  it("drops unlabelled stretches rather than creating a nameless section", () => {
    expect(templateMovements([{ movement: "" }])).toEqual([]);
  });
});

/**
 * Detail scenes are asides, not part of the argument's shape. Counting them in
 * the rail would tell the room a five-scene movement has eight, and the
 * progress spine would never reach its end.
 */
describe("movements exclude detail scenes", () => {
  const sections = [section("a", "Opening", "OPEN"), section("b", "The evidence", "")];

  it("does not let a detail scene start or extend a movement", () => {
    const scenes = [scene(0, "a"), scene(1, "a", "detail"), scene(2, "a"), scene(3, "b")];
    const movements = movementsOf(scenes, sections);
    expect(movements).toHaveLength(2);
    // The detail scene at index 1 sits inside movement "a" without splitting it.
    expect(movements[0]).toMatchObject({ id: "a", start: 0, end: 3 });
    expect(movements[1]).toMatchObject({ id: "b", start: 3, end: 4 });
  });

  it("does not create a movement for a detail scene in its own section", () => {
    const scenes = [scene(0, "a"), scene(1, "b", "detail"), scene(2, "a")];
    const movements = movementsOf(scenes, sections);
    expect(movements.map((m) => m.id)).toEqual(["a"]);
  });

  it("still locates the movement a detail scene sits within", () => {
    const scenes = [scene(0, "a"), scene(1, "a", "detail"), scene(2, "b")];
    const movements = movementsOf(scenes, sections);
    expect(movementAt(movements, 1)?.id).toBe("a");
  });
});

/**
 * The spine measures progress through the argument. Mixing a raw array index
 * with a detail-excluded total ran the fill past its own end: on a deck of
 * three main scenes interleaved with asides, the second main scene reported
 * 3/3 and the rail showed the talk as finished.
 */
describe("rail progress counts the running order", () => {
  const mainOrdinal = (scenes: Scene[], sceneIndex: number) =>
    scenes.slice(0, sceneIndex + 1).filter((s) => s.flowRole !== "detail").length;

  it("counts main scenes only, so the fill never overruns", () => {
    // main, detail, main, detail, main -> 3 in the running order
    const scenes = [
      scene(0, "a"),
      scene(1, "a", "detail"),
      scene(2, "a"),
      scene(3, "a", "detail"),
      scene(4, "a"),
    ];
    const total = scenes.filter((s) => s.flowRole !== "detail").length;
    expect(total).toBe(3);

    expect(mainOrdinal(scenes, 0)).toBe(1);
    expect(mainOrdinal(scenes, 2)).toBe(2); // sceneIndex + 1 would have said 3
    expect(mainOrdinal(scenes, 4)).toBe(3);

    for (const i of [0, 2, 4]) expect(mainOrdinal(scenes, i) / total).toBeLessThanOrEqual(1);
  });

  it("holds the ordinal while the presentation is inside an aside", () => {
    const scenes = [scene(0, "a"), scene(1, "a", "detail"), scene(2, "a")];
    // Diving into the aside at index 1 does not advance the argument.
    expect(mainOrdinal(scenes, 0)).toBe(1);
    expect(mainOrdinal(scenes, 1)).toBe(1);
  });
});
