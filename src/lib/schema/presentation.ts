import { z } from "zod";

/**
 * Captivate presentation content model.
 *
 * Design notes:
 *  - Geometry is stored in *normalised stage units*: 0..100 on both axes,
 *    independent of the rendered pixel size or the display aspect ratio. A
 *    scene therefore renders identically on a 13" laptop and a 4K projector.
 *  - Every persisted structure carries `SCENE_SCHEMA_VERSION` so stored
 *    content can be migrated forward without guesswork.
 *  - Elements are a discriminated union. Adding a new element type is a purely
 *    additive change; unknown types are rejected at the boundary rather than
 *    silently rendered.
 */

export const SCENE_SCHEMA_VERSION = 1;
export const PRESENTATION_SCHEMA_VERSION = 1;

/** Stage is 100x100 normalised units, letterboxed into the display aspect. */
export const STAGE_WIDTH = 100;
export const STAGE_HEIGHT = 100;

/** Content should not run to the very edge of a projector's visible area. */
export const SAFE_MARGIN = 6;

/**
 * A URL that is safe to put in an `href` or an iframe `src`.
 *
 * `z.url()` alone is not enough: it happily accepts `javascript:alert(1)`,
 * which would execute when a link on a scene is clicked. Only http and https
 * are ever navigable from stored content.
 */
export const NavigableUrl = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: "Links must be http:// or https://" },
  );

/**
 * A media source. Allows the app's own signed-asset route and blob/data URLs
 * alongside remote https, but never a script-bearing scheme.
 */
export const MediaSource = z
  .string()
  .max(4096)
  .refine(
    (value) => {
      if (value === "") return true;
      if (value.startsWith("/")) return !value.startsWith("//");
      if (value.startsWith("data:image/") || value.startsWith("blob:")) return true;
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: "That media source isn't allowed" },
  );

export const AspectRatio = z.enum(["16:9", "16:10", "4:3"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

export const ASPECT_VALUES: Record<AspectRatio, number> = {
  "16:9": 16 / 9,
  "16:10": 16 / 10,
  "4:3": 4 / 3,
};

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** A rectangle in normalised stage units. */
export const Frame = z.object({
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  w: z.number().min(1).max(200),
  h: z.number().min(1).max(200),
  rotation: z.number().min(-180).max(180).default(0),
});
export type Frame = z.infer<typeof Frame>;

/**
 * Colours are either a token reference resolved against the active theme, or a
 * literal hex value. Token references are preferred so re-theming a deck does
 * not require rewriting every element.
 */
export const ColorValue = z.union([
  z.object({ kind: z.literal("token"), token: z.string().max(48) }),
  z.object({
    kind: z.literal("hex"),
    hex: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
  }),
]);
export type ColorValue = z.infer<typeof ColorValue>;

export const TextAlign = z.enum(["left", "center", "right"]);
export const VerticalAlign = z.enum(["top", "middle", "bottom"]);
export const FontWeight = z.union([
  z.literal(300),
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
  z.literal(800),
]);

export const TextStyle = z.object({
  /** Multiplier against the theme's scale step for this element role. */
  size: z.number().min(0.25).max(6).default(1),
  weight: FontWeight.default(400),
  align: TextAlign.default("left"),
  valign: VerticalAlign.default("top"),
  color: ColorValue.optional(),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  uppercase: z.boolean().default(false),
  lineHeight: z.number().min(0.8).max(2.4).default(1.2),
  letterSpacing: z.number().min(-0.1).max(0.5).default(0),
  /** Overrides the theme font family for this element. */
  family: z.enum(["display", "sans", "mono"]).optional(),
});
export type TextStyle = z.infer<typeof TextStyle>;

/* -------------------------------------------------------------------------- */
/* Animation                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately a small, opinionated set. These read as intentional staging,
 * not as clip-art motion. No spins, bounces, or typewriters.
 */
export const EntranceAnimation = z.enum([
  "none",
  "fade",
  "rise", // fade + translate up
  "settle", // fade + translate down
  "slide-left",
  "slide-right",
  "scale", // fade + subtle scale from 0.94
  "reveal", // clip-path wipe
  "blur", // fade + blur out of focus
]);
export type EntranceAnimation = z.infer<typeof EntranceAnimation>;

export const EmphasisAnimation = z.enum(["none", "pulse", "lift", "glow"]);

export const ElementAnimation = z.object({
  entrance: EntranceAnimation.default("fade"),
  /** Seconds after the scene becomes active. */
  delay: z.number().min(0).max(10).default(0),
  duration: z.number().min(0.05).max(4).default(0.5),
  emphasis: EmphasisAnimation.default("none"),
  /**
   * When true the element waits for an explicit advance (click / arrow key)
   * instead of appearing on a timer. This is how build-ups are authored.
   */
  onAdvance: z.boolean().default(false),
});
export type ElementAnimation = z.infer<typeof ElementAnimation>;

/* -------------------------------------------------------------------------- */
/* Elements                                                                    */
/* -------------------------------------------------------------------------- */

const elementBase = {
  id: z.string().min(1).max(64),
  frame: Frame,
  animation: ElementAnimation.prefault({}),
  /** Hidden elements stay in the document but never render on stage. */
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
};

/** Inline rich-text runs. Deliberately *not* HTML: no sanitisation surface. */
export const TextRun = z.object({
  text: z.string().max(8000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  code: z.boolean().optional(),
  href: NavigableUrl.optional(),
  color: ColorValue.optional(),
});
export type TextRun = z.infer<typeof TextRun>;

export const RichText = z.array(TextRun).max(200);
export type RichText = z.infer<typeof RichText>;

export const HeadingElement = z.object({
  ...elementBase,
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  content: RichText,
  style: TextStyle.prefault({}),
});

export const TextElement = z.object({
  ...elementBase,
  type: z.literal("text"),
  content: RichText,
  style: TextStyle.prefault({}),
});

export const QuoteElement = z.object({
  ...elementBase,
  type: z.literal("quote"),
  content: RichText,
  attribution: z.string().max(240).default(""),
  style: TextStyle.prefault({}),
});

export const ListElement = z.object({
  ...elementBase,
  type: z.literal("list"),
  ordered: z.boolean().default(false),
  items: z.array(RichText).max(24),
  style: TextStyle.prefault({}),
  /** Items appear one at a time on advance rather than all at once. */
  staggered: z.boolean().default(false),
});

export const ImageFit = z.enum(["cover", "contain", "fill"]);

export const ImageElement = z.object({
  ...elementBase,
  type: z.literal("image"),
  assetId: z.string().max(64).nullable().default(null),
  url: MediaSource,
  alt: z.string().max(600).default(""),
  fit: ImageFit.default("cover"),
  /** Normalised focal point used when cropping with `cover`. */
  focalX: z.number().min(0).max(1).default(0.5),
  focalY: z.number().min(0).max(1).default(0.5),
  radius: z.number().min(0).max(50).default(0),
  /** Darkens the image so overlaid text stays readable. */
  scrim: z.number().min(0).max(1).default(0),
});

export const VideoElement = z.object({
  ...elementBase,
  type: z.literal("video"),
  assetId: z.string().max(64).nullable().default(null),
  url: MediaSource,
  poster: MediaSource.default(""),
  autoplay: z.boolean().default(false),
  loop: z.boolean().default(false),
  muted: z.boolean().default(true),
  controls: z.boolean().default(true),
  radius: z.number().min(0).max(50).default(0),
  alt: z.string().max(600).default(""),
});

export const AudioElement = z.object({
  ...elementBase,
  type: z.literal("audio"),
  assetId: z.string().max(64).nullable().default(null),
  url: MediaSource,
  title: z.string().max(240).default(""),
  autoplay: z.boolean().default(false),
});

export const ShapeElement = z.object({
  ...elementBase,
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "ellipse", "triangle", "arrow", "line"]).default("rectangle"),
  fill: ColorValue.nullable().default(null),
  stroke: ColorValue.nullable().default(null),
  strokeWidth: z.number().min(0).max(4).default(0),
  radius: z.number().min(0).max(50).default(0),
});

export const DividerElement = z.object({
  ...elementBase,
  type: z.literal("divider"),
  thickness: z.number().min(0.05).max(3).default(0.25),
  color: ColorValue.nullable().default(null),
});

export const IconElement = z.object({
  ...elementBase,
  type: z.literal("icon"),
  /** Key into the curated icon registry; never an arbitrary import path. */
  name: z.string().max(64),
  color: ColorValue.nullable().default(null),
  strokeWidth: z.number().min(0.5).max(3).default(1.75),
});

export const CalloutElement = z.object({
  ...elementBase,
  type: z.literal("callout"),
  tone: z.enum(["neutral", "accent", "success", "warning", "danger"]).default("accent"),
  icon: z.string().max(64).default("lightbulb"),
  title: z.string().max(240).default(""),
  content: RichText,
  style: TextStyle.prefault({}),
});

export const CodeElement = z.object({
  ...elementBase,
  type: z.literal("code"),
  code: z.string().max(20000),
  language: z.string().max(32).default("text"),
  showLineNumbers: z.boolean().default(false),
  style: TextStyle.prefault({}),
});

export const ChartSeriesPoint = z.object({
  label: z.string().max(120),
  value: z.number(),
});

export const ChartElement = z.object({
  ...elementBase,
  type: z.literal("chart"),
  chart: z.enum(["bar", "column", "line", "donut"]).default("column"),
  title: z.string().max(240).default(""),
  data: z.array(ChartSeriesPoint).max(40),
  showValues: z.boolean().default(true),
  palette: z.enum(["accent", "sequential", "categorical"]).default("accent"),
  /** Screen-reader description; charts are otherwise opaque to AT. */
  summary: z.string().max(1000).default(""),
});

export const EmbedElement = z.object({
  ...elementBase,
  type: z.literal("embed"),
  /** http/https only; the iframe that renders it is also sandboxed. */
  url: NavigableUrl,
  provider: z.enum(["youtube", "vimeo", "loom", "figma", "generic"]).default("generic"),
  title: z.string().max(240).default(""),
  radius: z.number().min(0).max(50).default(0),
});

export const SceneElement = z.discriminatedUnion("type", [
  HeadingElement,
  TextElement,
  QuoteElement,
  ListElement,
  ImageElement,
  VideoElement,
  AudioElement,
  ShapeElement,
  DividerElement,
  IconElement,
  CalloutElement,
  CodeElement,
  ChartElement,
  EmbedElement,
]);
export type SceneElement = z.infer<typeof SceneElement>;
export type SceneElementType = SceneElement["type"];

export const SCENE_ELEMENT_TYPES = [
  "heading",
  "text",
  "quote",
  "list",
  "image",
  "video",
  "audio",
  "shape",
  "divider",
  "icon",
  "callout",
  "code",
  "chart",
  "embed",
] as const satisfies readonly SceneElementType[];

/* -------------------------------------------------------------------------- */
/* Backgrounds                                                                 */
/* -------------------------------------------------------------------------- */

export const SceneBackground = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("theme") }),
  z.object({ kind: z.literal("solid"), color: ColorValue }),
  z.object({
    kind: z.literal("gradient"),
    from: ColorValue,
    to: ColorValue,
    angle: z.number().min(0).max(360).default(160),
  }),
  z.object({
    kind: z.literal("image"),
    url: MediaSource,
    assetId: z.string().max(64).nullable().default(null),
    /** Scrim keeps foreground text legible over photography. */
    scrim: z.number().min(0).max(1).default(0.45),
    focalX: z.number().min(0).max(1).default(0.5),
    focalY: z.number().min(0).max(1).default(0.5),
    alt: z.string().max(600).default(""),
  }),
]);
export type SceneBackground = z.infer<typeof SceneBackground>;

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Named layouts are how the app avoids the "wall of text" failure mode: the
 * generator picks a layout, and the layout owns the geometry. Manual nudging is
 * still allowed, which flips the scene to `custom`.
 */
export const SceneLayout = z.enum([
  "custom",
  "title", // large centred title + optional subtitle
  "section", // section divider / chapter marker
  "statement", // one big idea, nothing else
  "bullets", // heading + list
  "split-left", // media left, text right
  "split-right", // text left, media right
  "media-full", // edge-to-edge media with optional caption
  "quote", // pull quote + attribution
  "two-column", // two text columns
  "three-up", // three cards / points
  "chart", // heading + data
  "code", // heading + code block
  "closing", // wrap-up / thank you
]);
export type SceneLayout = z.infer<typeof SceneLayout>;

/** The validated body of a scene, stored as JSONB on `scenes.content`. */
export const SceneContent = z.object({
  version: z.literal(SCENE_SCHEMA_VERSION).default(SCENE_SCHEMA_VERSION),
  layout: SceneLayout.default("custom"),
  background: SceneBackground.default({ kind: "theme" }),
  elements: z.array(SceneElement).max(60).default([]),
  /** Optional per-scene theme override; falls back to the deck theme. */
  themeOverride: z.string().max(64).nullable().default(null),
});
export type SceneContent = z.infer<typeof SceneContent>;

/* -------------------------------------------------------------------------- */
/* The world                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where a scene sits in the presentation's world.
 *
 * Captivate has no slide reel. A presentation is a single unbounded canvas, and
 * every scene occupies a rectangle somewhere on it; presenting is a camera
 * flying between those rectangles. World units are stage pixels at `scale: 1`,
 * so a scene at scale 1 is `STAGE_BASE_WIDTH` units wide.
 *
 * Because `scale` is unbounded in practice, nesting is free: a scene placed at
 * scale 0.02 inside the bounds of another scene is a detail that lives *within*
 * it, and the camera dives into it. That is the whole trick — no separate
 * "portal" concept is needed, only free placement and a camera.
 *
 * `null` placement means "not placed yet"; the journey arrangement derives one
 * from the scene's position so a deck that has never been touched spatially
 * still presents.
 */
export const ScenePlacement = z.object({
  x: z.number().min(-4_000_000).max(4_000_000),
  y: z.number().min(-4_000_000).max(4_000_000),
  /** 1 = stage-native size. Smaller means the scene is a detail of something. */
  scale: z.number().min(0.001).max(1000).default(1),
  rotation: z.number().min(-180).max(180).default(0),
});
export type ScenePlacement = z.infer<typeof ScenePlacement>;

/** Spatial arrangements the journey map can apply to a whole presentation. */
export const ArrangePreset = z.enum([
  "flow",
  "reel",
  "grid",
  "timeline",
  "spiral",
  "nested",
  "constellation",
]);
export type ArrangePreset = z.infer<typeof ArrangePreset>;

/**
 * How the camera behaves for this presentation.
 *
 * `travel: "cut"` reproduces a conventional slideshow exactly — it is the
 * degenerate case of the same engine, not a separate one.
 */
export const JourneyConfig = z.object({
  /**
   * `flow` rather than `reel` by default.
   *
   * A straight line at one zoom is a slide strip, and a new presentation should
   * not start out looking like one. `flow` fills a page: pulling back shows a
   * composition, not a ribbon. `reel` is one click away for anyone who wants
   * the conventional thing.
   */
  arrangement: ArrangePreset.default("flow"),
  /**
   * How the camera gets from one scene to the next.
   *
   * There is no per-scene transition picker: in a spatial presentation the
   * camera move *is* the transition, and choosing a different wipe for slide 7
   * is the habit this tool exists to break. `cut` and `dissolve` remain for
   * people who genuinely want a still deck.
   */
  travel: z.enum(["fly", "cut", "dissolve"]).default("fly"),
  /** Seconds for a flight of average length; long hops scale up sub-linearly. */
  pace: z.number().min(0.2).max(6).default(1.1),
  /** Pull back to frame a whole section before diving into its first scene. */
  establishSections: z.boolean().default(true),
  /** Draw the route between waypoints when the camera is pulled back. */
  showPath: z.boolean().default(true),
  /**
   * Show the movement rail to the room.
   *
   * A persistent, quiet index of the argument down the edge of the stage, with
   * the current movement lit. It costs a sliver of the frame and buys the
   * audience the one thing slides never give them: knowing where they are.
   */
  showMovements: z.boolean().default(true),
  /**
   * Name the next movement as one ends.
   *
   * Appears only on the last scene of a movement, which is the moment it means
   * anything. It is a signpost, not a spoiler: it says the argument continues.
   */
  signpostNext: z.boolean().default(true),
  /** Backdrop parallax, 0 = flat. */
  depth: z.number().min(0).max(1).default(0.55),
});
export type JourneyConfig = z.infer<typeof JourneyConfig>;

/** The default camera behaviour, resolved once rather than at every call site. */
export const JOURNEY_DEFAULTS: JourneyConfig = JourneyConfig.parse({});

export const Scene = z.object({
  id: z.string().uuid(),
  presentationId: z.string().uuid(),
  sectionId: z.string().uuid().nullable(),
  position: z.number().int().min(0),
  title: z.string().max(240),
  content: SceneContent,
  /** Where this scene sits on the world canvas; null until it is placed. */
  placement: ScenePlacement.nullable().default(null),
  /** Presenter-only. Never rendered to the audience surface. */
  speakerNotes: z.string().max(20000),
  /** Rehearsal target in seconds; drives the presenter pacing indicator. */
  durationSeconds: z.number().int().min(0).max(7200).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Scene = z.infer<typeof Scene>;

/**
 * A movement.
 *
 * Sections are not filing: they are the shape of the argument. `label` is the
 * one-word name for what this part of it *does* — OPEN, FRAME, PRESSURE,
 * DECIDE — and it is shown to the room, so an audience always knows which
 * movement they are in and how many are left. That is the thing a stack of
 * slides can never tell them.
 */
export const Section = z.object({
  id: z.string().uuid(),
  presentationId: z.string().uuid(),
  title: z.string().max(240),
  /** Short movement name. Falls back to the title where it is empty. */
  label: z.string().max(24).default(""),
  position: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Section = z.infer<typeof Section>;

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

export const PresentationRecord = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  title: z.string().max(240),
  description: z.string().max(2000),
  themeId: z.string().max(64),
  themeOverrides: z.record(z.string(), z.unknown()).nullable(),
  aspectRatio: AspectRatio,
  journey: JourneyConfig.prefault({}),
  tags: z.array(z.string().max(48)).max(24),
  isFavorite: z.boolean(),
  thumbnailUrl: z.string().max(4096).nullable(),
  schemaVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().nullable(),
});
export type PresentationRecord = z.infer<typeof PresentationRecord>;

/** Everything the editor and the stage need, in one validated payload. */
export const PresentationDocument = z.object({
  presentation: PresentationRecord,
  sections: z.array(Section),
  scenes: z.array(Scene),
});
export type PresentationDocument = z.infer<typeof PresentationDocument>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse stored scene content, repairing it to an empty scene rather than
 * throwing. A single corrupt scene must never make a whole deck unopenable —
 * the user's other 40 scenes are more important than strictness here.
 */
export function parseSceneContent(raw: unknown): {
  content: SceneContent;
  recovered: boolean;
} {
  const result = SceneContent.safeParse(raw);
  if (result.success) return { content: result.data, recovered: false };

  // Salvage whatever individual elements are still valid.
  const salvaged: SceneElement[] = [];
  if (raw && typeof raw === "object" && Array.isArray((raw as { elements?: unknown }).elements)) {
    for (const candidate of (raw as { elements: unknown[] }).elements) {
      const el = SceneElement.safeParse(candidate);
      if (el.success) salvaged.push(el.data);
    }
  }

  return {
    content: SceneContent.parse({ elements: salvaged }),
    recovered: true,
  };
}

export function emptySceneContent(layout: SceneLayout = "custom"): SceneContent {
  return SceneContent.parse({ layout });
}

/** Stage-unit rect covering the safe area for the given aspect ratio. */
export function safeArea() {
  return {
    x: SAFE_MARGIN,
    y: SAFE_MARGIN,
    w: STAGE_WIDTH - SAFE_MARGIN * 2,
    h: STAGE_HEIGHT - SAFE_MARGIN * 2,
  };
}

/** Total plain-text length of a scene — used to detect wall-of-text scenes. */
export function sceneTextLength(content: SceneContent): number {
  let total = 0;
  for (const el of content.elements) {
    switch (el.type) {
      case "heading":
      case "text":
      case "quote":
        total += el.content.reduce((n, r) => n + r.text.length, 0);
        break;
      case "list":
        total += el.items.reduce((n, item) => n + item.reduce((m, r) => m + r.text.length, 0), 0);
        break;
      case "callout":
        total += el.title.length + el.content.reduce((n, r) => n + r.text.length, 0);
        break;
      case "code":
        total += Math.min(el.code.length, 400);
        break;
      default:
        break;
    }
  }
  return total;
}

/** Plain text of a rich-text array. */
export function plainText(rt: RichText): string {
  return rt.map((r) => r.text).join("");
}

/** Build a single-run rich text value. */
export function richText(text: string): RichText {
  return [{ text }];
}
