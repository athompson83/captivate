import { z } from "zod";
import type { DrawnPath } from "@/lib/schema/presentation";
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

export const DiagramNode = z.object({
  id: z.string().min(1).max(24),
  kind: z.enum(["circle", "ellipse", "box", "pill", "cloud", "symbol"]),
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
});
export type DiagramNode = z.infer<typeof DiagramNode>;

export const DiagramEdge = z.object({
  from: z.string().min(1).max(24),
  to: z.string().min(1).max(24),
  kind: z.enum(["arrow", "line", "curve", "both"]).default("arrow"),
  stage: z.number().int().min(0).max(3).default(0),
  accent: z.boolean().default(false),
});
export type DiagramEdge = z.infer<typeof DiagramEdge>;

export const GeneratedDiagram = z.object({
  nodes: z.array(DiagramNode).min(1).max(16),
  edges: z.array(DiagramEdge).max(24).default([]),
  stageLabels: z.array(z.string().max(120)).max(4).default([]),
  alt: z.string().max(600).default(""),
});
export type GeneratedDiagram = z.infer<typeof GeneratedDiagram>;

export interface CompiledDrawing {
  viewBox: { width: number; height: number };
  paths: DrawnPath[];
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
  const rectangular = node.kind === "box" || node.kind === "pill";
  let t: number;
  if (rectangular) {
    const tx = ux !== 0 ? box.w / 2 / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? box.h / 2 / Math.abs(uy) : Infinity;
    t = Math.min(tx, ty);
  } else {
    const rx = box.w / 2;
    const ry = box.h / 2;
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

export function compileDiagram(diagram: GeneratedDiagram): CompiledDrawing {
  const paths: DrawnPath[] = [];
  const boxes = new Map<string, { node: DiagramNode; box: Box }>();

  for (const node of diagram.nodes) {
    const box = boxOf(node);
    boxes.set(node.id, { node, box });
    const ink = node.accent ? ("accent" as const) : undefined;

    if (node.kind === "symbol") {
      const name = node.symbol ?? "lightbulb";
      for (const stroke of symbolPaths(name, box)) {
        paths.push({ d: stroke.d, stage: node.stage, weight: stroke.weight, ink });
      }
      continue;
    }

    const c = centre(box);
    let d: string;
    switch (node.kind) {
      case "circle": {
        const r = Math.min(box.w, box.h) / 2;
        d = circlePath(c.x, c.y, r);
        break;
      }
      case "ellipse":
        d = ellipsePath(c.x, c.y, box.w / 2, box.h / 2);
        break;
      case "pill":
        d = roundedBoxPath(box.x, box.y, box.w, box.h, Math.min(box.w, box.h) / 2);
        break;
      case "cloud":
        d = cloudPath(c.x, c.y, box.w / 2, box.h / 2);
        break;
      default:
        d = roundedBoxPath(box.x, box.y, box.w, box.h, Math.min(box.w, box.h) * 0.18);
    }
    paths.push({ d, stage: node.stage, weight: 1.6, ink, fill: node.fill });
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
    stageLabels: diagram.stageLabels,
    alt: diagram.alt,
  };
}
