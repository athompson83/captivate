import { describe, expect, it } from "vitest";
import {
  chartDrawing,
  compileChart,
  valueText,
  wedgePath,
  type ChartElement,
} from "@/lib/drawing/chart";
import { DrawingElement } from "@/lib/schema/presentation";
import { createElement } from "@/lib/editor/element-factory";

/**
 * A chart by the same hand as the diagrams.
 *
 * What is tested is what the room sees: every amount is a closed, washed
 * outline of the right proportion, every category and value is a label, a
 * line goes through its points, a donut's wedges make a ring, and the whole
 * thing is a drawing the stage can sketch.
 */

const chart = (over: Partial<ChartElement>): ChartElement => ({
  ...(createElement("chart") as ChartElement),
  chart: "column",
  data: [
    { label: "Q1", value: 10 },
    { label: "Q2", value: 40 },
    { label: "Q3", value: 20 },
  ],
  showValues: true,
  palette: "accent",
  summary: "Q2 doubled.",
  ...over,
});

/** The extent of a path's absolute coordinates. */
const bounds = (d: string) => {
  const nums = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  const xs = nums.map((c) => c[0]);
  const ys = nums.map((c) => c[1]);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    top: Math.min(...ys),
    left: Math.min(...xs),
  };
};

describe("columns and bars", () => {
  it("draws a baseline and one washed outline per amount, in proportion", () => {
    const drawing = compileChart(chart({}));
    const [baseline, ...columns] = drawing.paths;
    expect(baseline.ink).toBe("muted");
    expect(columns).toHaveLength(3);
    for (const column of columns) {
      expect(column.fill).toBe(true);
      expect(column.d).toMatch(/Z$/);
    }
    const heights = columns.map((c) => bounds(c.d).h);
    expect(heights[1]).toBeGreaterThan(heights[2]);
    expect(heights[2]).toBeGreaterThan(heights[0]);
    expect(heights[1] / heights[2]).toBeCloseTo(2, 0);
  });

  it("names every category under it and writes every value over it", () => {
    const drawing = compileChart(chart({}));
    const texts = drawing.labels.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(["Q1", "Q2", "Q3", "10", "40", "20"]));
    const q2 = drawing.labels.find((l) => l.text === "Q2")!;
    const v40 = drawing.labels.find((l) => l.text === "40")!;
    expect(q2.y).toBeGreaterThan(v40.y);
    // No values when the author turned them off.
    expect(compileChart(chart({ showValues: false })).labels.map((l) => l.text)).toEqual([
      "Q1",
      "Q2",
      "Q3",
    ]);
  });

  it("lays bars from a common floor on the left, named beside them", () => {
    const drawing = compileChart(chart({ chart: "bar" }));
    const [floor, ...bars] = drawing.paths;
    expect(floor.d).toMatch(/^M (\d+(?:\.\d+)?) [\d.]+ L \1 /);
    const widths = bars.map((b) => bounds(b.d).w);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(new Set(bars.map((b) => bounds(b.d).left)).size).toBe(1);
    expect(drawing.labels.find((l) => l.text === "Q1")!.anchor).toBe("end");
  });

  it("stays inside the canvas whatever the count, and cycles inks where one colour would not tell them apart", () => {
    const many = chart({
      data: Array.from({ length: 12 }, (_, i) => ({ label: `M${i}`, value: i + 1 })),
      palette: "categorical",
    });
    const drawing = compileChart(many);
    for (const p of drawing.paths) {
      const b = bounds(p.d);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.left + b.w).toBeLessThanOrEqual(800);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.top + b.h).toBeLessThanOrEqual(500);
    }
    const inks = drawing.paths.slice(1).map((p) => p.ink);
    expect(new Set(inks).size).toBe(3);
    expect(
      compileChart(chart({}))
        .paths.slice(1)
        .every((p) => p.ink === "accent"),
    ).toBe(true);
  });

  it("draws an empty chart as one thing that says so, and a negative value by its size", () => {
    const empty = compileChart(chart({ data: [] }));
    expect(empty.labels.map((l) => l.text)).toContain("No data");
    const negative = compileChart(chart({ data: [{ label: "Down", value: -30 }] }));
    expect(bounds(negative.paths[1].d).h).toBeGreaterThan(100);
    expect(negative.labels.map((l) => l.text)).toContain("-30");
  });
});

describe("a line and a donut", () => {
  it("draws the line in one stroke through its points, with a mark at each", () => {
    const drawing = compileChart(chart({ chart: "line" }));
    const [floor, line, ...marks] = drawing.paths;
    expect(floor.ink).toBe("muted");
    expect(line.d.split(" L ")).toHaveLength(3);
    expect(line.ink).toBe("accent");
    expect(marks).toHaveLength(3);
    expect(marks.every((m) => m.fill && /A /.test(m.d))).toBe(true);
    // The highest value is the highest point.
    const ys = line.d.match(/(?:M|L) [\d.]+ ([\d.]+)/g)!.map((s) => Number(s.split(" ")[2]));
    expect(Math.min(...ys)).toBe(ys[1]);
  });

  it("draws a donut as closed wedges around one ring, with a legend beside it", () => {
    const drawing = compileChart(chart({ chart: "donut", palette: "categorical" }));
    const wedges = drawing.paths.filter((p) => /A 165 165/.test(p.d));
    expect(wedges).toHaveLength(3);
    expect(wedges.every((w) => w.fill && /Z$/.test(w.d))).toBe(true);
    expect(new Set(wedges.map((w) => w.ink)).size).toBe(3);
    const legend = drawing.paths.filter((p) => /A 9 9/.test(p.d));
    expect(legend).toHaveLength(3);
    expect(drawing.labels.filter((l) => l.anchor === "start").map((l) => l.text)).toEqual(
      expect.arrayContaining(["Q1", "Q2", "Q3", "10", "40", "20"]),
    );
  });

  it("a wedge is the outer arc, a step in, the inner arc back, and home", () => {
    const d = wedgePath(0, 0, 100, 60, 0, Math.PI / 2);
    expect(d).toMatch(/^M 100 0 A 100 100 0 0 1 0 100 L 0 60 A 60 60 0 0 0 60 0 Z$/);
    // Past a half turn the large-arc flag is set.
    expect(wedgePath(0, 0, 100, 60, 0, Math.PI * 1.5)).toMatch(/A 100 100 0 1 1/);
  });
});

describe("as a drawing", () => {
  it("is a drawing element the schema accepts, with the summary as its name", () => {
    const element = chart({});
    const drawing = chartDrawing(element);
    expect(DrawingElement.safeParse(drawing).success).toBe(true);
    expect(drawing.alt).toBe("Q2 doubled.");
    expect(drawing.frame).toEqual(element.frame);
    expect(drawing.id).toBe(`${element.id}-drawn`);
    // Every stroke is stage 0: the whole chart sketches on arrival, in order.
    expect(drawing.paths.every((p) => p.stage === 0)).toBe(true);
  });

  it("writes values the way a room reads them", () => {
    expect(valueText(7)).toBe("7");
    expect(valueText(7.456)).toBe("7.46");
    expect(valueText(0.1 + 0.2)).toBe("0.3");
  });
});
