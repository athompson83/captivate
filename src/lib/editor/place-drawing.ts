import type { DrawnPath, SceneContent, SceneElement, SceneLayout } from "@/lib/schema/presentation";
import { elementId, layoutSlots } from "./layouts";

/**
 * Re-exported rather than defined here: `settleCover` moved to `layouts.ts`,
 * beside the composition it corrects, so `relayoutScene` can apply it without
 * this module and that one importing each other.
 */
export { settleCover } from "./layouts";

/**
 * The most presses a drawing may cost to finish.
 *
 * Stage 0 is on the scene when the author arrives, so four stages is three
 * presses. The model was asked for "2 to 8" and took the invitation: a picture
 * could eat eight advances on its own, which stops being a build and starts
 * being an obstacle between the presenter and their next point. Three presses
 * is a beat, a development and a conclusion — enough to build an idea in front
 * of a room, few enough that nobody is clicking a picture into existence while
 * an audience waits.
 */
export const MAX_DRAWING_STAGES = 4;

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

/** A command letter, or a number. Path data is nothing else. */
const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;

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
function inkBounds(paths: readonly { d: string }[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
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

    for (const match of path.d.matchAll(TOKEN)) {
      if (match[1]) {
        flush();
        command = match[1];
      } else {
        args.push(Number(match[2]));
      }
    }
    flush();
  }

  return saw ? { minX, minY, maxX, maxY } : null;
}

/**
 * Makes a generated drawing safe to place, without discarding any of it.
 *
 * Two things a model gets wrong that the document cannot carry.
 *
 * **Ink outside the declared viewBox.** The picture is placed in a frame and
 * the frame is where it belongs, but nothing made the paths stay inside the
 * box the model said they were in — and the renderer drew them anyway, over
 * whatever the scene had there. A chart with two drawing fragments floating
 * across it is what that looks like from the room. The viewBox is widened to
 * contain the ink rather than the ink being clipped to the viewBox: clipping
 * would silently amputate a picture, and a drawing missing a limb is worse
 * than one drawn slightly small.
 *
 * **More stages than a presenter can spend.** See `MAX_DRAWING_STAGES`. The
 * distinct stages are compressed onto the allowed range in order, so a picture
 * built in eight steps still builds in the same sequence — it just arrives in
 * four. Labels are compressed with them, joined so nothing an author wrote is
 * thrown away.
 */
export function normaliseDrawing<
  T extends {
    viewBox: { width: number; height: number };
    paths: DrawnPath[];
    stageLabels: string[];
  },
>(drawing: T): T {
  // ---- The box, widened to hold every stroke -------------------------------
  let viewBox = drawing.viewBox;
  const bounds = inkBounds(drawing.paths);
  if (bounds) {
    // Only ever grown, and only outwards from the origin: shifting the box
    // would move the picture within its frame, and the model composed it where
    // it meant to. The stored viewBox carries no origin, so ink at *negative*
    // coordinates is the one case this cannot cover — the renderer clips it,
    // which `DrawnPicture` says in the same words.
    const width = Math.max(drawing.viewBox.width, bounds.maxX);
    const height = Math.max(drawing.viewBox.height, bounds.maxY);
    viewBox = {
      width: Math.min(4000, Math.max(1, Math.ceil(width))),
      height: Math.min(4000, Math.max(1, Math.ceil(height))),
    };
  }

  // ---- The stages, renumbered onto what a presenter will spend -------------
  //
  // Always renumbered, not only when there are too many. The cap counts
  // *distinct* stages, and the stage number is what the renderer compares the
  // press count against — so a picture with stages 0, 9 and 19 has three of
  // them, passes any count-based check, and still costs nineteen presses. The
  // schema allows values to 19, so that is a drawing a model can really return.
  const distinct = [...new Set(drawing.paths.map((path) => path.stage))].sort((a, b) => a - b);

  // Where each original stage lands. Below the cap this is just its position,
  // which closes the sparse-numbering hole; above it, positions are folded
  // proportionally, so an eight-stage picture becomes two stages per press
  // rather than seven crammed into the first and one into the last.
  const foldedTo = new Map<number, number>();
  for (const [index, stage] of distinct.entries()) {
    foldedTo.set(
      stage,
      distinct.length <= MAX_DRAWING_STAGES
        ? index
        : Math.floor((index * MAX_DRAWING_STAGES) / distinct.length),
    );
  }

  // Dense, because a sparse array keeps its holes through `map` — a fold whose
  // target collected no label left one, and the row serialised as `null` into
  // a column typed as a string. Every position exists and is at worst empty.
  const width = Math.min(MAX_DRAWING_STAGES, distinct.length);
  const labels: string[] = Array.from({ length: width }, () => "");
  for (const [index, stage] of distinct.entries()) {
    const target = foldedTo.get(stage)!;
    const label = drawing.stageLabels[index]?.trim();
    if (!label) continue;
    labels[target] = labels[target] ? `${labels[target]}, ${label}` : label;
  }

  return {
    ...drawing,
    viewBox,
    paths: drawing.paths.map((path) => ({ ...path, stage: foldedTo.get(path.stage) ?? 0 })),
    stageLabels: labels.map((label) => label.slice(0, 120)),
  };
}

/**
 * Swaps a generated scene's empty media placeholder for a drawing.
 *
 * A deck written by the model used to arrive with image slots that were
 * *empty* — the placeholder waited for a photograph that needed a paid
 * provider key the deployment may not have. A drawing needs only the text
 * model that just wrote the deck, so the media slot can arrive with a real
 * staged illustration in it instead of a grey box.
 *
 * Pure and narrow on purpose: it touches exactly one element — the untouched
 * placeholder the layout composer created (an image with no url and no
 * asset) — and returns null rather than guessing when there isn't one. An
 * author's own image, however it got there, is never replaced.
 */
export function replaceMediaWithDrawing(
  content: SceneContent,
  drawing: {
    viewBox: { width: number; height: number };
    paths: DrawnPath[];
    stageLabels: string[];
    alt: string;
  },
  prompt: string,
): SceneContent | null {
  const index = content.elements.findIndex(
    (element) => element.type === "image" && !element.url && !element.assetId,
  );
  if (index === -1) return null;

  const placeholder = content.elements[index] as Extract<SceneElement, { type: "image" }>;
  // Bounded before it is placed, not after: an unbounded drawing renders over
  // its neighbours, and by then it is in somebody's document.
  const safe = normaliseDrawing(drawing);
  const element: SceneElement = {
    id: elementId("drawing"),
    type: "drawing",
    frame: placeholder.frame,
    viewBox: safe.viewBox,
    paths: safe.paths,
    stageLabels: safe.stageLabels,
    ink: "ink",
    // 3, up from 2. The drawing's box is about half the stage, so a unit of
    // its 800-wide viewBox is a pixel on a 1600-pixel stage — and a two-pixel
    // line disappears on a projector. Weights on the paths scale from here.
    strokeWidth: 3,
    paceSeconds: 1.6,
    prompt: prompt.slice(0, 1000),
    alt: safe.alt || placeholder.alt,
    hidden: false,
    locked: false,
    opacity: 1,
    hotspot: null,
    animation: placeholder.animation,
  };

  const elements = [...content.elements];
  elements[index] = element;
  return { ...content, elements };
}

/**
 * Fills a scene's empty media placeholder with a sourced photograph.
 *
 * Patches in place rather than replacing the element, so everything the
 * composition decided — frame, scrim, entrance, and on a cover the exit that
 * lifts the veil — survives the picture arriving. Same one-placeholder rule
 * as the drawing swap: an author's own image is never touched.
 */
export function replaceMediaWithPhoto(
  content: SceneContent,
  photo: { url: string; assetId: string; alt: string },
): SceneContent | null {
  const index = content.elements.findIndex(
    (element) => element.type === "image" && !element.url && !element.assetId,
  );
  if (index === -1) return null;

  const placeholder = content.elements[index] as Extract<SceneElement, { type: "image" }>;
  const elements = [...content.elements];
  elements[index] = {
    ...placeholder,
    url: photo.url,
    assetId: photo.assetId,
    alt: photo.alt || placeholder.alt,
  };
  return { ...content, elements };
}

/**
 * How many staged drawings a deck of this length deserves: one per eight
 * minutes, at least one, and bounded the way every other array here is —
 * each drawing is a full model call someone is paying for.
 *
 * Unless drawings are the only pictures available. A deployment with no stock
 * or image key has exactly one source of imagery, and at one per ten minutes a
 * twenty-scene deck came back with two drawings and eighteen empty slots — the
 * author's report was "no good images, just a couple okay drawing animations",
 * which is precisely what this cap produces when nothing else can fill in
 * behind it. So the rate doubles and the ceiling rises when there is no
 * alternative, and stays where it was when photographs are doing the rest.
 */
export function drawingCap(totalSeconds: number, soleSource = false): number {
  // The sole-source ceiling is the per-presentation drawing budget every
  // plan sells (`PER_PRESENTATION.drawing`), and a test holds the two
  // together: raising it here without raising the budget would sell decks a
  // customer could not finish illustrating.
  const perSeconds = soleSource ? 240 : 480;
  const ceiling = soleSource ? 10 : 8;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 1;
  return Math.min(ceiling, Math.max(1, Math.ceil(totalSeconds / perSeconds)));
}

/**
 * Which generated scenes deserve a drawing.
 *
 * Side-by-side layouts with an untouched placeholder and a real prompt, at
 * most `cap` of them: a full-bleed backdrop — media-full or a cover's veil —
 * wants a photograph rather than line art under text, a slot that already has
 * media belongs to its author, and every drawing is a model call someone is
 * paying for.
 */
export function drawableScenes<T extends { content: SceneContent; imagePrompt: string }>(
  scenes: T[],
  cap = 3,
): T[] {
  return scenes
    .filter(
      (scene) =>
        scene.imagePrompt.trim().length > 0 &&
        scene.content.layout !== "media-full" &&
        scene.content.layout !== "cover" &&
        scene.content.elements.some(
          (element) => element.type === "image" && !element.url && !element.assetId,
        ),
    )
    .slice(0, cap);
}

/**
 * The picture a scene needs, whether or not the model remembered to ask.
 *
 * `layoutFor` chooses the layout before a word is written, so a scene can be a
 * `split-right` — half of it a picture — while the model wrote no image prompt
 * for it. The composition then emitted no image element at all, and
 * `drawableScenes` can only draw into a slot that exists: a twenty-minute talk
 * with a four-drawing budget came back with one drawing, and its side-by-side
 * scenes were text on one half and nothing on the other.
 *
 * So the *layout* decides whether there is a slot, and the model's prompt is
 * only the preferred description of what goes in it. The fallback is built from
 * the line the scene is actually making, which is what a person would
 * illustrate.
 *
 * Here rather than in `ai/service.ts` because that module is `server-only` and
 * this is pure layout arithmetic that a test should be able to import.
 */
export function imagePromptFor(scene: {
  imagePrompt: string;
  layout: SceneLayout;
  heading?: string;
  title?: string;
  body?: string;
}): string {
  if (scene.imagePrompt.trim()) return scene.imagePrompt;
  if (!layoutSlots(scene.layout).media) return "";

  const subject = [scene.heading, scene.title, scene.body]
    .map((part) => part?.trim() ?? "")
    .find((part) => part.length > 0);
  return subject ? `A staged line drawing illustrating: ${subject}` : "";
}
