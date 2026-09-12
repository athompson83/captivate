import { z } from "zod";
import type { DrawnLabel, DrawnPath } from "@/lib/schema/presentation";
import { tokenizePath } from "./path-tokens";
import { DIAGRAM_SYMBOLS, symbolNode, type DiagramSymbol, type SymbolNode } from "./symbols";

/**
 * A diagram language, and the compiler that draws it.
 *
 * A language model asked for path data returns a wireframe of wobbly
 * fragments, however well it is briefed: it can reason about *what goes
 * where* and cannot draw a curve. So it is no longer asked to. It composes a
 * diagram — shapes and symbols in boxes, connected by arrows, cut into
 * stages — and this module turns that composition into strokes using recipes
 * designed once: a circle is two arcs, a box is four quadratics, a cloud is
 * a smooth closed curve through bumps on an ellipse, a symbol is a Lucide
 * icon's own path data scaled into its box, and an arrow starts and ends at
 * the edges of the things it connects rather than at their centres.
 *
 * The output is the same `DrawnPath[]` the stage sketches stroke by stroke,
 * so staging, weights, accent, fills, the editor, the export and the audience
 * boundary are all untouched. Same document, better pictures.
 */

export const DIAGRAM_WIDTH = 800;
export const DIAGRAM_HEIGHT = 500;

/** Clear space kept around the picture, so nothing sits on the frame. */
const MARGIN = 24;
/** Air between an arrow's end and the shape it points at. */
const GAP = 8;

/** A word or two on a node or an edge. */
const Label = z.string().max(28).default("");

export const DiagramNode = z.object({
  id: z.string().min(1).max(24),
  /**
   * What the node is.
   *
   * The geometric kinds are containers and quantities; `blob` is anything
   * organic (an organ, a population, a region); `ring` is a hub, a target or
   * a cycle's centre; `bar` is an amount, `value` of its width filled; `stack`
   * is several of a thing, or layers; `symbol` is a named pictogram.
   */
  kind: z.enum([
    "circle",
    "ellipse",
    "box",
    "pill",
    "cloud",
    "blob",
    "ring",
    "bar",
    "stack",
    "symbol",
  ]),
  /** Which symbol, when the kind is `symbol`. Ignored otherwise. */
  symbol: z.enum(DIAGRAM_SYMBOLS).nullable().default(null),
  /** Centre, in the 800×500 box. */
  x: z.number().min(0).max(DIAGRAM_WIDTH),
  y: z.number().min(0).max(DIAGRAM_HEIGHT),
  w: z.number().min(16).max(DIAGRAM_WIDTH),
  h: z.number().min(16).max(DIAGRAM_HEIGHT),
  stage: z.number().int().min(0).max(3).default(0),
  accent: z.boolean().default(false),
  fill: z.boolean().default(false),
  /** Hatched rather than washed: the part that is damaged, blocked or absent. */
  hatch: z.boolean().default(false),
  /** For a bar: how much of it is filled, 0–1. */
  value: z.number().min(0).max(1).nullable().default(null),
  /** The node's name, drawn beside it. Empty for none. */
  label: Label,
});
export type DiagramNode = z.infer<typeof DiagramNode>;

export const DiagramEdge = z.object({
  from: z.string().min(1).max(24),
  to: z.string().min(1).max(24),
  /** `dashed` is a weak or indirect relation; `leader` a thin line that only points. */
  kind: z.enum(["arrow", "line", "curve", "both", "dashed", "leader"]).default("arrow"),
  stage: z.number().int().min(0).max(3).default(0),
  accent: z.boolean().default(false),
  /** What the relation is, drawn at the edge's midpoint. Empty for none. */
  label: Label,
});
export type DiagramEdge = z.infer<typeof DiagramEdge>;

export const GeneratedDiagram = z
  .object({
    nodes: z.array(DiagramNode).min(1).max(16),
    edges: z.array(DiagramEdge).max(24).default([]),
    stageLabels: z.array(z.string().max(120)).max(4).default([]),
    alt: z.string().max(600).default(""),
  })
  // Cross-field: every edge joins two distinct nodes that exist. Checked at
  // the model boundary so a misspelt id earns the corrective retry, rather
  // than the compiler quietly dropping the arrow that was the whole point.
  .superRefine((diagram, ctx) => {
    const ids = new Set<string>();
    diagram.nodes.forEach((node, index) => {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `Node id "${node.id}" is used more than once`,
        });
      }
      ids.add(node.id);
    });
    diagram.edges.forEach((edge, index) => {
      for (const end of ["from", "to"] as const) {
        if (!ids.has(edge[end])) {
          ctx.addIssue({
            code: "custom",
            path: ["edges", index, end],
            message: `Edge ${end} "${edge[end]}" is not a node id`,
          });
        }
      }
      if (edge.from === edge.to) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", index, "to"],
          message: "An edge must join two different nodes",
        });
      }
    });
  });
export type GeneratedDiagram = z.infer<typeof GeneratedDiagram>;

export interface CompiledDrawing {
  viewBox: { width: number; height: number };
  paths: DrawnPath[];
  labels: DrawnLabel[];
  stageLabels: string[];
  alt: string;
}

/* -------------------------------------------------------------------------- */
/* Recipes                                                                     */
/* -------------------------------------------------------------------------- */

const f = (n: number) => String(Math.round(n * 10) / 10);

export function circlePath(cx: number, cy: number, r: number): string {
  return `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)} Z`;
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${f(cx - rx)} ${f(cy)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)} Z`;
}

export function roundedBoxPath(x: number, y: number, w: number, h: number, k: number): string {
  const r = Math.max(0, Math.min(k, w / 2, h / 2));
  return [
    `M ${f(x + r)} ${f(y)}`,
    `H ${f(x + w - r)}`,
    `Q ${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}`,
    `V ${f(y + h - r)}`,
    `Q ${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}`,
    `H ${f(x + r)}`,
    `Q ${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)}`,
    `V ${f(y + r)}`,
    `Q ${f(x)} ${f(y)} ${f(x + r)} ${f(y)}`,
    "Z",
  ].join(" ");
}

/**
 * A smooth closed curve through points — Catmull-Rom, converted to the cubic
 * Béziers path data can carry. Used for the cloud, whose points are bumps on
 * an ellipse; the smoothing is what keeps it from reading as a polygon.
 */
export function smoothClosedPath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n < 3) return "";
  const parts = [`M ${f(points[0].x)} ${f(points[0].y)}`];
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    parts.push(`C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

export function cloudPath(cx: number, cy: number, rx: number, ry: number): string {
  const bumps = 9;
  const points = Array.from({ length: bumps }, (_, i) => {
    const t = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    // Alternating radii make the bumps; a slightly flatter underside makes it
    // a cloud rather than a flower.
    const scale = i % 2 === 0 ? 1 : 0.84;
    const under = Math.sin(t) > 0 ? 0.92 : 1;
    return { x: cx + Math.cos(t) * rx * scale * under, y: cy + Math.sin(t) * ry * scale * under };
  });
  return smoothClosedPath(points);
}

/** A small deterministic hash, so a blob's shape follows its name. */
function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * The points of an organic shape: an ellipse whose radius wanders.
 *
 * Deterministic in the node's id, so a regenerated deck's liver is the same
 * liver. The wander is bounded so the shape stays inside its box and never
 * pinches.
 */
export function blobPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: string,
): { x: number; y: number }[] {
  const n = 9;
  let state = hashOf(seed) || 1;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const r = 0.8 + next() * 0.2;
    return { x: cx + Math.cos(t) * rx * r, y: cy + Math.sin(t) * ry * r };
  });
}

export function blobPath(cx: number, cy: number, rx: number, ry: number, seed: string): string {
  return smoothClosedPath(blobPoints(cx, cy, rx, ry, seed));
}

/** A polygon's vertices for a shape, for hatching and nothing else. */
function outline(node: DiagramNode, box: Box): { x: number; y: number }[] {
  const c = centre(box);
  const ring = (rx: number, ry: number, n = 40) =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return { x: c.x + Math.cos(t) * rx, y: c.y + Math.sin(t) * ry };
    });
  switch (node.kind) {
    case "circle": {
      const r = Math.min(box.w, box.h) / 2;
      return ring(r, r);
    }
    case "ellipse":
    case "cloud":
      return ring(box.w / 2, box.h / 2);
    case "blob":
      return blobPoints(c.x, c.y, box.w / 2, box.h / 2, node.id);
    default: {
      // Boxes, pills, bars and stacks: the rectangle, inset a little so the
      // hatching stops short of a rounded corner.
      const inset = Math.min(box.w, box.h) * 0.08;
      return [
        { x: box.x + inset, y: box.y + inset },
        { x: box.x + box.w - inset, y: box.y + inset },
        { x: box.x + box.w - inset, y: box.y + box.h - inset },
        { x: box.x + inset, y: box.y + box.h - inset },
      ];
    }
  }
}

/** Air between hatch lines, in canvas units. */
export const HATCH_SPACING = 13;

/**
 * Diagonal hatching inside a polygon.
 *
 * Each candidate line is clipped to the polygon by walking its edges: every
 * crossing is a parameter along the line, and the crossings pair up into
 * the runs that lie inside. Even-odd, so a concave blob hatches correctly
 * and nothing is drawn across a bay.
 */
export function hatchLines(polygon: { x: number; y: number }[], spacing = HATCH_SPACING): string[] {
  if (polygon.length < 3) return [];
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const lines: string[] = [];
  // Lines of the form x - y = k, at 45 degrees, rising to the right.
  for (let k = minX - maxY; k <= maxX - minY; k += spacing) {
    const crossings: number[] = [];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      // Solve for the point on segment ab where x - y = k.
      const da = a.x - a.y - k;
      const db = b.x - b.y - k;
      if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
        const s = da / (da - db);
        crossings.push(a.x + (b.x - a.x) * s);
      }
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const x1 = crossings[i];
      const x2 = crossings[i + 1];
      if (x2 - x1 < 3) continue;
      lines.push(`M ${f(x1)} ${f(x1 - k)} L ${f(x2)} ${f(x2 - k)}`);
    }
  }
  return lines;
}

/** A straight line as dashes: a weak relation, drawn as one. */
export function dashedLine(
  start: { x: number; y: number },
  end: { x: number; y: number },
  dash = 12,
  gap = 8,
): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return "";
  const ux = dx / length;
  const uy = dy / length;
  const parts: string[] = [];
  for (let at = 0; at < length; at += dash + gap) {
    const to = Math.min(length, at + dash);
    parts.push(
      `M ${f(start.x + ux * at)} ${f(start.y + uy * at)} L ${f(start.x + ux * to)} ${f(start.y + uy * to)}`,
    );
  }
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Symbols: an icon's primitives, transformed into a box                        */
/* -------------------------------------------------------------------------- */

const ARITY: Record<string, number> = {
  m: 2,
  l: 2,
  t: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  a: 7,
  z: 0,
};

/**
 * Uniformly scales path data and moves it, keeping every command's meaning.
 *
 * Relative commands scale but do not translate; an arc's radii scale, its
 * rotation and flags do not; `H` and `V` carry one ordinate each. The
 * tokenizer is the one `inkBounds` uses, for the same reason: path data is not
 * a flat list of pairs.
 */
export function transformPath(d: string, s: number, tx: number, ty: number): string {
  const out: string[] = [];
  let command = "";
  let args: number[] = [];

  const flush = () => {
    if (!command) return;
    const lower = command.toLowerCase();
    const arity = ARITY[lower] ?? 2;
    const emitted: string[] = [command];
    if (lower === "z") {
      out.push("Z");
      args = [];
      command = "";
      return;
    }
    for (let i = 0; i + arity <= args.length; i += arity) {
      const group = args.slice(i, i + arity);
      // A path that opens with a relative move starts from nowhere, so the
      // grammar treats that first pair as absolute — and so must this, or a
      // symbol's later subpaths land in the box while its first one stays at
      // the origin. The pairs after it are lines, and relative.
      const relative =
        command !== command.toUpperCase() && !(lower === "m" && out.length === 0 && i === 0);
      if (lower === "h") emitted.push(f(group[0] * s + (relative ? 0 : tx)));
      else if (lower === "v") emitted.push(f(group[0] * s + (relative ? 0 : ty)));
      else if (lower === "a") {
        emitted.push(
          f(group[0] * s),
          f(group[1] * s),
          f(group[2]),
          String(group[3] ? 1 : 0),
          String(group[4] ? 1 : 0),
          f(group[5] * s + (relative ? 0 : tx)),
          f(group[6] * s + (relative ? 0 : ty)),
        );
      } else {
        for (let j = 0; j < group.length; j += 2) {
          emitted.push(f(group[j] * s + (relative ? 0 : tx)));
          emitted.push(f(group[j + 1] * s + (relative ? 0 : ty)));
        }
      }
    }
    out.push(emitted.join(" "));
    args = [];
  };

  for (const token of tokenizePath(d)) {
    if ("command" in token) {
      flush();
      command = token.command;
    } else {
      args.push(token.number);
    }
  }
  flush();
  return out.join(" ");
}

const num = (value: string | undefined, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** One icon primitive as path data in the icon's own 24×24 space. */
export function primitivePath(node: SymbolNode[number]): string | null {
  const [tag, attrs] = node;
  switch (tag) {
    case "path":
      return attrs.d ?? null;
    case "circle":
      return circlePath(num(attrs.cx), num(attrs.cy), num(attrs.r));
    case "ellipse":
      return ellipsePath(num(attrs.cx), num(attrs.cy), num(attrs.rx), num(attrs.ry));
    case "rect":
      return roundedBoxPath(
        num(attrs.x),
        num(attrs.y),
        num(attrs.width),
        num(attrs.height),
        num(attrs.rx ?? attrs.ry, 0),
      );
    case "line":
      return `M ${f(num(attrs.x1))} ${f(num(attrs.y1))} L ${f(num(attrs.x2))} ${f(num(attrs.y2))}`;
    case "polyline":
    case "polygon": {
      const pairs = (attrs.points ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite);
      if (pairs.length < 4) return null;
      const parts = [`M ${f(pairs[0])} ${f(pairs[1])}`];
      for (let i = 2; i + 1 < pairs.length; i += 2)
        parts.push(`L ${f(pairs[i])} ${f(pairs[i + 1])}`);
      if (tag === "polygon") parts.push("Z");
      return parts.join(" ");
    }
    default:
      return null;
  }
}

/**
 * A symbol's strokes, scaled to sit inside a box.
 *
 * Icons are drawn at a 2-unit stroke on a 24-unit grid. The weight keeps that
 * proportion at the drawn size, against the element's base stroke of 3, so a
 * large symbol is bold and a small one fine — the way the icon was designed
 * to look, rather than the same hairline at every size.
 */
export function symbolPaths(name: DiagramSymbol, box: Box): { d: string; weight: number }[] {
  const size = Math.min(box.w, box.h);
  const s = size / 24;
  const tx = box.x + (box.w - size) / 2;
  const ty = box.y + (box.h - size) / 2;
  const weight = Math.min(4, Math.max(0.6, (2 * s) / 3));
  return symbolNode(name)
    .map(primitivePath)
    .filter((d): d is string => Boolean(d))
    .map((d) => ({ d: transformPath(d, s, tx, ty), weight }));
}

/* -------------------------------------------------------------------------- */
/* Edges                                                                       */
/* -------------------------------------------------------------------------- */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * Where a ray from a node's centre leaves the node.
 *
 * Boxes and pills clip to their rectangle; everything else — circles,
 * ellipses, clouds and symbols — to the ellipse their box inscribes. An arrow
 * that starts at a centre disappears under the shape it leaves; one clipped
 * here starts at its edge, with a little air.
 */
export function boundaryPoint(node: DiagramNode, box: Box, towards: { x: number; y: number }) {
  const c = centre(box);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return c;
  const ux = dx / length;
  const uy = dy / length;
  const rectangular =
    node.kind === "box" || node.kind === "pill" || node.kind === "bar" || node.kind === "stack";
  let t: number;
  if (rectangular) {
    const tx = ux !== 0 ? box.w / 2 / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? box.h / 2 / Math.abs(uy) : Infinity;
    t = Math.min(tx, ty);
  } else {
    // A circle is drawn at the smaller of its two sides; clipping to the box's
    // ellipse would leave an arrow hanging in air along the longer one.
    const rx = node.kind === "circle" ? Math.min(box.w, box.h) / 2 : box.w / 2;
    const ry = node.kind === "circle" ? rx : box.h / 2;
    t = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
  }
  t += GAP;
  return { x: c.x + ux * Math.min(t, length / 2), y: c.y + uy * Math.min(t, length / 2) };
}

function arrowHead(
  tip: { x: number; y: number },
  direction: { x: number; y: number },
  shaftLength: number,
): string {
  const length = Math.min(26, Math.max(14, shaftLength * 0.12));
  const angle = (28 * Math.PI) / 180;
  const back = Math.atan2(-direction.y, -direction.x);
  const a = {
    x: tip.x + Math.cos(back + angle) * length,
    y: tip.y + Math.sin(back + angle) * length,
  };
  const b = {
    x: tip.x + Math.cos(back - angle) * length,
    y: tip.y + Math.sin(back - angle) * length,
  };
  return `M ${f(a.x)} ${f(a.y)} L ${f(tip.x)} ${f(tip.y)} L ${f(b.x)} ${f(b.y)}`;
}

/* -------------------------------------------------------------------------- */
/* The compiler                                                                */
/* -------------------------------------------------------------------------- */

/** A node's box, clamped so the whole shape sits inside the picture's margin. */
function boxOf(node: DiagramNode): Box {
  const w = Math.min(node.w, DIAGRAM_WIDTH - MARGIN * 2);
  const h = Math.min(node.h, DIAGRAM_HEIGHT - MARGIN * 2);
  const cx = Math.min(DIAGRAM_WIDTH - MARGIN - w / 2, Math.max(MARGIN + w / 2, node.x));
  const cy = Math.min(DIAGRAM_HEIGHT - MARGIN - h / 2, Math.max(MARGIN + h / 2, node.y));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Where a node's name goes: inside a wide container, below anything else. */
function labelFor(node: DiagramNode, box: Box): DrawnLabel | null {
  const text = node.label.trim();
  if (!text) return null;
  const c = centre(box);
  const wide = (node.kind === "box" || node.kind === "pill") && box.w >= 120 && box.h >= 44;
  const y = wide ? c.y : Math.min(DIAGRAM_HEIGHT - 12, box.y + box.h + 20);
  return {
    text,
    x: c.x,
    y,
    stage: node.stage,
    ink: node.accent ? "accent" : undefined,
    size: 1,
    anchor: "middle",
  };
}

export function compileDiagram(diagram: GeneratedDiagram): CompiledDrawing {
  const paths: DrawnPath[] = [];
  const labels: DrawnLabel[] = [];
  const boxes = new Map<string, { node: DiagramNode; box: Box }>();

  for (const node of diagram.nodes) {
    const box = boxOf(node);
    boxes.set(node.id, { node, box });
    const ink = node.accent ? ("accent" as const) : undefined;
    const label = labelFor(node, box);
    if (label) labels.push(label);

    if (node.kind === "symbol") {
      const name = node.symbol ?? "lightbulb";
      for (const stroke of symbolPaths(name, box)) {
        paths.push({ d: stroke.d, stage: node.stage, weight: stroke.weight, ink });
      }
      continue;
    }

    // Hatching goes under the outline, at a light weight in the muted ink,
    // and never together with a wash: the two say opposite things.
    if (node.hatch) {
      for (const d of hatchLines(outline(node, box))) {
        paths.push({ d, stage: node.stage, weight: 0.5, ink: "muted" });
      }
    }
    const fill = node.fill && !node.hatch;

    const c = centre(box);
    switch (node.kind) {
      case "circle": {
        const r = Math.min(box.w, box.h) / 2;
        paths.push({ d: circlePath(c.x, c.y, r), stage: node.stage, weight: 1.6, ink, fill });
        break;
      }
      case "ellipse":
        paths.push({
          d: ellipsePath(c.x, c.y, box.w / 2, box.h / 2),
          stage: node.stage,
          weight: 1.6,
          ink,
          fill,
        });
        break;
      case "pill":
        paths.push({
          d: roundedBoxPath(box.x, box.y, box.w, box.h, Math.min(box.w, box.h) / 2),
          stage: node.stage,
          weight: 1.6,
          ink,
          fill,
        });
        break;
      case "cloud":
        paths.push({
          d: cloudPath(c.x, c.y, box.w / 2, box.h / 2),
          stage: node.stage,
          weight: 1.6,
          ink,
          fill,
        });
        break;
      case "blob":
        paths.push({
          d: blobPath(c.x, c.y, box.w / 2, box.h / 2, node.id),
          stage: node.stage,
          weight: 1.7,
          ink,
          fill,
        });
        break;
      case "ring": {
        // Two circles; the wash, if any, is the band between them read as
        // the outer disc — a hole cannot be cut in path data the document
        // stores, so a filled ring is a filled disc with an inner line.
        const r = Math.min(box.w, box.h) / 2;
        paths.push({ d: circlePath(c.x, c.y, r), stage: node.stage, weight: 1.6, ink, fill });
        paths.push({ d: circlePath(c.x, c.y, r * 0.58), stage: node.stage, weight: 1.2, ink });
        break;
      }
      case "bar": {
        // The full extent as an outline, the amount as a wash inside it,
        // from the left. A bar with no value is drawn half full rather than
        // empty: an empty bar says "nothing", which is rarely the claim.
        const k = Math.min(box.h / 2, 10);
        paths.push({
          d: roundedBoxPath(box.x, box.y, box.w, box.h, k),
          stage: node.stage,
          weight: 1.4,
          ink,
        });
        const share = node.value ?? 0.5;
        const filledWidth = Math.max(k * 2, box.w * share);
        if (share > 0) {
          paths.push({
            d: roundedBoxPath(box.x, box.y, filledWidth, box.h, k),
            stage: node.stage,
            weight: 1.6,
            ink: node.accent ? "accent" : ink,
            fill: true,
          });
        }
        break;
      }
      case "stack": {
        // Three of the thing, the back two set up and to the right and
        // drawn lighter, the front one full weight: many, with depth.
        const step = Math.min(14, box.w * 0.08, box.h * 0.12);
        const w = box.w - step * 2;
        const h = box.h - step * 2;
        const k = Math.min(w, h) * 0.18;
        for (let i = 2; i >= 0; i -= 1) {
          paths.push({
            d: roundedBoxPath(box.x + step * i, box.y + step * (2 - i), w, h, k),
            stage: node.stage,
            weight: i === 0 ? 1.6 : 1,
            ink: i === 0 ? ink : "muted",
            fill: i === 0 ? fill : false,
          });
        }
        break;
      }
      default:
        paths.push({
          d: roundedBoxPath(box.x, box.y, box.w, box.h, Math.min(box.w, box.h) * 0.18),
          stage: node.stage,
          weight: 1.6,
          ink,
          fill,
        });
    }
  }

  for (const edge of diagram.edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to || from === to) continue;
    const ink = edge.accent ? ("accent" as const) : undefined;

    const start = boundaryPoint(from.node, from.box, centre(to.box));
    const end = boundaryPoint(to.node, to.box, centre(from.box));
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 4) continue;

    // The relation's name, a little to one side of the midpoint so it does
    // not sit on the line it describes.
    const relation = edge.label.trim();
    if (relation) {
      labels.push({
        text: relation,
        x: (start.x + end.x) / 2 - (dy / length) * 14,
        y: (start.y + end.y) / 2 + (dx / length) * 14,
        stage: edge.stage,
        ink: edge.accent ? "accent" : "muted",
        size: 0.85,
        anchor: "middle",
      });
    }

    if (edge.kind === "dashed" || edge.kind === "leader") {
      const d =
        edge.kind === "dashed"
          ? dashedLine(start, end)
          : `M ${f(start.x)} ${f(start.y)} L ${f(end.x)} ${f(end.y)}`;
      if (d)
        paths.push({
          d,
          stage: edge.stage,
          weight: edge.kind === "leader" ? 0.7 : 1.1,
          ink: ink ?? "muted",
        });
      continue;
    }

    if (edge.kind === "curve") {
      // Bowed to the left of the direction of travel, a hand's width at most.
      const bow = Math.min(60, length * 0.22);
      const control = {
        x: (start.x + end.x) / 2 + (dy / length) * bow,
        y: (start.y + end.y) / 2 - (dx / length) * bow,
      };
      paths.push({
        d: `M ${f(start.x)} ${f(start.y)} Q ${f(control.x)} ${f(control.y)} ${f(end.x)} ${f(end.y)}`,
        stage: edge.stage,
        weight: 1.2,
        ink,
      });
      paths.push({
        d: arrowHead(end, { x: end.x - control.x, y: end.y - control.y }, length),
        stage: edge.stage,
        weight: 1.2,
        ink,
      });
      continue;
    }

    paths.push({
      d: `M ${f(start.x)} ${f(start.y)} L ${f(end.x)} ${f(end.y)}`,
      stage: edge.stage,
      weight: 1.2,
      ink,
    });
    if (edge.kind === "arrow" || edge.kind === "both") {
      paths.push({
        d: arrowHead(end, { x: dx, y: dy }, length),
        stage: edge.stage,
        weight: 1.2,
        ink,
      });
    }
    if (edge.kind === "both") {
      paths.push({
        d: arrowHead(start, { x: -dx, y: -dy }, length),
        stage: edge.stage,
        weight: 1.2,
        ink,
      });
    }
  }

  return {
    viewBox: { width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT },
    paths,
    labels,
    stageLabels: diagram.stageLabels,
    alt: diagram.alt,
  };
}
