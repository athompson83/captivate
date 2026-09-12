import type {
  DrawingElement,
  DrawnLabel,
  DrawnPath,
  SceneElement,
} from "@/lib/schema/presentation";
import {
  DIAGRAM_HEIGHT,
  DIAGRAM_WIDTH,
  boxPolygon,
  circlePath,
  keptInside,
  roundedBoxPath,
  SHADE_WEIGHT,
  shadeLines,
} from "./diagram";
import type { CompiledDrawing } from "./diagram";

/**
 * A chart drawn by the same hand as the diagrams.
 *
 * A chart on the stage was a set of coloured rectangles from a spreadsheet:
 * exact, weightless, and in a different visual language from the drawing
 * beside it and the icon above it. A lecturer at a whiteboard does not draw
 * that chart — they draw a baseline and a few bars with the amounts written
 * over them, and the room reads it as an argument rather than a report.
 *
 * So a chart is compiled into the drawing language: a baseline, each bar
 * an outline with a wash inside it, a line through its points with a mark
 * at each, a donut as wedges, and every word — the categories, the values,
 * the legend — as a label in the room's own type. The result is the same
 * `DrawnPath[]` and `DrawnLabel[]` a drawing carries, so the stage sketches
 * a chart stroke by stroke on arrival, through the same three hands, with
 * the same wash. The document is untouched: the chart element stays a chart
 * element, with its data, and is drawn this way at render time.
 *
 * Pure, and free of React: the export and the tests read it too.
 */

export type ChartElement = Extract<SceneElement, { type: "chart" }>;

const W = DIAGRAM_WIDTH;
const H = DIAGRAM_HEIGHT;
/** Clear space at every edge. */
const EDGE = 44;
/** Room under a plot for its category names. */
const NAME_ROOM = 48;
/** Room over a plot for its values. */
const VALUE_ROOM = 40;

/** The inks a series cycles through where one colour would not tell them apart. */
const SERIES_INKS = ["accent", "ink", "muted"] as const;

function f(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** A value as the room should read it: no float noise, thousands kept whole. */
export function valueText(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/** One series' ink: the accent for an accent palette, cycling otherwise. */
function inkFor(element: ChartElement, i: number): DrawnPath["ink"] {
  if (element.palette === "accent") return "accent";
  return SERIES_INKS[i % SERIES_INKS.length];
}

/** A label's text within the room's limit, shortened visibly rather than cut. */
export function labelText(text: string): string {
  const limit = 28;
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function label(text: string, x: number, y: number, over: Partial<DrawnLabel> = {}): DrawnLabel {
  return keptInside({
    text: labelText(text),
    x,
    y,
    stage: 0,
    ink: undefined,
    size: 0.9,
    anchor: "middle",
    ...over,
  });
}

function arcPoint(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}

/**
 * A closed wedge of a ring, from `a0` to `a1` clockwise: the outer arc, a
 * step in, the inner arc back, and home. Closed, so it takes a wash.
 */
export function wedgePath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = arcPoint(cx, cy, outer, a0);
  const o1 = arcPoint(cx, cy, outer, a1);
  const i0 = arcPoint(cx, cy, inner, a0);
  const i1 = arcPoint(cx, cy, inner, a1);
  return (
    `M ${f(o0.x)} ${f(o0.y)} A ${f(outer)} ${f(outer)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)} ` +
    `L ${f(i1.x)} ${f(i1.y)} A ${f(inner)} ${f(inner)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)} Z`
  );
}

export function compileChart(element: ChartElement): CompiledDrawing {
  const paths: DrawnPath[] = [];
  const labels: DrawnLabel[] = [];
  const data = element.data.length ? element.data : [{ label: "No data", value: 0 }];
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const alt = element.summary || element.title || `${element.chart} chart`;
  const n = data.length;

  if (element.chart === "donut") {
    // The ring on the left, its legend on the right, so a name never has
    // to be read along a curve.
    const cx = 250;
    const cy = H / 2;
    const outer = 165;
    const inner = 100;
    const total = data.reduce((s, d) => s + Math.abs(d.value), 0) || 1;
    // A breath between wedges, so two the same ink still read as two. A
    // sliver keeps half its own sweep rather than vanishing into the gap,
    // so the ring never contradicts its legend.
    const gap = n > 1 ? (2.5 * Math.PI) / 180 : 0;
    const whole = data.filter((d) => Math.abs(d.value) > 0);
    if (whole.length === 1 || n === 1) {
      // One thing is the whole ring. An arc from a point back to itself
      // draws nothing, so the ring is two circles, as a diagram's is.
      const i = whole.length === 1 ? data.indexOf(whole[0]) : 0;
      paths.push({
        d: circlePath(cx, cy, outer),
        weight: 1.4,
        ink: inkFor(element, i),
        fill: true,
        stage: 0,
      });
      paths.push({ d: circlePath(cx, cy, inner), weight: 1.2, ink: inkFor(element, i), stage: 0 });
    } else {
      let angle = -Math.PI / 2;
      data.forEach((d, i) => {
        const sweep = (Math.abs(d.value) / total) * Math.PI * 2;
        if (sweep <= 0) return;
        const breath = Math.min(gap, sweep / 2);
        const a0 = angle + breath / 2;
        const a1 = angle + sweep - breath / 2;
        paths.push({
          d: wedgePath(cx, cy, outer, inner, a0, a1),
          weight: 1.4,
          ink: inkFor(element, i),
          fill: true,
          stage: 0,
        });
        angle += sweep;
      });
    }
    const legendX = 480;
    const step = Math.min(46, (H - EDGE * 2) / Math.max(1, n));
    const top = cy - (step * (n - 1)) / 2;
    data.forEach((d, i) => {
      const y = top + i * step;
      paths.push({
        d: circlePath(legendX, y, 9),
        weight: 1.2,
        ink: inkFor(element, i),
        fill: true,
        stage: 0,
      });
      labels.push(label(d.label, legendX + 24, y, { anchor: "start", size: 0.9 }));
      if (element.showValues) {
        labels.push(
          label(valueText(d.value), legendX + 24 + Math.min(d.label.length, 28) * 13 + 14, y, {
            anchor: "start",
            size: 0.85,
            ink: "muted",
          }),
        );
      }
    });
    return { viewBox: { width: W, height: H }, paths, labels, stageLabels: [], alt };
  }

  if (element.chart === "line") {
    const left = EDGE + 16;
    const right = W - EDGE - 16;
    const top = EDGE + VALUE_ROOM;
    const base = H - EDGE - NAME_ROOM;
    const points = data.map((d, i) => ({
      x: n > 1 ? left + ((right - left) * i) / (n - 1) : (left + right) / 2,
      y: base - ((base - top) * Math.abs(d.value)) / max,
    }));
    // The floor first, then the line in one stroke, then a mark at each
    // point: the way a hand draws it, and the order the room watches.
    paths.push({
      d: `M ${f(left)} ${f(base)} L ${f(right)} ${f(base)}`,
      weight: 0.8,
      ink: "muted",
      stage: 0,
    });
    paths.push({
      d: points.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" "),
      weight: 1.6,
      ink: "accent",
      stage: 0,
    });
    points.forEach((p, i) => {
      paths.push({ d: circlePath(p.x, p.y, 7), weight: 1.2, fill: true, stage: 0 });
      labels.push(label(data[i].label, p.x, base + 26, { ink: "muted", size: 0.85 }));
      if (element.showValues)
        labels.push(label(valueText(data[i].value), p.x, p.y - 22, { size: 0.85 }));
    });
    return { viewBox: { width: W, height: H }, paths, labels, stageLabels: [], alt };
  }

  if (element.chart === "bar") {
    // Names on the left, bars growing right from a common floor.
    const nameW = 150;
    const left = EDGE + nameW;
    const right = W - EDGE - (element.showValues ? 64 : 0);
    const top = EDGE;
    const bottom = H - EDGE;
    const slot = (bottom - top) / n;
    const thickness = Math.min(56, slot * 0.62);
    const k = Math.min(thickness / 2, 10);
    paths.push({
      d: `M ${f(left)} ${f(top)} L ${f(left)} ${f(bottom)}`,
      weight: 0.8,
      ink: "muted",
      stage: 0,
    });
    data.forEach((d, i) => {
      const y = top + slot * (i + 0.5);
      const length = Math.max(k * 2, ((right - left) * Math.abs(d.value)) / max);
      paths.push({
        d: roundedBoxPath(left, y - thickness / 2, length, thickness, k),
        weight: 1.4,
        ink: inkFor(element, i),
        fill: true,
        stage: 0,
      });
      for (const s of shadeLines(boxPolygon(left, y - thickness / 2, length, thickness, k * 0.6)))
        paths.push({ d: s, weight: SHADE_WEIGHT, ink: "muted", stage: 0 });
      labels.push(label(d.label, left - 14, y, { anchor: "end", size: 0.9 }));
      if (element.showValues)
        labels.push(
          label(valueText(d.value), left + length + 14, y, {
            anchor: "start",
            size: 0.85,
            ink: "muted",
          }),
        );
    });
    return { viewBox: { width: W, height: H }, paths, labels, stageLabels: [], alt };
  }

  // Columns: the default, and what a whiteboard chart usually is.
  const left = EDGE;
  const right = W - EDGE;
  const top = EDGE + (element.showValues ? VALUE_ROOM : 0);
  const base = H - EDGE - NAME_ROOM;
  const slot = (right - left) / n;
  const width = Math.min(120, slot * 0.62);
  const k = Math.min(width / 2, 10);
  paths.push({
    d: `M ${f(left)} ${f(base)} L ${f(right)} ${f(base)}`,
    weight: 0.8,
    ink: "muted",
    stage: 0,
  });
  data.forEach((d, i) => {
    const x = left + slot * (i + 0.5);
    const height = Math.max(k * 2, ((base - top) * Math.abs(d.value)) / max);
    paths.push({
      d: roundedBoxPath(x - width / 2, base - height, width, height, k),
      weight: 1.4,
      ink: inkFor(element, i),
      fill: true,
      stage: 0,
    });
    // The light on a column, as on any form: shade on the side away from it.
    for (const s of shadeLines(boxPolygon(x - width / 2, base - height, width, height, k * 0.6)))
      paths.push({ d: s, weight: SHADE_WEIGHT, ink: "muted", stage: 0 });
    labels.push(label(d.label, x, base + 26, { ink: "muted", size: 0.85 }));
    if (element.showValues)
      labels.push(label(valueText(d.value), x, base - height - 20, { size: 0.9 }));
  });
  return { viewBox: { width: W, height: H }, paths, labels, stageLabels: [], alt };
}

/**
 * The chart as the drawing element the stage sketches.
 *
 * Built at render time and never stored: the chart element keeps its data,
 * and a change to the recipe reaches every chart already in a deck.
 */
export function chartDrawing(element: ChartElement): DrawingElement {
  const drawing = compileChart(element);
  return {
    id: `${element.id}-drawn`,
    type: "drawing",
    frame: element.frame,
    hidden: element.hidden,
    locked: element.locked,
    opacity: element.opacity,
    hotspot: element.hotspot,
    animation: element.animation,
    viewBox: drawing.viewBox,
    paths: drawing.paths,
    labels: drawing.labels,
    stageLabels: [],
    ink: "ink",
    strokeWidth: 3,
    paceSeconds: 1.6,
    prompt: "",
    alt: drawing.alt,
  };
}
