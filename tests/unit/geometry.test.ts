import { describe, expect, it } from "vitest";
import {
  alignFrames,
  applyResize,
  boundingBox,
  clampFrame,
  collectSnapTargets,
  intersects,
  snapMove,
} from "@/lib/editor/geometry";
import {
  SAFE_MARGIN,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Frame,
  type SceneElement,
} from "@/lib/schema/presentation";

const frame = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h, rotation: 0 });

function textElement(id: string, f: Frame): SceneElement {
  return {
    id,
    type: "text",
    frame: f,
    content: [{ text: id }],
    hidden: false,
    locked: false,
    opacity: 1,
    hotspot: null,
    animation: {
      entrance: "fade",
      delay: 0,
      duration: 0.5,
      emphasis: "none",
      onAdvance: false,
      exit: "none",
    },
    style: {
      size: 1,
      weight: 400,
      align: "left",
      valign: "top",
      italic: false,
      underline: false,
      uppercase: false,
      lineHeight: 1.4,
      letterSpacing: 0,
    },
  };
}

describe("snapMove", () => {
  const targets = collectSnapTargets([]);

  it("does nothing when snapping is disabled", () => {
    const input = frame(49.6, 20, 10, 10);
    expect(snapMove(input, targets, false).frame).toEqual(input);
  });

  it("snaps a frame's centre to the stage centre", () => {
    // Centre would be 49.7; the stage centre is 50, within tolerance.
    const result = snapMove(frame(44.7, 20, 10, 10), targets, true);
    expect(result.frame.x + result.frame.w / 2).toBeCloseTo(STAGE_WIDTH / 2, 5);
    expect(result.guides.some((g) => g.axis === "x" && g.kind === "center")).toBe(true);
  });

  it("snaps a leading edge to the safe margin", () => {
    const result = snapMove(frame(SAFE_MARGIN + 0.4, 40, 20, 10), targets, true);
    expect(result.frame.x).toBeCloseTo(SAFE_MARGIN, 5);
  });

  it("leaves a frame alone when nothing is within tolerance", () => {
    const input = frame(21.3, 33.7, 10, 10);
    const result = snapMove(input, targets, true);
    expect(result.frame.x).toBeCloseTo(21.3, 5);
    expect(result.guides).toHaveLength(0);
  });

  it("snaps to another element's edge", () => {
    const others = [textElement("a", frame(30, 10, 20, 10))];
    const withElements = collectSnapTargets(others);
    // Right edge of the dragged frame lands near the other element's left edge.
    const result = snapMove(frame(19.6, 40, 10, 10), withElements, true);
    expect(result.frame.x + result.frame.w).toBeCloseTo(30, 5);
  });

  it("ignores hidden elements as snap targets", () => {
    const hidden = { ...textElement("h", frame(30, 10, 20, 10)), hidden: true };
    const targetsWithHidden = collectSnapTargets([hidden]);
    const result = snapMove(frame(19.6, 40, 10, 10), targetsWithHidden, true);
    expect(result.frame.x).toBeCloseTo(19.6, 5);
  });
});

describe("applyResize", () => {
  const start = frame(20, 20, 40, 30);

  it("grows from the south-east handle without moving the origin", () => {
    const result = applyResize(start, "se", 10, 5);
    expect(result).toMatchObject({ x: 20, y: 20, w: 50, h: 35 });
  });

  it("keeps the opposite edge anchored when dragging north-west", () => {
    const result = applyResize(start, "nw", 10, 10);
    expect(result.x).toBe(30);
    expect(result.y).toBe(30);
    expect(result.x + result.w).toBeCloseTo(60, 5);
    expect(result.y + result.h).toBeCloseTo(50, 5);
  });

  it("constrains a single-axis handle to that axis", () => {
    const result = applyResize(start, "e", 10, 999);
    expect(result.h).toBe(start.h);
    expect(result.w).toBe(50);
  });

  it("enforces a minimum size instead of inverting", () => {
    const result = applyResize(start, "e", -1000, 0);
    expect(result.w).toBeGreaterThanOrEqual(2);
  });

  it("preserves aspect ratio when asked", () => {
    const square = frame(0, 0, 20, 20);
    const result = applyResize(square, "se", 10, 0, { preserveAspect: true });
    expect(result.w / result.h).toBeCloseTo(1, 3);
  });
});

describe("clampFrame", () => {
  it("keeps a frame partly on stage when dragged far left", () => {
    const result = clampFrame(frame(-500, 10, 20, 20));
    expect(result.x + result.w).toBeGreaterThanOrEqual(4);
  });

  it("keeps a frame partly on stage when dragged far right", () => {
    const result = clampFrame(frame(9999, 10, 20, 20));
    expect(result.x).toBeLessThanOrEqual(STAGE_WIDTH - 4);
  });

  it("keeps a frame partly on stage when dragged far down", () => {
    const result = clampFrame(frame(10, 9999, 20, 20));
    expect(result.y).toBeLessThanOrEqual(STAGE_HEIGHT - 4);
  });
});

describe("alignFrames", () => {
  const frames = [frame(10, 10, 20, 10), frame(40, 30, 30, 10), frame(15, 60, 10, 10)];

  it("aligns multiple frames to their common left edge", () => {
    const result = alignFrames(frames, "left");
    expect(new Set(result.map((f) => f.x)).size).toBe(1);
    expect(result[0].x).toBe(10);
  });

  it("aligns multiple frames to their common right edge", () => {
    const result = alignFrames(frames, "right");
    const rights = result.map((f) => f.x + f.w);
    for (const right of rights) expect(right).toBeCloseTo(70, 5);
  });

  it("centres a single frame against the safe area, not itself", () => {
    const [result] = alignFrames([frame(0, 0, 20, 10)], "center-x");
    const safeWidth = STAGE_WIDTH - SAFE_MARGIN * 2;
    expect(result.x).toBeCloseTo(SAFE_MARGIN + (safeWidth - 20) / 2, 5);
  });

  it("distributes three frames with equal gaps", () => {
    const input = [frame(0, 0, 10, 10), frame(15, 0, 10, 10), frame(80, 0, 10, 10)];
    const result = alignFrames(input, "distribute-x").sort((a, b) => a.x - b.x);
    const gap1 = result[1].x - (result[0].x + result[0].w);
    const gap2 = result[2].x - (result[1].x + result[1].w);
    expect(gap1).toBeCloseTo(gap2, 3);
  });

  it("leaves fewer than three frames untouched when distributing", () => {
    const input = [frame(0, 0, 10, 10), frame(50, 0, 10, 10)];
    expect(alignFrames(input, "distribute-x")).toEqual(input);
  });
});

describe("boundingBox and intersects", () => {
  it("computes a bounding box across frames", () => {
    const box = boundingBox([frame(10, 10, 10, 10), frame(40, 50, 20, 10)]);
    expect(box).toMatchObject({ x: 10, y: 10, w: 50, h: 50 });
  });

  it("returns null for no frames", () => {
    expect(boundingBox([])).toBeNull();
  });

  it("detects marquee overlap", () => {
    expect(intersects(frame(10, 10, 10, 10), { x: 15, y: 15, w: 20, h: 20 })).toBe(true);
    expect(intersects(frame(10, 10, 10, 10), { x: 40, y: 40, w: 5, h: 5 })).toBe(false);
  });

  it("treats edge-touching as non-overlapping", () => {
    expect(intersects(frame(10, 10, 10, 10), { x: 20, y: 10, w: 10, h: 10 })).toBe(false);
  });
});
