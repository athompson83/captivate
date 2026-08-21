import {
  SAFE_MARGIN,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Frame,
  type SceneElement,
} from "@/lib/schema/presentation";

/**
 * Geometry and snapping for direct manipulation on the canvas.
 *
 * All maths is in normalised stage units (0..100 on both axes) so behaviour is
 * identical at any zoom level or display size.
 */

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface Guide {
  axis: "x" | "y";
  /** Position in stage units. */
  at: number;
  kind: "edge" | "center" | "safe" | "element";
}

/** Distance, in stage units, within which a drag snaps to a guide. */
const SNAP_TOLERANCE = 0.9;

export function frameEdges(f: Frame) {
  return {
    left: f.x,
    right: f.x + f.w,
    top: f.y,
    bottom: f.y + f.h,
    centerX: f.x + f.w / 2,
    centerY: f.y + f.h / 2,
  };
}

/** Candidate snap lines: stage centre, safe area, and other elements' edges. */
export function collectSnapTargets(others: SceneElement[]): {
  x: number[];
  y: number[];
  xKinds: Map<number, Guide["kind"]>;
  yKinds: Map<number, Guide["kind"]>;
} {
  const x: number[] = [];
  const y: number[] = [];
  const xKinds = new Map<number, Guide["kind"]>();
  const yKinds = new Map<number, Guide["kind"]>();

  const addX = (v: number, kind: Guide["kind"]) => {
    x.push(v);
    if (!xKinds.has(v) || kind === "center") xKinds.set(v, kind);
  };
  const addY = (v: number, kind: Guide["kind"]) => {
    y.push(v);
    if (!yKinds.has(v) || kind === "center") yKinds.set(v, kind);
  };

  addX(STAGE_WIDTH / 2, "center");
  addY(STAGE_HEIGHT / 2, "center");
  addX(SAFE_MARGIN, "safe");
  addX(STAGE_WIDTH - SAFE_MARGIN, "safe");
  addY(SAFE_MARGIN, "safe");
  addY(STAGE_HEIGHT - SAFE_MARGIN, "safe");

  for (const el of others) {
    if (el.hidden) continue;
    const e = frameEdges(el.frame);
    addX(e.left, "element");
    addX(e.right, "element");
    addX(e.centerX, "element");
    addY(e.top, "element");
    addY(e.bottom, "element");
    addY(e.centerY, "element");
  }

  return { x, y, xKinds, yKinds };
}

interface SnapResult {
  frame: Frame;
  guides: Guide[];
}

/**
 * Snap a moved frame to nearby guides.
 *
 * Each axis is considered independently: the frame's leading edge, centre and
 * trailing edge are each tested against every candidate line, and the single
 * closest match within tolerance wins.
 */
export function snapMove(
  frame: Frame,
  targets: ReturnType<typeof collectSnapTargets>,
  enabled: boolean,
): SnapResult {
  if (!enabled) return { frame, guides: [] };

  const e = frameEdges(frame);

  const x = nearestSnap(targets.x, [e.left, e.centerX, e.right]);
  const y = nearestSnap(targets.y, [e.top, e.centerY, e.bottom]);

  const guides: Guide[] = [];
  if (x) guides.push({ axis: "x", at: x.target, kind: targets.xKinds.get(x.target) ?? "element" });
  if (y) guides.push({ axis: "y", at: y.target, kind: targets.yKinds.get(y.target) ?? "element" });

  return {
    frame: {
      ...frame,
      x: round(frame.x + (x?.delta ?? 0)),
      y: round(frame.y + (y?.delta ?? 0)),
    },
    guides,
  };
}

/** Closest target line to any of the given anchor positions, within tolerance. */
function nearestSnap(
  targets: number[],
  anchors: number[],
): { target: number; delta: number } | null {
  let best: { target: number; delta: number } | null = null;
  let bestDistance = SNAP_TOLERANCE;

  for (const target of targets) {
    for (const anchor of anchors) {
      const delta = target - anchor;
      const distance = Math.abs(delta);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { target, delta };
      }
    }
  }
  return best;
}

/** Apply a resize from a handle, keeping the opposite edge anchored. */
export function applyResize(
  start: Frame,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  opts: { preserveAspect?: boolean; minSize?: number } = {},
): Frame {
  const min = opts.minSize ?? 2;
  let { x, y, w, h } = start;

  if (handle.includes("w")) {
    const nextW = start.w - dx;
    w = Math.max(min, nextW);
    x = start.x + (start.w - w);
  }
  if (handle.includes("e")) {
    w = Math.max(min, start.w + dx);
  }
  if (handle.includes("n")) {
    const nextH = start.h - dy;
    h = Math.max(min, nextH);
    y = start.y + (start.h - h);
  }
  if (handle.includes("s")) {
    h = Math.max(min, start.h + dy);
  }

  if (opts.preserveAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    // Drive the smaller-changing axis from the larger one so the corner follows
    // the pointer rather than lagging behind it.
    if (Math.abs(w - start.w) >= Math.abs(h - start.h)) {
      const nextH = w / ratio;
      if (handle.includes("n")) y = start.y + start.h - nextH;
      h = nextH;
    } else {
      const nextW = h * ratio;
      if (handle.includes("w")) x = start.x + start.w - nextW;
      w = nextW;
    }
  }

  return { ...start, x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Keep a frame at least partly on stage so it can never be lost off-canvas. */
export function clampFrame(frame: Frame): Frame {
  const minVisible = 4;
  return {
    ...frame,
    x: round(Math.min(STAGE_WIDTH - minVisible, Math.max(minVisible - frame.w, frame.x))),
    y: round(Math.min(STAGE_HEIGHT - minVisible, Math.max(minVisible - frame.h, frame.y))),
    w: round(Math.max(2, Math.min(frame.w, STAGE_WIDTH * 2))),
    h: round(Math.max(2, Math.min(frame.h, STAGE_HEIGHT * 2))),
  };
}

/** Bounding box of several frames. */
export function boundingBox(frames: Frame[]): Frame | null {
  if (!frames.length) return null;
  const left = Math.min(...frames.map((f) => f.x));
  const top = Math.min(...frames.map((f) => f.y));
  const right = Math.max(...frames.map((f) => f.x + f.w));
  const bottom = Math.max(...frames.map((f) => f.y + f.h));
  return { x: left, y: top, w: right - left, h: bottom - top, rotation: 0 };
}

export type AlignMode =
  "left" | "center-x" | "right" | "top" | "center-y" | "bottom" | "distribute-x" | "distribute-y";

/** Align or distribute a set of frames. Single selections align to the stage. */
export function alignFrames(frames: Frame[], mode: AlignMode): Frame[] {
  if (!frames.length) return frames;

  const box =
    frames.length === 1
      ? {
          x: SAFE_MARGIN,
          y: SAFE_MARGIN,
          w: STAGE_WIDTH - SAFE_MARGIN * 2,
          h: STAGE_HEIGHT - SAFE_MARGIN * 2,
          rotation: 0,
        }
      : boundingBox(frames)!;

  switch (mode) {
    case "left":
      return frames.map((f) => ({ ...f, x: round(box.x) }));
    case "right":
      return frames.map((f) => ({ ...f, x: round(box.x + box.w - f.w) }));
    case "center-x":
      return frames.map((f) => ({ ...f, x: round(box.x + (box.w - f.w) / 2) }));
    case "top":
      return frames.map((f) => ({ ...f, y: round(box.y) }));
    case "bottom":
      return frames.map((f) => ({ ...f, y: round(box.y + box.h - f.h) }));
    case "center-y":
      return frames.map((f) => ({ ...f, y: round(box.y + (box.h - f.h) / 2) }));
    case "distribute-x": {
      if (frames.length < 3) return frames;
      const sorted = [...frames].sort((a, b) => a.x - b.x);
      const totalW = sorted.reduce((s, f) => s + f.w, 0);
      const gap = (box.w - totalW) / (sorted.length - 1);
      let cursor = box.x;
      const positions = new Map<Frame, number>();
      for (const f of sorted) {
        positions.set(f, round(cursor));
        cursor += f.w + gap;
      }
      return frames.map((f) => ({ ...f, x: positions.get(f) ?? f.x }));
    }
    case "distribute-y": {
      if (frames.length < 3) return frames;
      const sorted = [...frames].sort((a, b) => a.y - b.y);
      const totalH = sorted.reduce((s, f) => s + f.h, 0);
      const gap = (box.h - totalH) / (sorted.length - 1);
      let cursor = box.y;
      const positions = new Map<Frame, number>();
      for (const f of sorted) {
        positions.set(f, round(cursor));
        cursor += f.h + gap;
      }
      return frames.map((f) => ({ ...f, y: positions.get(f) ?? f.y }));
    }
    default:
      return frames;
  }
}

/** Does a frame intersect a marquee rectangle? */
export function intersects(frame: Frame, marquee: { x: number; y: number; w: number; h: number }) {
  return (
    frame.x < marquee.x + marquee.w &&
    frame.x + frame.w > marquee.x &&
    frame.y < marquee.y + marquee.h &&
    frame.y + frame.h > marquee.y
  );
}

/** Two decimal places is well below one device pixel at any realistic size. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export { round as roundStageUnit };
