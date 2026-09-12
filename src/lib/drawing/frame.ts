import type { DrawnLabel } from "@/lib/schema/presentation";
import { inkBounds, type Bounds } from "./bounds";

/**
 * The frame a drawing is shown in.
 *
 * A drawing is composed on a canvas — 800 by 500 for a diagram or a chart —
 * and a row of three parts uses a band across the middle of it. Shown as the
 * canvas, the picture was a small thing in a large space beside its text,
 * with air above and below it that nobody had drawn. The frame is the box
 * the ink and the names actually occupy, with a margin of air, and it is what
 * the stage and the export fit to the picture's slot: the composition is
 * left exactly where its author put it, and the room sees it as large as its
 * slot allows.
 *
 * Computed from the stored paths every time, never stored: the canvas stays
 * the author's coordinate system, and every drawing already in a deck is
 * framed the moment the recipe exists.
 */

/**
 * How much larger than the canvas would show it a picture may be shown.
 *
 * A lone symbol in the middle of an empty canvas is not enlarged without
 * limit: past twice the size its strokes are ropes and its wash a puddle.
 */
export const FRAME_ZOOM = 2;

/**
 * The base size of a label, in the drawing's own units.
 *
 * Sized against the canvas so a label is the same fraction of the picture
 * whatever box the model drew in: on the 800-wide canvas this is 26, which
 * reads from the back of a room. It is the canvas's width, not the frame's,
 * so a name grows with the part it names when the frame closes in.
 */
export function labelSize(viewBoxWidth: number): number {
  return viewBoxWidth * 0.0325;
}

/**
 * How wide a label runs, in ems.
 *
 * Estimated glyph by glyph, because the compiler and the export have no
 * text measurement and the stage cannot wait for one. A sans face runs a
 * little over half its size per Latin letter; an East Asian glyph, a
 * full-width form or an emoji is a full em, and is one glyph however many
 * code units it takes. The estimate errs wide: a frame closed around a
 * name it under-measured clips the name at both ends.
 */
export function textEms(text: string): number {
  let ems = 0;
  for (const glyph of text) {
    const code = glyph.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code >= 0x1f000 ||
      (code >= 0x20000 && code <= 0x3fffd);
    ems += wide ? 1 : 0.56;
  }
  return ems;
}

/**
 * The box a label occupies, by its anchor, with its halo.
 */
export function labelBox(label: DrawnLabel, base: number): Bounds {
  const size = base * label.size;
  const width = textEms(label.text) * size + size * 0.6;
  const halfHeight = size * 0.65;
  const left =
    label.anchor === "start"
      ? label.x
      : label.anchor === "end"
        ? label.x - width
        : label.x - width / 2;
  return { minX: left, minY: label.y - halfHeight, maxX: left + width, maxY: label.y + halfHeight };
}

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The frame: the ink and the labels, a margin of air around them, and never
 * closer than `FRAME_ZOOM` would allow.
 *
 * The margin holds what the hand adds past the geometry — the wash bled past
 * its line and set off it, the wobble — and a little air besides. Where the
 * content is smaller than a zoom's worth of the canvas, the frame is that
 * size, centred on the content. A picture with nothing measurable is framed
 * as its canvas.
 */
export function frameOf(drawing: {
  viewBox: { width: number; height: number };
  paths: readonly { d: string }[];
  labels?: readonly DrawnLabel[];
  strokeWidth?: number;
}): Frame {
  const { width: canvasW, height: canvasH } = drawing.viewBox;
  const bounds = inkBounds(drawing.paths);
  const base = labelSize(canvasW);
  let extent: Bounds | null = bounds ? { ...bounds } : null;
  for (const label of drawing.labels ?? []) {
    const box = labelBox(label, base);
    extent = extent
      ? {
          minX: Math.min(extent.minX, box.minX),
          minY: Math.min(extent.minY, box.minY),
          maxX: Math.max(extent.maxX, box.maxX),
          maxY: Math.max(extent.maxY, box.maxY),
        }
      : box;
  }
  if (!extent) return { x: 0, y: 0, width: canvasW, height: canvasH };

  const pad = (drawing.strokeWidth ?? 2) * 2 + canvasW * 0.03;
  const w = extent.maxX - extent.minX + pad * 2;
  const h = extent.maxY - extent.minY + pad * 2;
  const width = Math.max(w, canvasW / FRAME_ZOOM);
  const height = Math.max(h, canvasH / FRAME_ZOOM);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    x: round(extent.minX - pad - (width - w) / 2),
    y: round(extent.minY - pad - (height - h) / 2),
    width: round(width),
    height: round(height),
  };
}
