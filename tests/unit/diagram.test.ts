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
  hatch: false,
  value: null,
  label: "",
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

describe("what the schema refuses", () => {
  const base = {
    nodes: [
      { id: "a", kind: "circle", x: 200, y: 250, w: 100, h: 100 },
      { id: "b", kind: "box", x: 600, y: 250, w: 100, h: 100 },
    ],
  };

  it("an edge to a node that does not exist, so the model retries rather than losing the arrow", () => {
    expect(GeneratedDiagram.safeParse({ ...base, edges: [{ from: "a", to: "zz" }] }).success).toBe(
      false,
    );
    expect(GeneratedDiagram.safeParse({ ...base, edges: [{ from: "a", to: "b" }] }).success).toBe(
      true,
    );
  });

  it("a node id used twice", () => {
    expect(
      GeneratedDiagram.safeParse({ nodes: [base.nodes[0], { ...base.nodes[1], id: "a" }] }).success,
    ).toBe(false);
  });

  it("an edge from a node to itself", () => {
    expect(GeneratedDiagram.safeParse({ ...base, edges: [{ from: "a", to: "a" }] }).success).toBe(
      false,
    );
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

  it("clips to the circle actually drawn when its box is not square", () => {
    // A 200×100 box draws a circle of radius 50; the ellipse of the box would
    // put the arrow's end 50 units out in the air along the wide axis.
    const wide = node({ id: "w", kind: "circle", x: 400, y: 250, w: 200, h: 100 });
    const end = boundaryPoint(wide, { x: 300, y: 200, w: 200, h: 100 }, { x: 800, y: 250 });
    expect(end.x).toBeGreaterThan(450);
    expect(end.x).toBeLessThan(462);
  });

  it("draws a shaft and a two-stroke head, and a head at each end for an exchange", () => {
    const one = compileDiagram({
      nodes: [a, b],
      edges: [{ from: "a", to: "b", kind: "arrow", stage: 1, accent: true, label: "" }],
      stageLabels: [],
      alt: "",
    });
    expect(one.paths).toHaveLength(4);
    expect(one.paths.slice(2).every((p) => p.stage === 1 && p.ink === "accent")).toBe(true);
    const both = compileDiagram({
      nodes: [a, b],
      edges: [{ from: "a", to: "b", kind: "both", stage: 0, accent: false, label: "" }],
      stageLabels: [],
      alt: "",
    });
    expect(both.paths).toHaveLength(5);
  });

  it("ignores an edge to a node that does not exist, rather than drawing to nowhere", () => {
    const out = compileDiagram({
      nodes: [a],
      edges: [{ from: "a", to: "zz", kind: "arrow", stage: 0, accent: false, label: "" }],
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

describe("the richer forms", () => {
  const inside = (d: string) => {
    for (const token of tokenizePath(d)) {
      if (!("number" in token)) continue;
    }
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    return numbers.every((n) => n >= -1 && n <= 801);
  };

  it("draws a blob as one closed organic curve that follows its name", () => {
    const a = compileDiagram({
      nodes: [node({ id: "liver", kind: "blob", w: 240, h: 160 })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    const b = compileDiagram({
      nodes: [node({ id: "kidney", kind: "blob", w: 240, h: 160 })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    expect(a.paths).toHaveLength(1);
    expect(a.paths[0].d.trim().endsWith("Z")).toBe(true);
    expect(inside(a.paths[0].d)).toBe(true);
    expect(a.paths[0].d).not.toBe(b.paths[0].d);
    expect(
      compileDiagram({
        nodes: [node({ id: "liver", kind: "blob", w: 240, h: 160 })],
        edges: [],
        stageLabels: [],
        alt: "",
      }).paths[0].d,
    ).toBe(a.paths[0].d);
  });

  it("draws a ring as two circles, a bar as its extent and its amount, a stack as three", () => {
    const ring = compileDiagram({
      nodes: [node({ id: "r", kind: "ring" })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    expect(ring.paths).toHaveLength(2);

    const bar = compileDiagram({
      nodes: [node({ id: "b", kind: "bar", w: 400, h: 40, value: 0.25, accent: true })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    expect(bar.paths).toHaveLength(2);
    expect(bar.paths[1].fill).toBe(true);
    expect(bar.paths[1].ink).toBe("accent");
    const filledWidth = Math.max(...bar.paths[1].d.match(/-?\d+(\.\d+)?/g)!.map(Number));
    expect(filledWidth).toBeLessThan(400 + 400 * 0.25 - 100);

    const empty = compileDiagram({
      nodes: [node({ id: "b", kind: "bar", w: 400, h: 40, value: 0 })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    expect(empty.paths).toHaveLength(1);

    const stack = compileDiagram({
      nodes: [node({ id: "s", kind: "stack" })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    expect(stack.paths).toHaveLength(3);
    expect(stack.paths.filter((p) => p.ink === "muted")).toHaveLength(2);
    expect(stack.paths[2].weight).toBe(1.6);
  });

  it("hatches a damaged part with light muted lines that stay inside it, and never washes it too", () => {
    const out = compileDiagram({
      nodes: [node({ id: "v", kind: "ellipse", w: 300, h: 160, hatch: true, fill: true })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    const hatch = out.paths.filter((p) => p.ink === "muted");
    expect(hatch.length).toBeGreaterThan(8);
    for (const line of hatch) {
      expect(line.weight).toBe(0.5);
      const [x1, y1, x2, y2] = line.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      // Inside the ellipse, both ends.
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        expect(((x - 400) / 150) ** 2 + ((y - 250) / 80) ** 2).toBeLessThanOrEqual(1.02);
      }
    }
    expect(out.paths.some((p) => p.fill)).toBe(false);
  });

  it("draws a dashed relation as dashes and a leader as one thin line, neither with a head", () => {
    const a = node({ id: "a", kind: "circle", x: 150, w: 120, h: 120 });
    const b = node({ id: "b", kind: "circle", x: 650, w: 120, h: 120 });
    const dashed = compileDiagram({
      nodes: [a, b],
      edges: [{ from: "a", to: "b", kind: "dashed", stage: 0, accent: false, label: "" }],
      stageLabels: [],
      alt: "",
    });
    expect(dashed.paths).toHaveLength(3);
    expect((dashed.paths[2].d.match(/M /g) ?? []).length).toBeGreaterThan(10);
    const leader = compileDiagram({
      nodes: [a, b],
      edges: [{ from: "a", to: "b", kind: "leader", stage: 0, accent: false, label: "" }],
      stageLabels: [],
      alt: "",
    });
    expect(leader.paths).toHaveLength(3);
    expect(leader.paths[2].weight).toBe(0.7);
  });
});

describe("labels", () => {
  it("name a node beside it, inside a wide container, and take its stage and accent", () => {
    const out = compileDiagram({
      nodes: [
        node({
          id: "h",
          kind: "symbol",
          symbol: "heart",
          x: 150,
          y: 250,
          w: 160,
          h: 160,
          label: "Heart",
          stage: 1,
          accent: true,
        }),
        node({ id: "box", kind: "box", x: 500, y: 250, w: 300, h: 120, label: "The vessel" }),
        node({ id: "none", kind: "circle", x: 700, y: 400, w: 60, h: 60 }),
      ],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    expect(out.labels).toHaveLength(2);
    const heart = out.labels.find((l) => l.text === "Heart")!;
    expect(heart.y).toBeGreaterThan(250 + 80);
    expect(heart.stage).toBe(1);
    expect(heart.ink).toBe("accent");
    const vessel = out.labels.find((l) => l.text === "The vessel")!;
    expect(vessel.y).toBe(250);
    expect(vessel.x).toBe(500);
  });

  it("name a relation beside its midpoint, off the line", () => {
    const out = compileDiagram({
      nodes: [
        node({ id: "a", kind: "circle", x: 150, y: 250, w: 100, h: 100 }),
        node({ id: "b", kind: "circle", x: 650, y: 250, w: 100, h: 100 }),
      ],
      edges: [{ from: "a", to: "b", kind: "arrow", stage: 2, accent: false, label: "blocks" }],
      stageLabels: [],
      alt: "",
    });
    expect(out.labels).toHaveLength(1);
    expect(out.labels[0].x).toBeCloseTo(400, 0);
    expect(Math.abs(out.labels[0].y - 250)).toBeGreaterThan(8);
    expect(out.labels[0].stage).toBe(2);
    expect(out.labels[0].ink).toBe("muted");
  });

  it("are stored by the document and folded with the stages", () => {
    const out = compileDiagram({
      nodes: [node({ id: "a", kind: "circle", label: "A", stage: 3 })],
      edges: [],
      stageLabels: [],
      alt: "",
    });
    expect(GeneratedDrawing.safeParse(out).success).toBe(true);
    const normalised = normaliseDrawing(out);
    expect(normalised.labels).toHaveLength(1);
    // The only stage is 3; renumbered onto the first press.
    expect(normalised.labels[0].stage).toBe(0);
  });
});
