import { tokenizePath } from "./path-tokens";

/**
 * Where the ink is.
 *
 * The box a drawing's strokes actually occupy, measured from the path data
 * itself. Used by `normaliseDrawing` to keep a stored box large enough for
 * its picture, and by `frameOf` to show a picture as large as its ink
 * allows rather than as large as the canvas it was composed on.
 */

/** An axis-aligned extent in a drawing's own units. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const overlaps = (a: Bounds, b: Bounds): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

export const contains = (outer: Bounds, inner: Bounds): boolean =>
  inner.minX >= outer.minX &&
  inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY &&
  inner.maxY <= outer.maxY;

/** How many numbers each path command takes, per repetition. */
const ARITY: Record<string, number> = {
  m: 2,
  l: 2,
  t: 2, // x y
  h: 1,
  v: 1, // a single ordinate
  c: 6, // x1 y1 x2 y2 x y
  s: 4,
  q: 4, // x1 y1 x y
  a: 7, // rx ry rotation large-arc sweep x y
  z: 0,
};

/**
 * Every extreme of the ellipse an arc actually turns through.
 *
 * An arc is the one command whose ink is not contained by the points written
 * down: `A 500 500 0 1 1 10 0` starts and ends ten units apart and sweeps most
 * of the way round a circle of radius five hundred. Measured by its endpoints
 * the picture is ten units wide and a thousand units of it are clipped.
 *
 * Padding the endpoints by the radii is the obvious answer and is wrong in both
 * directions at once — it is not a superset (an arc whose endpoints both sit on
 * the far side of the ellipse still reaches a full radius past them), and it is
 * ruinously generous for the common case, growing the box by a diameter for a
 * shallow curve and shrinking the drawing inside its frame to fit. So the arc
 * is converted from its endpoint form to a centre, a start angle and a sweep —
 * the conversion in SVG's own appendix F.6.5 — and the four points where the
 * ellipse is furthest along an axis are counted only if the arc turns through
 * them.
 */
function seeArc(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  see: (x: number, y: number) => void,
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  // The grammar's own degenerate cases: a zero radius makes the arc a straight
  // line, and coincident endpoints omit it entirely. The endpoints bound both,
  // and the caller has already seen them.
  if (!(rx > 0) || !(ry > 0) || (x1 === x2 && y1 === y2)) return;

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // F.6.5.1 — the endpoints in the ellipse's own frame.
  const halfDx = (x1 - x2) / 2;
  const halfDy = (y1 - y2) / 2;
  const px = cosPhi * halfDx + sinPhi * halfDy;
  const py = -sinPhi * halfDx + cosPhi * halfDy;

  // F.6.6 — radii too small to reach across are scaled up until they do.
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  // F.6.5.2 and .3 — the centre.
  const numerator = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
  const denominator = rx * rx * py * py + ry * ry * px * px;
  const coefficient =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxPrime = (coefficient * (rx * py)) / ry;
  const cyPrime = (-coefficient * (ry * px)) / rx;
  const cx = cosPhi * cxPrime - sinPhi * cyPrime + (x1 + x2) / 2;
  const cy = sinPhi * cxPrime + cosPhi * cyPrime + (y1 + y2) / 2;

  // F.6.5.5 and .6 — where on the ellipse the arc begins, and how far it turns.
  const start = Math.atan2((py - cyPrime) / ry, (px - cxPrime) / rx);
  const finish = Math.atan2((-py - cyPrime) / ry, (-px - cxPrime) / rx);
  let delta = finish - start;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  // Where the ellipse stops moving in x, and in y. Under a rotation these are
  // not the axis ends, which is the whole reason for solving them rather than
  // assuming them.
  const stationary = [Math.atan2(-ry * sinPhi, rx * cosPhi), Math.atan2(ry * cosPhi, rx * sinPhi)];
  const from = Math.min(start, start + delta);
  const to = Math.max(start, start + delta);

  for (const angle of stationary) {
    for (const candidate of [angle, angle + Math.PI]) {
      // Turned forward into the swept range: `start` and `delta` describe a
      // stretch of the number line, not a canonical revolution.
      const t = candidate + Math.ceil((from - candidate) / (2 * Math.PI)) * 2 * Math.PI;
      if (t > to) continue;
      see(
        cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
        cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
      );
    }
  }
}

/**
 * The box that actually contains the ink.
 *
 * Path data is not a flat stream of x,y pairs, which is what the first version
 * of this assumed. `H` and `V` take a single ordinate; an arc takes seven
 * numbers of which only the last two are a point, the rest being radii, a
 * rotation and two flags. Reading them pairwise does not merely lose precision
 * — for `M 10 10 A 20 20 0 0 1 900 700` it pairs the flags with the endpoint,
 * decides the drawing is twenty units wide, and the box is left too small for
 * ink that is genuinely at 900. The comment claiming this was "a superset,
 * never too tight" was wrong in exactly the case that matters.
 *
 * So the commands are parsed. Relative forms are resolved against the current
 * point, which is the only way `h`/`v`/`m` mean anything at all. Curve control
 * points are included: a Bézier is contained by the hull of its controls, so
 * counting them is generous in the safe direction, and generous is the side to
 * be wrong on when the alternative is clipping somebody's picture. An arc has
 * no such hull — it leaves the box its endpoints make — and is measured
 * properly by `seeArc`.
 */
export function inkBounds(paths: readonly { d: string }[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let saw = false;

  const see = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    saw = true;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const path of paths) {
    let cursorX = 0;
    let cursorY = 0;
    // Where the subpath began, which is where `Z` returns to.
    let startX = 0;
    let startY = 0;
    let command = "";
    let args: number[] = [];

    const flush = () => {
      if (!command) return;
      const lower = command.toLowerCase();
      const arity = ARITY[lower] ?? 2;
      const relative = command !== command.toUpperCase();

      if (lower === "z") {
        cursorX = startX;
        cursorY = startY;
        args = [];
        return;
      }
      // An incomplete trailing group is skipped rather than guessed at.
      for (let i = 0; i + arity <= args.length; i += arity) {
        const group = args.slice(i, i + arity);
        if (lower === "h") {
          cursorX = relative ? cursorX + group[0] : group[0];
        } else if (lower === "v") {
          cursorY = relative ? cursorY + group[0] : group[0];
        } else if (lower === "a") {
          // An arc's ink is not bounded by the numbers it is written with: five
          // of its seven describe an ellipse, and the curve leaves the box its
          // endpoints make. See `seeArc`.
          const endX = relative ? cursorX + group[5] : group[5];
          const endY = relative ? cursorY + group[6] : group[6];
          seeArc(
            cursorX,
            cursorY,
            group[0],
            group[1],
            group[2],
            group[3] !== 0,
            group[4] !== 0,
            endX,
            endY,
            see,
          );
          cursorX = endX;
          cursorY = endY;
        } else {
          // Everything else ends at its last pair; the pairs before it are
          // control points, which bound the curve and so are worth seeing.
          for (let j = 0; j + 1 < group.length; j += 2) {
            const px = relative ? cursorX + group[j] : group[j];
            const py = relative ? cursorY + group[j + 1] : group[j + 1];
            see(px, py);
          }
          const endX = relative ? cursorX + group[arity - 2] : group[arity - 2];
          const endY = relative ? cursorY + group[arity - 1] : group[arity - 1];
          cursorX = endX;
          cursorY = endY;
          if (lower === "m" && i === 0) {
            startX = endX;
            startY = endY;
          }
        }
        see(cursorX, cursorY);
      }
      args = [];
    };

    for (const token of tokenizePath(path.d)) {
      if ("command" in token) {
        flush();
        command = token.command;
      } else {
        args.push(token.number);
      }
    }
    flush();
  }

  return saw ? { minX, minY, maxX, maxY } : null;
}
