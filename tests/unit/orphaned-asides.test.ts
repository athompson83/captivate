import { describe, expect, it } from "vitest";
import { relinkOrphanedDetails } from "@/lib/schema/presentation";
import { composeScene } from "@/lib/editor/layouts";
import type { Scene } from "@/lib/schema/presentation";

/**
 * A detail scene nobody can reach.
 *
 * `repairDanglingHotspots` handles one half of this: a hotspot pointing at a
 * scene that was deleted. The other half had no handler and is the one a
 * regeneration produces every time.
 *
 * An aside is composed as two rows — the parent, whose best element carries a
 * hotspot, and the detail scene it dives to. Regenerating replaces the
 * parent's whole content, hotspot included, while the detail scene survives
 * untouched: it has no `momentId`, so nothing overwrites it and the plan
 * counts it as a hand-made scene to be left alone. Left alone and unreachable.
 * It is `flowRole: "detail"`, so it is invisible to the running order too —
 * the author's aside is simply gone, with no error anywhere and the row still
 * sitting in the database.
 *
 * The relationship is positional and always was: the weave emits parent then
 * detail, and the spec says a detail scene "lands immediately after its
 * parent". So the link can be restored from what is stored.
 */

const scene = (over: Partial<Scene> & { id: string }): Scene => ({
  presentationId: "11111111-1111-4111-8111-111111111111",
  sectionId: null,
  momentId: null,
  title: "A scene",
  content: composeScene("statement", { heading: "A line that carries the argument" }),
  speakerNotes: "",
  durationSeconds: null,
  flowRole: "main",
  position: 0,
  placement: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const linksTo = (s: Scene, id: string) =>
  s.content.elements.some((el) => el.hotspot?.targetSceneId === id);

describe("a detail scene nothing points at", () => {
  it("is wired back to the scene it sits behind", () => {
    const parent = scene({ id: "a", position: 0 });
    const detail = scene({ id: "b", position: 1, flowRole: "detail", title: "The mechanism" });
    const { scenes, repaired } = relinkOrphanedDetails([parent, detail]);

    expect(repaired).toEqual(["a"]);
    expect(linksTo(scenes[0], "b")).toBe(true);
  });

  it("labels the way in from the aside's own title", () => {
    const parent = scene({ id: "a", position: 0 });
    const detail = scene({ id: "b", position: 1, flowRole: "detail", title: "The mechanism" });
    const { scenes } = relinkOrphanedDetails([parent, detail]);
    const hotspot = scenes[0].content.elements.find((el) => el.hotspot)?.hotspot;
    expect(hotspot?.label).toBe("The mechanism");
  });

  it("leaves a detail scene alone when something already reaches it", () => {
    const detail = scene({ id: "b", position: 1, flowRole: "detail" });
    const parent = scene({ id: "a", position: 0 });
    const linked = {
      ...parent,
      content: {
        ...parent.content,
        elements: parent.content.elements.map((el, i) =>
          i === 0 ? { ...el, hotspot: { targetSceneId: "b", label: "Already there" } } : el,
        ),
      },
    };
    const deck = [linked, detail];
    const { scenes, repaired } = relinkOrphanedDetails(deck);
    expect(repaired).toEqual([]);
    // The same array back, untouched.
    expect(scenes).toBe(deck);
  });

  it("never overwrites a hotspot the author pointed somewhere else", () => {
    // The parent already dives somewhere. Re-pointing it would silently
    // replace a link the author made, which is worse than the orphan.
    const parent = scene({ id: "a", position: 0 });
    const elsewhere = {
      ...parent,
      content: {
        ...parent.content,
        elements: parent.content.elements.map((el, i) =>
          i === 0 ? { ...el, hotspot: { targetSceneId: "c", label: "Elsewhere" } } : el,
        ),
      },
    };
    const other = scene({ id: "c", position: 2 });
    const detail = scene({ id: "b", position: 1, flowRole: "detail" });
    const { repaired } = relinkOrphanedDetails([elsewhere, detail, other]);
    expect(repaired).toEqual([]);
  });

  it("does nothing to a deck with no detail scenes at all", () => {
    const deck = [scene({ id: "a", position: 0 }), scene({ id: "b", position: 1 })];
    const { scenes, repaired } = relinkOrphanedDetails(deck);
    expect(repaired).toEqual([]);
    // The same array back, so a caller can skip the work.
    expect(scenes).toBe(deck);
  });

  it("leaves an orphan with no scene in front of it alone", () => {
    // A detail scene stored first has no parent to belong to, and inventing
    // one would put a dive on a scene that never had an aside.
    const detail = scene({ id: "b", position: 0, flowRole: "detail" });
    const after = scene({ id: "a", position: 1 });
    expect(relinkOrphanedDetails([detail, after]).repaired).toEqual([]);
  });
});
