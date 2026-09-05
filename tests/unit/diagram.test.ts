import { describe, expect, it } from "vitest";
import {
  GeneratedDiagram,
  boundaryPoint,
  circlePath,
  cloudPath,
  compileDiagram,
  roundedBoxPath,
  symbolPaths,
  transformPath,
  type DiagramNode,
} from "@/lib/drawing/diagram";
import { DIAGRAM_SYMBOLS, symbolNode } from "@/lib/drawing/symbols";
import { tokenizePath } from "@/lib/drawing/path-tokens";
import { GeneratedDrawing } from "@/lib/ai/schemas";
import { normaliseDrawing } from "@/lib/editor/place-drawing";
import { DrawnPath } from "@/lib/schema/presentation";

/**
 * The diagram compiler: the model composes, the application draws.
 *
 * What is tested is what the model could not be trusted with — that a shape
 * closes, an arrow starts and ends at the edges of the things it joins, a
 * symbol lands inside its box at the weight it was designed for, and that
 * nothing the compiler emits can leave the picture's box or fail the
 * drawing schema the document stores.
 */

const node = (over: Partial<DiagramNode> & Pick<DiagramNode, "id" | "kind">): DiagramNode => ({
  symbol: null,
  x: 400,
  y: 250,
  w: 200,
  h: 200,
  stage: 0,
  accent: false,
  fill: false,
  ...over,
});

describe("the symbol set", () => {
  it("resolves every name to real icon primitives", () => {
    expect(DIAGRAM_SYMBOLS.length).toBeGreaterThan(80);
    for (const name of DIAGRAM_SYMBOLS) {
      const primitives = symbolNode(name);
      expect(primitives.length, name).toBeGreaterThan(0);
      for (const [tag] of primitives) {
        expect(
          ["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"],
          `${name}: ${tag}`,
        ).toContain(tag);
      }
    }
  });

  it("is the enum the schema offers the model", () => {
    const parsed = GeneratedDiagram.safeParse({
      nodes: [{ id: "a", kind: "symbol", symbol: "heart-pulse", x: 400, y: 250, w: 200, h: 200 }],
    });
    expect(parsed.success).toBe(true);
    expect(
      GeneratedDiagram.safeParse({
        nodes: [{ id: "a", kind: "symbol", symbol: "unicorn", x: 400, y: 250, w: 200, h: 200 }],
      }).success,
    ).toBe(false);
  });
});

describe("recipes", () => {
  it("close every shape, so a fill has something to fill", () => {
    expect(circlePath(100, 100, 40).trim().endsWith("Z")).toBe(true);
    expect(roundedBoxPath(0, 0, 100, 50, 10).trim().endsWith("Z")).toBe(true);
    expect(cloudPath(200, 200, 100, 60).trim().endsWith("Z")).toBe(true);
  });

  it("passes the document's path grammar", () => {
    for (const d of [
      circlePath(100, 100, 40),
      roundedBoxPath(0, 0, 100, 50, 10),
      cloudPath(200, 200, 100, 60),
    ]) {
      expect(DrawnPath.safeParse({ d, stage: 0 }).success).toBe(true);
    }
  });
});

describe("transforming path data", () => {
  it("scales absolute commands and moves them, scales relative ones in place", () => {
    expect(transformPath("M 1 2 l 3 4", 2, 10, 20)).toBe("M 12 24 l 6 8");
  });

  it("scales an arc's radii but not its rotation or flags", () => {
    expect(transformPath("M 0 0 a 5.5 5.5 30 0 1 9 -3", 2, 0, 0)).toBe(
      "M 0 0 a 11 11 30 0 1 18 -6",
    );
  });

  it("treats a path's opening relative move as absolute, like the grammar does", () => {
    // Lucide writes many subpaths as "m9 20 3-6 3 6": a move that opens the
    // path, then relative lines. Scaling the move without placing it left the
    // legs of a figure at the origin while its head sat in the box.
    expect(transformPath("m9 20 3-6 3 6", 2, 100, 100)).toBe("m 118 140 6 -12 6 12");
  });

  it("reads an arc's flags as single digits, even run into the next value", () => {
    // "0 01-8.943 0": large-arc 0, sweep 1, then the endpoint. Read as the
    // number 01 the arc is one argument short and the mouth of a face is lost.
    expect(transformPath("M16.472 15a6 6 0 01-8.943 0", 2, 0, 0)).toBe(
      "M 32.9 30 a 12 12 0 0 1 -17.9 0",
    );
    expect(tokenizePath("a1 1 0 11 5 5").filter((t) => "number" in t)).toHaveLength(7);
  });

  it("carries one ordinate for H and V", () => {
    expect(transformPath("M 0 0 H 10 v 5", 3, 1, 1)).toBe("M 1 1 H 31 v 15");
  });
});

describe("symbols in boxes", () => {
  it("lands inside its box, at a weight that keeps the icon's proportions", () => {
    const box = { x: 100, y: 50, w: 240, h: 240 };
    const strokes = symbolPaths("heart-pulse", box);
    expect(strokes.length).toBeGreaterThan(0);
    // 24 units become 240, so a 2-unit stroke wants 20 units: weight 20/3 capped at 4.
    expect(strokes[0].weight).toBe(4);
    const compiled = compileDiagram({
      nodes: [
        node({ id: "h", kind: "symbol", symbol: "heart-pulse", x: 220, y: 170, w: 240, h: 240 }),
      ],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    // The box never grows: every stroke is inside the picture.
    expect(normaliseDrawing(compiled).viewBox).toEqual({ width: 800, height: 500 });
  });

  it("keeps a small symbol fine rather than the same hairline as a large one", () => {
    const small = symbolPaths("clock", { x: 0, y: 0, w: 48, h: 48 })[0].weight;
    const large = symbolPaths("clock", { x: 0, y: 0, w: 200, h: 200 })[0].weight;
    expect(small).toBeLessThan(large);
    expect(small).toBeGreaterThanOrEqual(0.6);
  });
});

describe("arrows", () => {
  const a = node({ id: "a", kind: "circle", x: 150, y: 250, w: 160, h: 160 });
  const b = node({ id: "b", kind: "box", x: 650, y: 250, w: 200, h: 120, stage: 1 });

  it("start and end at the edges of the shapes they join, with air", () => {
    const start = boundaryPoint(a, { x: 70, y: 170, w: 160, h: 160 }, { x: 650, y: 250 });
    const end = boundaryPoint(b, { x: 550, y: 190, w: 200, h: 120 }, { x: 150, y: 250 });
    expect(start.x).toBeGreaterThan(150 + 80);
    expect(start.x).toBeLessThan(150 + 80 + 12);
    expect(end.x).toBeLessThan(650 - 100);
    expect(end.x).toBeGreaterThan(650 - 100 - 12);
  });

  it("draws a shaft and a two-stroke head, and a head at each end for an exchange", () => {
    const one = compileDiagram({
      nodes: [a, b],
      edges: [{ from: "a", to: "b", kind: "arrow", stage: 1, accent: true }],
      stageLabels: [],
      alt: "",
    });
    expect(one.paths).toHaveLength(4);
    expect(one.paths.slice(2).every((p) => p.stage === 1 && p.ink === "accent")).toBe(true);
    const both = compileDiagram({
      nodes: [a, b],
      edges: [{ from: "a", to: "b", kind: "both", stage: 0, accent: false }],
      stageLabels: [],
      alt: "",
    });
    expect(both.paths).toHaveLength(5);
  });

  it("ignores an edge to a node that does not exist, rather than drawing to nowhere", () => {
    const out = compileDiagram({
      nodes: [a],
      edges: [{ from: "a", to: "zz", kind: "arrow", stage: 0, accent: false }],
      stageLabels: [],
      alt: "",
    });
    expect(out.paths).toHaveLength(1);
  });
});

describe("the compiled picture", () => {
  const diagram = GeneratedDiagram.parse({
    nodes: [
      { id: "heart", kind: "symbol", symbol: "heart-pulse", x: 180, y: 250, w: 220, h: 220 },
      { id: "vessel", kind: "pill", x: 470, y: 250, w: 200, h: 90, fill: true, stage: 1 },
      { id: "cell", kind: "cloud", x: 690, y: 250, w: 160, h: 120, stage: 2, accent: true },
      // Off the edge on purpose: the compiler clamps it into the margin.
      { id: "far", kind: "circle", x: 795, y: 5, w: 400, h: 400, stage: 3 },
    ],
    edges: [
      { from: "heart", to: "vessel", stage: 1, accent: true },
      { from: "vessel", to: "cell", stage: 2 },
    ],
    stageLabels: ["The pump", "The pipe", "The tissue", "Everything"],
    alt: "A heart pumping through a vessel to tissue.",
  });

  it("is a valid drawing the document can store, inside its own box", () => {
    const compiled = compileDiagram(diagram);
    expect(GeneratedDrawing.safeParse(compiled).success).toBe(true);
    expect(normaliseDrawing(compiled).viewBox).toEqual({ width: 800, height: 500 });
  });

  it("keeps each element's stage, so a press adds one idea", () => {
    const stages = new Set(compileDiagram(diagram).paths.map((p) => p.stage));
    expect([...stages].sort()).toEqual([0, 1, 2, 3]);
  });

  it("fills only closed shapes and never a symbol", () => {
    const filled = compileDiagram(diagram).paths.filter((p) => p.fill);
    expect(filled).toHaveLength(1);
    expect(filled[0].d.trim().endsWith("Z")).toBe(true);
  });
});
