import { describe, expect, it } from "vitest";
import { FRAME_ZOOM, frameOf, labelBox, labelSize, textEms } from "@/lib/drawing/frame";
import { inkBounds } from "@/lib/drawing/bounds";

/**
 * The frame a drawing is shown in: the box its ink and its names occupy,
 * with air, never closer than the zoom allows. The composition is left
 * where its author put it; the room sees it as large as its slot allows.
 */

const canvas = { width: 800, height: 500 };
const label = (over: Partial<Parameters<typeof labelBox>[0]>) => ({
  text: "Here",
  x: 400,
  y: 330,
  stage: 0,
  size: 1,
  anchor: "middle" as const,
  ...over,
});

describe("the frame", () => {
  it("is the ink and the names with air, centred where the zoom cap leaves room", () => {
    // Ink 300–500 × 200–300, a name at 330: the extent is 200 × 147, plus
    // 30 of air each side. Under twice the canvas is as close as the frame
    // may come, so the width is 400 and the height 250, centred on it.
    const frame = frameOf({
      viewBox: canvas,
      strokeWidth: 3,
      paths: [{ d: "M 300 200 L 500 300" }],
      labels: [label({})],
    });
    expect(frame).toEqual({ x: 200, y: 148.5, width: 400, height: 250 });
  });

  it("comes no closer than twice: a lone mark is shown with half the canvas around it", () => {
    const frame = frameOf({
      viewBox: canvas,
      strokeWidth: 3,
      paths: [{ d: "M 395 245 L 405 255" }],
    });
    expect(frame.width).toBe(canvas.width / FRAME_ZOOM);
    expect(frame.height).toBe(canvas.height / FRAME_ZOOM);
    expect(frame.x + frame.width / 2).toBe(400);
    expect(frame.y + frame.height / 2).toBe(250);
  });

  it("counts an arc's whole turn, not the points it is written with", () => {
    // A circle is two arcs whose endpoints are both on its equator; framed
    // by its endpoints it would lose its top and bottom.
    const circle = "M 300 250 A 100 100 0 1 0 500 250 A 100 100 0 1 0 300 250 Z";
    expect(inkBounds([{ d: circle }])).toEqual({ minX: 300, minY: 150, maxX: 500, maxY: 350 });
    const frame = frameOf({ viewBox: canvas, strokeWidth: 3, paths: [{ d: circle }] });
    expect(frame.y).toBe(120);
    expect(frame.height).toBe(260);
  });

  it("counts the control point a smooth curve does not write", () => {
    // Codex, reviewing the PR: `S` and `T` reflect the previous curve's last
    // control through the current point, and the curve bends towards it.
    // Measured from the written numbers alone this path is 300–700 wide;
    // its second half bends out to about 163, and the frame cut it off.
    const smooth = "M 700 250 C 700 250 700 250 300 250 S 500 250 500 250";
    expect(inkBounds([{ d: smooth }])!.minX).toBeLessThanOrEqual(163);
    const quad = "M 100 100 Q 200 0 300 100 T 500 100";
    expect(inkBounds([{ d: quad }])!.maxY).toBeGreaterThanOrEqual(150);
    // Relative forms reflect the same way.
    const rel = "M 700 250 c 0 0 0 0 -400 0 s 200 0 200 0";
    expect(inkBounds([{ d: rel }])!.minX).toBeLessThanOrEqual(163);
    // With nothing to reflect, the current point is the control: no bend.
    expect(inkBounds([{ d: "M 100 100 S 200 200 300 100" }])).toEqual({
      minX: 100,
      minY: 100,
      maxX: 300,
      maxY: 200,
    });
    // A line between two curves breaks the chain.
    const broken = "M 700 250 C 700 250 700 250 300 250 L 300 250 S 500 250 500 250";
    expect(inkBounds([{ d: broken }])!.minX).toBe(300);
  });

  it("counts a name by its anchor", () => {
    const start = frameOf({
      viewBox: canvas,
      strokeWidth: 3,
      paths: [{ d: "M 100 100 L 300 300" }],
      labels: [label({ x: 700, y: 200, anchor: "start" })],
    });
    const end = frameOf({
      viewBox: canvas,
      strokeWidth: 3,
      paths: [{ d: "M 100 100 L 300 300" }],
      labels: [label({ x: 700, y: 200, anchor: "end" })],
    });
    const width = labelBox(label({ x: 700, anchor: "start" }), 26).maxX - 700;
    expect(start.x + start.width).toBeCloseTo(700 + width + 30, 0);
    expect(end.x + end.width).toBeCloseTo(700 + 30, 0);
  });

  it("shows ink outside the canvas rather than clipping it", () => {
    const frame = frameOf({
      viewBox: canvas,
      strokeWidth: 3,
      paths: [{ d: "M -100 0 L 800 500" }],
    });
    expect(frame.x).toBe(-130);
    expect(frame.width).toBe(960);
  });

  it("is the canvas when there is nothing to measure", () => {
    expect(frameOf({ viewBox: canvas, paths: [], labels: [] })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 500,
    });
  });
});

describe("a name's box", () => {
  it("counts a wide glyph as a full em, however many code units it takes", () => {
    // Codex, reviewing the PR: twenty-eight CJK characters at 0.56 em were
    // measured at 423 units and set at about 728, and the frame closed
    // around the estimate and clipped both ends.
    const cjk = "血栓は配管の問題である".repeat(3).slice(0, 28);
    expect(cjk).toHaveLength(28);
    expect(textEms(cjk)).toBe(28);
    const box = labelBox(label({ text: cjk }), 26);
    expect(box.maxX - box.minX).toBeGreaterThanOrEqual(728);
    expect(textEms("Heart")).toBeCloseTo(5 * 0.56, 5);
    // A surrogate pair is one glyph, and a wide one.
    expect(textEms("❤️🫀")).toBeGreaterThanOrEqual(2);
    expect(textEms("🫀")).toBe(1);
  });

  it("is set by its anchor, a little over half its size a glyph, with its halo", () => {
    const base = labelSize(800);
    expect(base).toBe(26);
    const middle = labelBox(label({}), base);
    expect(middle.maxX - middle.minX).toBeCloseTo(4 * 0.56 * 26 + 0.6 * 26, 5);
    expect((middle.minX + middle.maxX) / 2).toBe(400);
    expect(labelBox(label({ anchor: "start" }), base).minX).toBe(400);
    expect(labelBox(label({ anchor: "end" }), base).maxX).toBe(400);
    const tall = labelBox(label({ size: 2 }), base);
    expect(tall.maxY - tall.minY).toBeCloseTo(2 * 26 * 1.3, 5);
  });
});
