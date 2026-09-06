import { describe, expect, it } from "vitest";
import { pairTemplateMoments } from "@/lib/narrative/pair-template";

/**
 * A template's argument, attached to the template's scenes.
 *
 * Creating a deck from a template with a declared shape wrote two unrelated
 * sets of rows: moments with fresh ids, and scenes with `moment_id` null. The
 * narrative map then described an argument connected to nothing — and
 * generating scenes from it appended a second parallel deck, because every
 * moment looked like a moment with no scene yet. CI caught it as a template's
 * eleven scenes becoming nineteen.
 */

const scene = (index: number, sectionId: string | null) => ({ index, sectionId });
const moment = (id: string, movementId: string | null, position: number) => ({
  id,
  movementId,
  position,
});

describe("pairing a shape's beats with a template's scenes", () => {
  it("gives the nth scene of a movement to the nth beat of that movement", () => {
    const paired = pairTemplateMoments(
      [scene(0, "drift"), scene(1, "drift"), scene(2, "camera")],
      [moment("m1", "drift", 0), moment("m2", "drift", 1), moment("m3", "camera", 0)],
    );
    expect(paired.get(0)).toBe("m1");
    expect(paired.get(1)).toBe("m2");
    expect(paired.get(2)).toBe("m3");
  });

  it("counts position within the movement, not within the deck", () => {
    // The second scene of the second movement is that movement's *first* beat.
    const paired = pairTemplateMoments(
      [scene(0, "drift"), scene(1, "camera"), scene(2, "camera")],
      [moment("m1", "drift", 0), moment("m2", "camera", 0), moment("m3", "camera", 1)],
    );
    expect(paired.get(1)).toBe("m2");
    expect(paired.get(2)).toBe("m3");
  });

  it("leaves the surplus scenes of a movement unpaired", () => {
    // A template with more scenes than beats has extra material, and extra
    // material belongs to no moment — which is also what protects it from
    // being overwritten by a regeneration.
    const paired = pairTemplateMoments(
      [scene(0, "drift"), scene(1, "drift"), scene(2, "drift")],
      [moment("m1", "drift", 0)],
    );
    expect(paired.size).toBe(1);
    expect(paired.get(0)).toBe("m1");
  });

  it("leaves a beat with no scene unpaired, which is what a generation is for", () => {
    const paired = pairTemplateMoments(
      [scene(0, "drift")],
      [moment("m1", "drift", 0), moment("m2", "drift", 1)],
    );
    expect([...paired.values()]).toEqual(["m1"]);
  });

  it("never pairs across the deck when there are no movements", () => {
    // Position is only meaningful inside a movement. Pairing a sectionless
    // deck by order would attach beats to scenes that merely line up.
    const paired = pairTemplateMoments(
      [scene(0, null), scene(1, null)],
      [moment("m1", null, 0), moment("m2", null, 1)],
    );
    expect(paired.size).toBe(0);
  });

  it("pairs no scene twice, so a repeated position cannot steal one", () => {
    const paired = pairTemplateMoments(
      [scene(0, "drift"), scene(1, "drift")],
      [moment("m1", "drift", 0), moment("dupe", "drift", 0), moment("m2", "drift", 1)],
    );
    expect(paired.get(0)).toBe("m1");
    expect(paired.get(1)).toBe("m2");
    expect(new Set(paired.values()).size).toBe(paired.size);
  });

  it("reads the scenes in deck order however they arrive", () => {
    const paired = pairTemplateMoments(
      [scene(2, "drift"), scene(0, "drift"), scene(1, "drift")],
      [moment("m1", "drift", 0), moment("m2", "drift", 1), moment("m3", "drift", 2)],
    );
    expect(paired.get(0)).toBe("m1");
    expect(paired.get(2)).toBe("m3");
  });

  it("does nothing at all for a template that declared no argument", () => {
    expect(pairTemplateMoments([scene(0, "drift")], []).size).toBe(0);
  });
});
