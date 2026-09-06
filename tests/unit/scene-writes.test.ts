import { describe, expect, it } from "vitest";
import {
  planSceneWrites,
  type ExistingScene,
  type WrittenScene,
} from "@/lib/narrative/scene-writes";

/**
 * What a regeneration writes, decided before anything is written.
 *
 * The decision used to live in a loop in the browser, which is what made a
 * five-minute job depend on a phone staying awake. Moving it to the server
 * closes that window; the matching is the part that can go quietly wrong, so
 * it is pure and it is tested here.
 */

const scene = (id: string, momentId: string | null, position: number): ExistingScene => ({
  id,
  momentId,
  position,
});

const wrote = (momentId: string, title = "A beat"): WrittenScene => ({
  momentId,
  title,
  content: { layout: "statement" },
  speakerNotes: "",
});

const moments = (...ids: string[]) => ids.map((id) => ({ id, movementId: `mv-${id}` }));

describe("a moment that already has a scene", () => {
  it("rewrites it in place, keeping the scene's own id", () => {
    // Recordings, thumbnails and note anchors point at that id. A
    // delete-and-insert looks identical and breaks all of them.
    const plan = planSceneWrites([scene("s1", "m1", 0)], [wrote("m1", "Rewritten")], moments("m1"));
    expect(plan.writes).toEqual([
      {
        kind: "update",
        id: "s1",
        title: "Rewritten",
        content: { layout: "statement" },
        speakerNotes: "",
      },
    ]);
    expect(plan.replacing).toBe(1);
    expect(plan.creating).toBe(0);
  });

  it("writes the same rows twice rather than a second copy", () => {
    // Idempotence is what makes retrying a half-finished regeneration safe.
    const existing = [scene("s1", "m1", 0)];
    const once = planSceneWrites(existing, [wrote("m1")], moments("m1"));
    const twice = planSceneWrites(existing, [wrote("m1")], moments("m1"));
    expect(twice).toEqual(once);
    expect(twice.creating).toBe(0);
  });

  it("rewrites one scene where a moment somehow owns two", () => {
    // Rewriting both would leave the deck saying the same thing twice.
    const plan = planSceneWrites(
      [scene("s1", "m1", 0), scene("s2", "m1", 1)],
      [wrote("m1")],
      moments("m1"),
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ kind: "update", id: "s1" });
  });
});

describe("a moment with no scene yet", () => {
  it("gets one, filed under its own movement", () => {
    const plan = planSceneWrites([], [wrote("m1")], moments("m1"));
    expect(plan.writes[0]).toMatchObject({ kind: "insert", momentId: "m1", sectionId: "mv-m1" });
    expect(plan.creating).toBe(1);
  });

  it("is appended after everything that already exists", () => {
    const plan = planSceneWrites(
      [scene("s1", "m1", 0), scene("hand", null, 7)],
      [wrote("m2"), wrote("m3")],
      moments("m1", "m2", "m3"),
    );
    const inserts = plan.writes.filter((w) => w.kind === "insert");
    expect(inserts.map((w) => (w.kind === "insert" ? w.position : -1))).toEqual([8, 9]);
  });

  it("keeps the order the scenes were written in", () => {
    const plan = planSceneWrites(
      [],
      [wrote("m1", "First"), wrote("m2", "Second")],
      moments("m1", "m2"),
    );
    expect(plan.writes.map((w) => w.title)).toEqual(["First", "Second"]);
  });
});

describe("what a regeneration must not touch", () => {
  it("leaves a scene belonging to no moment alone", () => {
    // Hand-made work, and an aside's detail scene. A regeneration did not
    // write either and may not overwrite them.
    const plan = planSceneWrites(
      [scene("hand", null, 0), scene("detail", null, 1), scene("s1", "m1", 2)],
      [wrote("m1")],
      moments("m1"),
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ id: "s1" });
  });

  it("drops a scene naming a moment this deck does not have", () => {
    // Filing it under nothing would make it invisible to the running order and
    // to the next regeneration, which would then create a second one beside it.
    const plan = planSceneWrites([], [wrote("ghost")], moments("m1"));
    expect(plan.writes).toEqual([]);
    expect(plan.unplaceable).toBe(1);
  });

  it("does nothing at all when the model wrote nothing", () => {
    const plan = planSceneWrites([scene("s1", "m1", 0)], [], moments("m1"));
    expect(plan.writes).toEqual([]);
    expect(plan.replacing + plan.creating + plan.unplaceable).toBe(0);
  });
});

describe("a map derived from the deck's own scenes", () => {
  /**
   * A deck made from a template has scenes and no moments, and `assembleMap`
   * derives a map from them in which each moment's id *is* the scene's id.
   * Matching on `moment_id` alone missed that and appended a second copy of
   * the whole deck beside the first — a template's eleven scenes became
   * nineteen in CI, which is how this was found.
   */
  it("rewrites the scene a moment was derived from", () => {
    const plan = planSceneWrites(
      [scene("s1", null, 0)],
      [wrote("s1", "Rewritten")],
      [{ id: "s1", movementId: null }],
    );
    expect(plan.writes).toEqual([
      {
        kind: "update",
        id: "s1",
        title: "Rewritten",
        content: { layout: "statement" },
        speakerNotes: "",
      },
    ]);
    expect(plan.creating).toBe(0);
  });

  it("does not double a whole deck generated from its own derived map", () => {
    const existing = [scene("s1", null, 0), scene("s2", null, 1), scene("s3", null, 2)];
    const derived = ["s1", "s2", "s3"];
    const plan = planSceneWrites(
      existing,
      derived.map((id) => wrote(id)),
      derived.map((id) => ({ id, movementId: null })),
    );
    expect(plan.creating).toBe(0);
    expect(plan.replacing).toBe(3);
  });

  it("still prefers a real moment link where a scene has one", () => {
    // A scene owned by moment "m1" is rewritten for m1, not for a moment that
    // happens to carry the scene's own id.
    const plan = planSceneWrites([scene("s1", "m1", 0)], [wrote("m1")], moments("m1"));
    expect(plan.writes[0]).toMatchObject({ kind: "update", id: "s1" });
    expect(plan.replacing).toBe(1);
  });
});

describe("a mixed deck, which is the ordinary case", () => {
  it("rewrites what exists, adds what does not, and counts both", () => {
    const plan = planSceneWrites(
      [scene("s1", "m1", 0), scene("hand", null, 1), scene("s2", "m2", 2)],
      [wrote("m1"), wrote("m2"), wrote("m3")],
      moments("m1", "m2", "m3"),
    );
    expect(plan.replacing).toBe(2);
    expect(plan.creating).toBe(1);
    expect(plan.unplaceable).toBe(0);
    expect(plan.writes.filter((w) => w.kind === "insert")[0]).toMatchObject({ position: 3 });
  });

  it("files a new scene under no movement where the moment has none", () => {
    const plan = planSceneWrites([], [wrote("loose")], [{ id: "loose", movementId: null }]);
    expect(plan.writes[0]).toMatchObject({ kind: "insert", sectionId: null });
  });
});
