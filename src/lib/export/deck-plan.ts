import type { PresentationTheme } from "@/lib/schema/theme";
import { resolveColor } from "@/lib/schema/theme";
import type { ColorValue, RichText, Scene, SceneElement } from "@/lib/schema/presentation";

/**
 * A Captivate presentation, flattened into slides.
 *
 * This is a lossy translation and the loss is the point of the module: a deck
 * is a *linear* artefact and Captivate's is not. The camera does not travel,
 * the build steps do not build, and the atmosphere is simply gone. What comes
 * out is what the room saw at the end of each scene, on a page, in order.
 *
 * Everything interesting therefore happens here — what becomes a slide, what
 * survives, and what is dropped — and none of it needs PowerPoint or a
 * browser to decide, so it is all testable. `pptx.ts` writes the file and
 * makes no decisions.
 *
 * The one rule the translation holds to: **nothing an author wrote is
 * silently discarded**. Anything that cannot be drawn on a slide is either
 * carried into the speaker notes or counted in `omissions`, which the export
 * dialog shows before the download starts. An export that quietly loses a
 * third of a talk is worse than one that refuses.
 */

/** Slide geometry, in inches — PowerPoint's own unit. */
export const SLIDE_SIZES = {
  "16:9": { width: 13.333, height: 7.5 },
  "4:3": { width: 10, height: 7.5 },
} as const;

export type SlideAspect = keyof typeof SLIDE_SIZES;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface PlannedRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  href?: string;
}

export type PlannedShape =
  | {
      kind: "text";
      box: Box;
      runs: PlannedRun[];
      fontSize: number;
      align: "left" | "center" | "right";
      valign: "top" | "middle" | "bottom";
      color: string;
      bold: boolean;
      italic: boolean;
      monospace: boolean;
      opacity: number;
      /** A hotspot became a link to the slide the dive would have reached. */
      linkToSlide?: number;
    }
  | {
      kind: "bullets";
      box: Box;
      items: PlannedRun[][];
      ordered: boolean;
      fontSize: number;
      color: string;
      opacity: number;
      linkToSlide?: number;
    }
  | {
      kind: "image";
      box: Box;
      url: string;
      alt: string;
      /** `cover` crops to fill; `contain` fits inside. */
      fit: "cover" | "contain";
      opacity: number;
      linkToSlide?: number;
    }
  | {
      kind: "drawing";
      box: Box;
      /** The picture as a standalone SVG document, ready to rasterise. */
      svg: string;
      alt: string;
      opacity: number;
    }
  | {
      kind: "shape";
      box: Box;
      shape: "rectangle" | "ellipse" | "triangle" | "line";
      fill: string | null;
      stroke: string | null;
      strokeWidth: number;
      radius: number;
      opacity: number;
      linkToSlide?: number;
    }
  | {
      kind: "chart";
      box: Box;
      chart: "bar" | "column" | "line" | "donut";
      title: string;
      points: { label: string; value: number }[];
      color: string;
      opacity: number;
    };

export interface PlannedSlide {
  sceneId: string;
  /** The scene's title, for the slide's own name in PowerPoint's outline. */
  title: string;
  /** Speaker notes, plus anything that could not be drawn. */
  notes: string;
  background: { color: string; image: string | null };
  shapes: PlannedShape[];
  /** True when this slide is an aside rather than a beat of the argument. */
  aside: boolean;
}

/** Something the format cannot carry, counted so it can be said out loud. */
export interface Omission {
  kind: string;
  count: number;
  detail: string;
}

export interface DeckPlan {
  aspect: SlideAspect;
  size: { width: number; height: number };
  slides: PlannedSlide[];
  omissions: Omission[];
}

const PLAIN = (runs: RichText): string => runs.map((run) => run.text).join("");

function toRuns(runs: RichText, theme: PresentationTheme, fallbackColor: string): PlannedRun[] {
  if (runs.length === 0) return [{ text: "" }];
  return runs.map((run) => ({
    text: run.text,
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    color: run.color ? colorOf(run.color, theme, fallbackColor) : undefined,
    href: run.href,
  }));
}

/**
 * A schema colour as a bare hex string, which is all PowerPoint accepts.
 *
 * Through `resolveColor`, so a token means what it means everywhere else. A
 * local "hex or give up" version silently turned every themed colour into the
 * default ink — which on a dark theme is the one colour guaranteed to be
 * invisible on the surface it was meant to sit on.
 */
function colorOf(
  value: ColorValue | null | undefined,
  theme: PresentationTheme,
  fallback: string,
): string {
  if (!value) return fallback;
  return resolveColor(value, theme);
}

/**
 * Normalised stage units to inches.
 *
 * Geometry on the stage is 0–100 in both axes and never pixels, which is
 * exactly why one renderer can serve the editor, the thumbnails, the room and
 * now this: a scene cannot look different in PowerPoint than it did while
 * authoring, because the same two numbers place it.
 */
export function boxOf(
  frame: { x: number; y: number; w: number; h: number; rotation: number },
  size: { width: number; height: number },
): Box {
  return {
    x: (frame.x / 100) * size.width,
    y: (frame.y / 100) * size.height,
    w: (frame.w / 100) * size.width,
    h: (frame.h / 100) * size.height,
    rotation: frame.rotation,
  };
}

/**
 * A stage font size in theme units, as points on a slide.
 *
 * The theme's scale is rem at a 1920px-wide stage. A slide is 13.333in wide,
 * so one stage rem is `13.333 / (1920 / 16)` inches — and a point is 1/72 in.
 */
export function pointsFor(rem: number, slideWidth: number): number {
  const inchesPerRem = slideWidth / (1920 / 16);
  return Math.round(rem * inchesPerRem * 72 * 10) / 10;
}

/** The SVG a drawing's paths make, as a standalone document. */
export function drawingSvg(
  element: Extract<SceneElement, { type: "drawing" }>,
  ink: string,
): string {
  const paths = element.paths
    .map(
      (path) =>
        `<path d="${path.d}" fill="none" stroke="${ink}" stroke-width="${element.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${element.viewBox.width} ${element.viewBox.height}" width="${element.viewBox.width}" height="${element.viewBox.height}">${paths}</svg>`;
}

interface Counter {
  bump(kind: string, detail: string): void;
  list(): Omission[];
}

function counter(): Counter {
  const seen = new Map<string, Omission>();
  return {
    bump(kind, detail) {
      const existing = seen.get(kind);
      if (existing) existing.count += 1;
      else seen.set(kind, { kind, count: 1, detail });
    },
    list() {
      return [...seen.values()];
    },
  };
}

/**
 * The order slides come out in.
 *
 * The running order first — those are the beats of the talk — with each
 * scene's asides placed immediately after it. An aside is reachable only by
 * clicking a hotspot, so in a linear deck it has no natural home; putting it
 * next to its parent keeps it findable and keeps the hotspot's link short.
 * Dropping asides was the other option and it loses whole sections of a talk
 * that the author wrote and the room may well have seen.
 */
export function slideOrder(scenes: readonly Scene[]): Scene[] {
  const details = scenes.filter((scene) => scene.flowRole === "detail");
  const claimed = new Set<string>();
  const ordered: Scene[] = [];

  for (const scene of scenes) {
    if (scene.flowRole === "detail") continue;
    ordered.push(scene);

    const targets = new Set(
      scene.content.elements
        .map((element) => element.hotspot?.targetSceneId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const detail of details) {
      if (targets.has(detail.id) && !claimed.has(detail.id)) {
        claimed.add(detail.id);
        ordered.push(detail);
      }
    }
  }

  // An aside nothing points at is still the author's writing. It goes last
  // rather than nowhere.
  for (const detail of details) {
    if (!claimed.has(detail.id)) ordered.push(detail);
  }
  return ordered;
}

export function planDeck(
  presentation: { title: string; aspectRatio: string },
  scenes: readonly Scene[],
  theme: PresentationTheme,
): DeckPlan {
  const aspect: SlideAspect = presentation.aspectRatio === "4:3" ? "4:3" : "16:9";
  const size = SLIDE_SIZES[aspect];
  const lost = counter();

  const ordered = slideOrder(scenes);
  const slideNumberOf = new Map(ordered.map((scene, index) => [scene.id, index + 1]));

  const slides = ordered.map((scene) => planSlide(scene, theme, size, slideNumberOf, lost));

  return { aspect, size, slides, omissions: lost.list() };
}

function planSlide(
  scene: Scene,
  theme: PresentationTheme,
  size: { width: number; height: number },
  slideNumberOf: Map<string, number>,
  lost: Counter,
): PlannedSlide {
  const shapes: PlannedShape[] = [];
  const extraNotes: string[] = [];

  // A gradient becomes its first stop. PowerPoint can express a gradient, but
  // the stage blends a scene's colour into the air around it rather than
  // painting a rect — so there is no rectangle here to reproduce, only the
  // colour of the room, and the first stop is what that reads as.
  const background = scene.content.background;
  const backgroundColor =
    background.kind === "solid"
      ? colorOf(background.color, theme, theme.tokens.canvas)
      : background.kind === "gradient"
        ? colorOf(background.from, theme, theme.tokens.canvas)
        : theme.tokens.canvas;
  const backgroundImage = background.kind === "image" ? background.url : null;

  let buildSteps = 0;

  for (const element of scene.content.elements) {
    if (element.hidden) continue;
    if (element.animation.onAdvance) buildSteps += 1;

    const box = boxOf(element.frame, size);
    const opacity = element.opacity;
    const link = element.hotspot ? slideNumberOf.get(element.hotspot.targetSceneId) : undefined;
    if (element.hotspot && link === undefined) {
      lost.bump("hotspot", "A hotspot pointed at a scene that is not in this export.");
    }

    switch (element.type) {
      case "heading": {
        const rem =
          element.level === 1
            ? theme.scale.h1
            : element.level === 2
              ? theme.scale.h2
              : theme.scale.h3;
        shapes.push(textShape(element, box, theme, rem, size, opacity, link));
        break;
      }
      case "text": {
        shapes.push(textShape(element, box, theme, theme.scale.body, size, opacity, link));
        break;
      }
      case "quote": {
        shapes.push(textShape(element, box, theme, theme.scale.h3, size, opacity, link, true));
        if (element.attribution) {
          extraNotes.push(`Quote attributed to: ${element.attribution}`);
        }
        break;
      }
      case "list": {
        shapes.push({
          kind: "bullets",
          box,
          items: element.items.map((item) => toRuns(item, theme, theme.tokens.ink)),
          ordered: element.ordered,
          fontSize: pointsFor(theme.scale.body, size.width),
          color: colorOf(element.style.color, theme, theme.tokens.ink),
          opacity,
          linkToSlide: link,
        });
        break;
      }
      case "image": {
        if (!element.url) {
          lost.bump("image", "An image placeholder had no picture in it yet.");
          break;
        }
        shapes.push({
          kind: "image",
          box,
          url: element.url,
          alt: element.alt,
          fit: element.fit === "contain" ? "contain" : "cover",
          opacity,
          linkToSlide: link,
        });
        break;
      }
      case "drawing": {
        const ink =
          element.ink === "accent"
            ? theme.tokens.accent
            : element.ink === "muted"
              ? theme.tokens.inkMuted
              : theme.tokens.ink;
        shapes.push({
          kind: "drawing",
          box,
          svg: drawingSvg(element, ink),
          alt: element.alt,
          opacity,
        });
        // The staging is the teaching. A slide cannot draw itself, so the
        // stages are named in the notes rather than lost.
        if (element.stageLabels.length > 0) {
          extraNotes.push(`Drawing builds in stages: ${element.stageLabels.join(" → ")}`);
        }
        break;
      }
      case "shape": {
        shapes.push({
          kind: "shape",
          box,
          shape: element.shape === "arrow" ? "line" : element.shape,
          fill: element.fill ? colorOf(element.fill, theme, theme.tokens.accent) : null,
          stroke: element.stroke ? colorOf(element.stroke, theme, theme.tokens.line) : null,
          strokeWidth: element.strokeWidth,
          radius: 0,
          opacity,
          linkToSlide: link,
        });
        if (element.shape === "arrow") {
          lost.bump("arrow", "An arrow was exported as a plain line.");
        }
        break;
      }
      case "divider": {
        shapes.push({
          kind: "shape",
          box: { ...box, h: 0 },
          shape: "line",
          fill: null,
          stroke: colorOf(element.color, theme, theme.tokens.line),
          strokeWidth: Math.max(0.5, element.thickness * 4),
          radius: 0,
          opacity,
        });
        break;
      }
      case "callout": {
        const tint = element.tone === "accent" ? theme.tokens.accent : theme.tokens.surface;
        shapes.push({
          kind: "shape",
          box,
          shape: "rectangle",
          fill: theme.tokens.surface,
          stroke: tint,
          strokeWidth: 1,
          radius: 0.1,
          opacity,
        });
        const label = element.title ? [{ text: element.title, bold: true }] : [];
        shapes.push({
          kind: "text",
          box: { ...box, x: box.x + 0.15, y: box.y + 0.1, w: box.w - 0.3, h: box.h - 0.2 },
          runs: [
            ...label,
            ...(element.title ? [{ text: "\n" }] : []),
            ...toRuns(element.content, theme, theme.tokens.ink),
          ],
          fontSize: pointsFor(theme.scale.body, size.width),
          align: "left",
          valign: "middle",
          color: theme.tokens.ink,
          bold: false,
          italic: false,
          monospace: false,
          opacity,
        });
        break;
      }
      case "code": {
        shapes.push({
          kind: "shape",
          box,
          shape: "rectangle",
          fill: theme.tokens.surface,
          stroke: null,
          strokeWidth: 0,
          radius: 0.08,
          opacity,
        });
        shapes.push({
          kind: "text",
          box: { ...box, x: box.x + 0.15, y: box.y + 0.1, w: box.w - 0.3, h: box.h - 0.2 },
          runs: [{ text: element.code }],
          fontSize: pointsFor(theme.scale.caption, size.width),
          align: "left",
          valign: "top",
          color: theme.tokens.ink,
          bold: false,
          italic: false,
          monospace: true,
          opacity,
        });
        break;
      }
      case "chart": {
        shapes.push({
          kind: "chart",
          box,
          chart: element.chart,
          title: element.title,
          points: element.data.map((point) => ({ label: point.label, value: point.value })),
          color: theme.tokens.accent,
          opacity,
        });
        break;
      }
      case "video":
      case "audio":
      case "embed": {
        // A slide cannot play these. The address goes in the notes so the
        // presenter still has the thing, rather than a blank rectangle where
        // it used to be.
        const url = "url" in element ? element.url : "";
        lost.bump(
          element.type,
          `A ${element.type} cannot be placed on a slide; its address is in the notes.`,
        );
        if (url) extraNotes.push(`${element.type}: ${url}`);
        break;
      }
      case "icon": {
        lost.bump("icon", "Icons are drawn by Captivate and have no slide equivalent.");
        break;
      }
    }
  }

  if (buildSteps > 0) {
    lost.bump("build", "Elements that appeared one at a time on advance are all shown at once.");
  }

  const notes = [scene.speakerNotes?.trim() ?? "", ...extraNotes].filter(Boolean).join("\n\n");

  return {
    sceneId: scene.id,
    title: scene.title,
    notes,
    background: { color: backgroundColor, image: backgroundImage },
    shapes,
    aside: scene.flowRole === "detail",
  };
}

function textShape(
  element: Extract<SceneElement, { type: "heading" | "text" | "quote" }>,
  box: Box,
  theme: PresentationTheme,
  rem: number,
  size: { width: number; height: number },
  opacity: number,
  link: number | undefined,
  forceItalic = false,
): PlannedShape {
  const style = element.style;
  const color = colorOf(style.color, theme, theme.tokens.ink);
  const text = toRuns(element.content, theme, color);
  return {
    kind: "text",
    box,
    // `uppercase` is a rendering transform on the stage, and a slide has no
    // equivalent that survives editing — so the text is transformed here
    // instead. Someone opening the deck sees what the room saw.
    runs: style.uppercase ? text.map((run) => ({ ...run, text: run.text.toUpperCase() })) : text,
    // The style's `size` is a multiplier against the theme's step for this
    // role, which is how an author makes one heading bigger without leaving
    // the type scale.
    fontSize: pointsFor(rem * style.size, size.width),
    align: style.align,
    valign: style.valign,
    color,
    bold: style.weight >= 600,
    italic: forceItalic || style.italic,
    monospace: style.family === "mono",
    opacity,
    linkToSlide: link,
  };
}

/** One sentence per omission, for the dialog that offers the download. */
export function describeOmissions(omissions: readonly Omission[]): string[] {
  return omissions.map((omission) => `${omission.count} × ${omission.kind}: ${omission.detail}`);
}

export { PLAIN as plainText };
