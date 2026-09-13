import { describe, expect, it } from "vitest";
import {
  DRIFT_MS,
  DRIFT_RETURN_MS,
  DRIFT_SCALE,
  PAN_FRACTION,
  driftKind,
  pictureDrift,
  pictureShot,
} from "@/lib/present/drift";

/**
 * A picture that lives: a photograph closes in or pans while its scene is
 * performed, from the identity so a landing never jumps, and comes back in a
 * second and a half when the scene is left.
 */
describe("a picture that lives", () => {
  const picture = { id: "img-1", focalX: 0.5, focalY: 0.5 };

  it("stands still, at the identity, until its scene is performed", () => {
    const style = pictureDrift(picture, false);
    expect(style.transform).toBe("none");
    expect(style.transition).toContain(`${DRIFT_RETURN_MS}ms`);
  });

  it("closes in on the author's focal point over the drift's length", () => {
    const id = ["a", "b", "c", "d", "e"].find((candidate) => driftKind(candidate) === "in")!;
    const style = pictureDrift({ id, focalX: 0.3, focalY: 0.7 }, true);
    expect(style.transform).toBe(`scale(${DRIFT_SCALE})`);
    expect(style.transformOrigin).toBe("30.0% 70.0%");
    expect(style.transition).toBe(`transform ${DRIFT_MS}ms linear`);
  });

  it("pans toward the side the scale has made room on", () => {
    const id = ["a", "b", "c", "d", "e"].find((candidate) => driftKind(candidate) === "pan")!;
    const left = pictureDrift({ id, focalX: 0.1, focalY: 0.5 }, true);
    const right = pictureDrift({ id, focalX: 0.9, focalY: 0.5 }, true);
    expect(left.transform).toBe(`scale(${DRIFT_SCALE}) translateX(${-PAN_FRACTION * 100}%)`);
    expect(right.transform).toBe(`scale(${DRIFT_SCALE}) translateX(${PAN_FRACTION * 100}%)`);
  });

  it("chooses the same shot for the same picture every time", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `element-${i}`);
    const kinds = ids.map(driftKind);
    expect(ids.map(driftKind)).toEqual(kinds);
    expect(kinds).toContain("in");
    expect(kinds).toContain("pan");
  });

  it("stays still, performing or not, when the author says so", () => {
    const still = { id: "in", focalX: 0.5, focalY: 0.5, motion: "still" as const };
    expect(pictureShot(still)).toBeNull();
    expect(pictureDrift(still, true).transform).toBe("none");
  });

  it("takes the author's shot over the stage's choice", () => {
    const pan = ["a", "b", "c", "d", "e"].find((id) => driftKind(id) === "pan")!;
    const closeIn = ["a", "b", "c", "d", "e"].find((id) => driftKind(id) === "in")!;
    expect(pictureShot({ id: pan, motion: "in" })).toBe("in");
    expect(pictureShot({ id: closeIn, motion: "pan" })).toBe("pan");
    expect(pictureShot({ id: pan, motion: "auto" })).toBe("pan");
    expect(pictureShot({ id: pan })).toBe("pan");
    expect(pictureDrift({ id: pan, focalX: 0.5, focalY: 0.5, motion: "in" }, true).transform).toBe(
      `scale(${DRIFT_SCALE})`,
    );
  });

  it("is slower than any scene is held, and comes back faster than a flight", () => {
    expect(DRIFT_MS).toBeGreaterThan(20_000);
    expect(DRIFT_RETURN_MS).toBeLessThan(2_000);
    expect(DRIFT_SCALE).toBeGreaterThan(1);
    expect(DRIFT_SCALE).toBeLessThan(1.1);
  });
});
