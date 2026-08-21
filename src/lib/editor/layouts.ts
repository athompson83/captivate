import {
  SAFE_MARGIN,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  richText,
  type Frame,
  type RichText,
  type SceneContent,
  type SceneElement,
  type SceneLayout,
} from "@/lib/schema/presentation";

/**
 * Named layouts.
 *
 * The layout owns geometry so that neither a person dragging boxes nor the AI
 * generator has to invent coordinates. This is the main defence against the
 * dense, badly-spaced scenes that generated decks usually produce: content is
 * poured into a composition that was designed once, properly.
 *
 * A layout produces *frames*; the caller supplies the content. Manual nudging
 * afterwards flips the scene to `custom` and the layout stops re-applying.
 */

const M = SAFE_MARGIN;
const W = STAGE_WIDTH - M * 2;

export interface LayoutSlots {
  eyebrow?: Frame;
  heading?: Frame;
  subheading?: Frame;
  body?: Frame;
  bodyB?: Frame;
  media?: Frame;
  caption?: Frame;
  attribution?: Frame;
  cards?: Frame[];
}

const frame = (x: number, y: number, w: number, h: number): Frame => ({
  x,
  y,
  w,
  h,
  rotation: 0,
});

export function layoutSlots(layout: SceneLayout): LayoutSlots {
  switch (layout) {
    case "title":
      return {
        eyebrow: frame(M, 34, W, 5),
        heading: frame(M, 40, W * 0.86, 22),
        subheading: frame(M, 64, W * 0.66, 12),
      };

    case "section":
      return {
        eyebrow: frame(M, 40, W, 5),
        heading: frame(M, 46, W * 0.8, 16),
      };

    case "statement":
      // One idea, centred, with generous air. Nothing else belongs here.
      return { heading: frame(M + W * 0.06, 30, W * 0.88, 40) };

    case "bullets":
      return {
        heading: frame(M, M + 4, W, 12),
        body: frame(M, 32, W * 0.82, STAGE_HEIGHT - 32 - M),
      };

    case "split-left":
      return {
        media: frame(0, 0, 50, STAGE_HEIGHT),
        heading: frame(50 + M, 26, 50 - M * 2, 14),
        body: frame(50 + M, 42, 50 - M * 2, 34),
      };

    case "split-right":
      return {
        heading: frame(M, 26, 50 - M * 2, 14),
        body: frame(M, 42, 50 - M * 2, 34),
        media: frame(50, 0, 50, STAGE_HEIGHT),
      };

    case "media-full":
      return {
        media: frame(0, 0, STAGE_WIDTH, STAGE_HEIGHT),
        heading: frame(M, 62, W * 0.75, 16),
        caption: frame(M, 80, W * 0.6, 8),
      };

    case "quote":
      return {
        heading: frame(M + W * 0.08, 26, W * 0.84, 38),
        attribution: frame(M + W * 0.08, 68, W * 0.5, 8),
      };

    case "two-column":
      return {
        heading: frame(M, M + 4, W, 12),
        body: frame(M, 32, W / 2 - 3, STAGE_HEIGHT - 32 - M),
        bodyB: frame(M + W / 2 + 3, 32, W / 2 - 3, STAGE_HEIGHT - 32 - M),
      };

    case "three-up": {
      const gap = 4;
      const cardW = (W - gap * 2) / 3;
      return {
        heading: frame(M, M + 4, W, 12),
        cards: [0, 1, 2].map((i) => frame(M + i * (cardW + gap), 34, cardW, 46)),
      };
    }

    case "chart":
      return {
        heading: frame(M, M + 4, W, 11),
        media: frame(M, 30, W, 54),
        caption: frame(M, 86, W, 6),
      };

    case "code":
      return {
        heading: frame(M, M + 3, W, 10),
        body: frame(M, 26, W, STAGE_HEIGHT - 26 - M),
      };

    case "closing":
      return {
        heading: frame(M, 38, W * 0.8, 18),
        subheading: frame(M, 60, W * 0.6, 12),
      };

    default:
      return {
        heading: frame(M, M + 4, W, 14),
        body: frame(M, 30, W, STAGE_HEIGHT - 30 - M),
      };
  }
}

/** Layouts whose composition centres content rather than left-aligning it. */
const CENTRED: SceneLayout[] = ["statement", "quote", "closing"];

let idCounter = 0;
/** Stable-ish element ids. Prefixed so they are recognisable in stored JSON. */
export function elementId(prefix = "el"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}${Date.now().toString(36).slice(-4)}`;
}

export interface LayoutContent {
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  body?: string;
  bullets?: string[];
  bulletsB?: string[];
  quote?: string;
  attribution?: string;
  caption?: string;
  code?: { code: string; language: string };
  media?: { url: string; alt: string; assetId?: string | null };
  cards?: { title: string; body: string; icon?: string }[];
  chart?: {
    chart: "bar" | "column" | "line" | "donut";
    data: { label: string; value: number }[];
    summary?: string;
  };
}

/**
 * Compose a full scene from a layout plus content. Everything the generator and
 * the "change layout" control produce goes through here, so composition quality
 * is consistent regardless of origin.
 */
export function composeScene(layout: SceneLayout, content: LayoutContent): SceneContent {
  const slots = layoutSlots(layout);
  const centred = CENTRED.includes(layout);
  const align = centred ? "center" : "left";
  const elements: SceneElement[] = [];
  let delay = 0;
  const step = 0.09;

  const nextDelay = () => {
    const d = delay;
    delay += step;
    return d;
  };

  const heroFont = layout === "code" ? "sans" : "display";

  if (content.eyebrow && slots.eyebrow) {
    elements.push({
      id: elementId("eyebrow"),
      type: "text",
      frame: slots.eyebrow,
      content: richText(content.eyebrow),
      hidden: false,
      locked: false,
      opacity: 1,
      animation: {
        entrance: "fade",
        delay: nextDelay(),
        duration: 0.45,
        emphasis: "none",
        onAdvance: false,
      },
      style: {
        size: 0.62,
        weight: 600,
        align,
        valign: "middle",
        italic: false,
        underline: false,
        uppercase: true,
        lineHeight: 1.2,
        letterSpacing: 0.16,
        family: "sans",
        color: { kind: "token", token: "accent" },
      },
    });
  }

  if (content.media && slots.media) {
    const isBackdrop = layout === "media-full";
    elements.push({
      id: elementId("media"),
      type: "image",
      frame: slots.media,
      assetId: content.media.assetId ?? null,
      url: content.media.url,
      alt: content.media.alt,
      fit: "cover",
      focalX: 0.5,
      focalY: 0.5,
      radius: layout === "split-left" || layout === "split-right" || isBackdrop ? 0 : 1.5,
      // A full-bleed image behind text always gets a scrim; otherwise the
      // heading becomes unreadable over a busy photo.
      scrim: isBackdrop ? 0.55 : 0,
      hidden: false,
      locked: false,
      opacity: 1,
      animation: {
        entrance: isBackdrop ? "fade" : "scale",
        delay: 0,
        duration: 0.7,
        emphasis: "none",
        onAdvance: false,
      },
    });
  }

  // Heading and quote are the same slot wearing different clothes. Falling back
  // between them is what lets a scene switch to (and away from) the quote
  // layout without silently dropping its text.
  const headingText =
    layout === "quote" ? (content.quote ?? content.heading) : (content.heading ?? content.quote);
  if (headingText && slots.heading) {
    const isQuote = layout === "quote";
    const big = layout === "title" || layout === "statement" || isQuote;
    elements.push(
      isQuote
        ? {
            id: elementId("quote"),
            type: "quote",
            frame: slots.heading,
            content: richText(headingText),
            attribution: content.attribution ?? "",
            hidden: false,
            locked: false,
            opacity: 1,
            animation: {
              entrance: "rise",
              delay: nextDelay(),
              duration: 0.6,
              emphasis: "none",
              onAdvance: false,
            },
            style: {
              size: 1.35,
              weight: 400,
              align,
              valign: "middle",
              italic: false,
              underline: false,
              uppercase: false,
              lineHeight: 1.24,
              letterSpacing: -0.01,
              family: "display",
            },
          }
        : {
            id: elementId("heading"),
            type: "heading",
            level:
              layout === "bullets" ||
              layout === "chart" ||
              layout === "code" ||
              layout === "two-column" ||
              layout === "three-up"
                ? 2
                : 1,
            frame: slots.heading,
            content: richText(headingText),
            hidden: false,
            locked: false,
            opacity: 1,
            animation: {
              entrance: "rise",
              delay: nextDelay(),
              duration: 0.55,
              emphasis: "none",
              onAdvance: false,
            },
            style: {
              size: big ? 1 : 0.62,
              weight: 600,
              align,
              valign: big ? "middle" : "top",
              italic: false,
              underline: false,
              uppercase: false,
              lineHeight: 1.08,
              letterSpacing: -0.02,
              family: heroFont,
              color: layout === "media-full" ? { kind: "hex", hex: "#FFFFFF" } : undefined,
            },
          },
    );
  }

  if (content.attribution && slots.attribution && layout !== "quote") {
    elements.push(
      textElement(content.attribution, slots.attribution, align, nextDelay(), {
        size: 0.42,
        muted: true,
      }),
    );
  }

  if (content.subheading && slots.subheading) {
    elements.push(
      textElement(content.subheading, slots.subheading, align, nextDelay(), {
        size: 0.56,
        muted: true,
        lineHeight: 1.45,
      }),
    );
  }

  if (content.caption && slots.caption) {
    elements.push(
      textElement(content.caption, slots.caption, align, nextDelay(), {
        size: 0.4,
        muted: true,
        white: layout === "media-full",
      }),
    );
  }

  if (content.bullets?.length && slots.body) {
    elements.push(listElement(content.bullets, slots.body, align, nextDelay()));
  } else if (content.body && slots.body && layout !== "code") {
    elements.push(
      textElement(content.body, slots.body, align, nextDelay(), {
        size: 0.58,
        lineHeight: 1.5,
        muted: layout !== "statement",
      }),
    );
  }

  if (content.bulletsB?.length && slots.bodyB) {
    elements.push(listElement(content.bulletsB, slots.bodyB, align, nextDelay()));
  }

  if (content.code && slots.body && layout === "code") {
    elements.push({
      id: elementId("code"),
      type: "code",
      frame: slots.body,
      code: content.code.code,
      language: content.code.language,
      showLineNumbers: content.code.code.split("\n").length > 6,
      hidden: false,
      locked: false,
      opacity: 1,
      animation: {
        entrance: "fade",
        delay: nextDelay(),
        duration: 0.5,
        emphasis: "none",
        onAdvance: false,
      },
      style: {
        size: 0.42,
        weight: 400,
        align: "left",
        valign: "top",
        italic: false,
        underline: false,
        uppercase: false,
        lineHeight: 1.6,
        letterSpacing: 0,
        family: "mono",
      },
    });
  }

  if (content.chart && slots.media && layout === "chart") {
    elements.push({
      id: elementId("chart"),
      type: "chart",
      frame: slots.media,
      chart: content.chart.chart,
      title: "",
      data: content.chart.data,
      showValues: true,
      palette: "accent",
      summary: content.chart.summary ?? "",
      hidden: false,
      locked: false,
      opacity: 1,
      animation: {
        entrance: "rise",
        delay: nextDelay(),
        duration: 0.7,
        emphasis: "none",
        onAdvance: false,
      },
    });
  }

  if (content.cards?.length && slots.cards) {
    content.cards.slice(0, slots.cards.length).forEach((card, i) => {
      elements.push({
        id: elementId("card"),
        type: "callout",
        frame: slots.cards![i],
        tone: "neutral",
        icon: card.icon ?? "circle",
        title: card.title,
        content: richText(card.body),
        hidden: false,
        locked: false,
        opacity: 1,
        animation: {
          entrance: "rise",
          delay: nextDelay(),
          duration: 0.5,
          emphasis: "none",
          onAdvance: false,
        },
        style: {
          size: 0.44,
          weight: 400,
          align: "left",
          valign: "top",
          italic: false,
          underline: false,
          uppercase: false,
          lineHeight: 1.5,
          letterSpacing: 0,
          family: "sans",
        },
      });
    });
  }

  const background: SceneContent["background"] =
    layout === "media-full" && content.media
      ? { kind: "theme" } // the media element itself is the backdrop
      : { kind: "theme" };

  return {
    version: 1,
    layout,
    background,
    elements,
    transition: { type: "fade", duration: 0.6, direction: "left" },
    themeOverride: null,
  };
}

function textElement(
  text: string,
  frame: Frame,
  align: "left" | "center" | "right",
  delay: number,
  opts: { size?: number; muted?: boolean; lineHeight?: number; white?: boolean } = {},
): SceneElement {
  return {
    id: elementId("text"),
    type: "text",
    frame,
    content: richText(text),
    hidden: false,
    locked: false,
    opacity: 1,
    animation: { entrance: "rise", delay, duration: 0.5, emphasis: "none", onAdvance: false },
    style: {
      size: opts.size ?? 0.55,
      weight: 400,
      align,
      valign: "top",
      italic: false,
      underline: false,
      uppercase: false,
      lineHeight: opts.lineHeight ?? 1.45,
      letterSpacing: 0,
      family: "sans",
      color: opts.white
        ? { kind: "hex", hex: "#FFFFFF" }
        : opts.muted
          ? { kind: "token", token: "inkMuted" }
          : undefined,
    },
  };
}

function listElement(
  items: string[],
  frame: Frame,
  align: "left" | "center" | "right",
  delay: number,
): SceneElement {
  return {
    id: elementId("list"),
    type: "list",
    frame,
    ordered: false,
    items: items.map((i) => richText(i)),
    // Staggered reveal keeps the room with the speaker instead of reading ahead.
    staggered: items.length > 2,
    hidden: false,
    locked: false,
    opacity: 1,
    animation: { entrance: "rise", delay, duration: 0.5, emphasis: "none", onAdvance: false },
    style: {
      size: 0.56,
      weight: 400,
      align,
      valign: "top",
      italic: false,
      underline: false,
      uppercase: false,
      lineHeight: 1.5,
      letterSpacing: 0,
      family: "sans",
    },
  };
}

/**
 * Re-flow an existing scene into a different layout, preserving its content.
 * Used by the editor's layout picker, so switching layout never loses text.
 */
export function relayoutScene(content: SceneContent, layout: SceneLayout): SceneContent {
  const extracted = extractContent(content);
  const next = composeScene(layout, extracted);
  return {
    ...next,
    background: content.background,
    transition: content.transition,
    themeOverride: content.themeOverride,
  };
}

/** Pull structured content back out of a composed scene. */
export function extractContent(content: SceneContent): LayoutContent {
  const out: LayoutContent = {};
  const texts: string[] = [];

  for (const el of content.elements) {
    switch (el.type) {
      case "heading":
        out.heading ??= el.content.map((r) => r.text).join("");
        break;
      case "quote":
        out.quote ??= el.content.map((r) => r.text).join("");
        out.attribution ??= el.attribution;
        break;
      case "list": {
        const items = el.items.map((i) => i.map((r) => r.text).join(""));
        if (!out.bullets) out.bullets = items;
        else out.bulletsB ??= items;
        break;
      }
      case "text": {
        const t = el.content.map((r) => r.text).join("");
        if (el.style.uppercase && !out.eyebrow) out.eyebrow = t;
        else texts.push(t);
        break;
      }
      case "image":
        out.media ??= { url: el.url, alt: el.alt, assetId: el.assetId };
        break;
      case "code":
        out.code ??= { code: el.code, language: el.language };
        break;
      case "chart":
        out.chart ??= { chart: el.chart, data: el.data, summary: el.summary };
        break;
      case "callout":
        (out.cards ??= []).push({
          title: el.title,
          body: el.content.map((r) => r.text).join(""),
          icon: el.icon,
        });
        break;
      default:
        break;
    }
  }

  if (texts.length) {
    out.subheading ??= texts[0];
    if (texts.length > 1) out.body ??= texts.slice(1).join("\n\n");
  }
  return out;
}

export function plainOf(rt: RichText): string {
  return rt.map((r) => r.text).join("");
}

export const ALL_LAYOUTS: { value: SceneLayout; label: string; hint: string }[] = [
  { value: "title", label: "Title", hint: "Opening slide" },
  { value: "section", label: "Section", hint: "Chapter marker" },
  { value: "statement", label: "Statement", hint: "One big idea" },
  { value: "bullets", label: "Points", hint: "Heading and list" },
  { value: "split-left", label: "Media left", hint: "Image beside text" },
  { value: "split-right", label: "Media right", hint: "Text beside image" },
  { value: "media-full", label: "Full bleed", hint: "Edge-to-edge image" },
  { value: "quote", label: "Quote", hint: "Pull quote" },
  { value: "two-column", label: "Two columns", hint: "Compare or contrast" },
  { value: "three-up", label: "Three up", hint: "Three key points" },
  { value: "chart", label: "Data", hint: "Chart with heading" },
  { value: "code", label: "Code", hint: "Monospaced block" },
  { value: "closing", label: "Closing", hint: "Wrap up" },
  { value: "custom", label: "Free-form", hint: "Position everything yourself" },
];
