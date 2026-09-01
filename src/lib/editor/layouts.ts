import {
  SAFE_MARGIN,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  richText,
  richTextAccent,
  splitAccent,
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

    // The cover shares the title's slots on purpose: the veil (a full-bleed
    // image and a display title, composed separately) lifts on the first
    // advance to reveal what is, by construction, a title slide.
    case "cover":
      return {
        eyebrow: frame(M, 34, W, 5),
        heading: frame(M, 40, W * 0.86, 22),
        subheading: frame(M, 64, W * 0.66, 12),
        media: frame(0, 0, STAGE_WIDTH, STAGE_HEIGHT),
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
      // A body slot, because a closing scene almost always lists what to take
      // away — and without one every bullet handed to this layout was
      // discarded in silence. Five of the shipped templates do exactly that.
      //
      // The body is centred as a *block* rather than as text: a bulleted list
      // with centred lines leaves its markers stranded at the left margin,
      // which reads as a rendering fault rather than as a choice.
      return {
        heading: frame(M, 26, W * 0.8, 16),
        body: frame((100 - W * 0.56) / 2, 46, W * 0.56, 34),
        subheading: frame(M, 82, W * 0.6, 10),
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
  /**
   * The scene's name, used as a heading only when there is none.
   *
   * It is never drawn in its own right — it labels the scene in the navigator
   * — so a generator that writes the line here and nowhere else has written a
   * scene the audience cannot see. Nine of the ten blank scenes in a
   * production deck were exactly that: `statement` layouts whose title was the
   * statement ("Feedback two weeks late helps no one") and whose heading was
   * empty.
   */
  title?: string;
  /** A closing clause of the heading, carried in the theme's accent colour. */
  headingAccent?: string;
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

/** Every field of `LayoutContent` that carries words a reader would miss. */
function hasWords(content: LayoutContent): boolean {
  return Boolean(
    content.heading?.trim() ||
    content.quote?.trim() ||
    content.subheading?.trim() ||
    content.body?.trim() ||
    content.eyebrow?.trim() ||
    content.caption?.trim() ||
    content.attribution?.trim() ||
    content.title?.trim() ||
    content.chart?.data.length ||
    content.bullets?.length ||
    content.bulletsB?.length ||
    content.cards?.length ||
    content.code?.code.trim(),
  );
}

/**
 * Draws a three-up's cards from its bullets.
 *
 * A sequence written as a list is the same sequence; cards are how this layout
 * draws one. Always, rather than only when the scene would otherwise be empty:
 * a three-up with a heading and three bullets is not blank, it is a heading
 * with its three points silently missing.
 */
function withCards(layout: SceneLayout, content: LayoutContent): LayoutContent {
  if (layout !== "three-up" || content.cards?.length || !content.bullets?.length) return content;
  return {
    ...content,
    cards: content.bullets.slice(0, 3).map((bullet) => ({ title: "", body: bullet })),
    bullets: undefined,
  };
}

/**
 * Gives a layout a heading out of whatever else it was handed.
 *
 * A layout renders the fields it has slots for and drops the rest, and mostly
 * that is the point: a statement scene is one idea with air around it and
 * "nothing else belongs here". But the generator does not choose the layout —
 * `layoutFor` does, from the moment's visual intent — so the model can write a
 * perfectly good statement into `title` or `body` and have every word of it
 * discarded. Ten of the twenty-one scenes in a deck exported from production
 * were blank for exactly this, and the editor showed the author "This scene is
 * empty" over content the model had written.
 *
 * Only ever reached when the layout has already rendered *nothing*, which is
 * what makes it safe to leave the source field alone: if any of these fields
 * had a slot, the composition would not have been empty and we would not be
 * here. Promoting eagerly is how the same prose ends up printed twice, once as
 * a heading and again in the slot it was already going to fill.
 */
function withHeading(slots: LayoutSlots, content: LayoutContent): LayoutContent {
  if (!slots.heading || content.heading?.trim() || content.quote?.trim()) return content;

  const promoted =
    // The title first: it is the one field written to be a name for the scene,
    // so it is the most heading-shaped thing available.
    content.title?.trim() ||
    content.body?.trim() ||
    content.subheading?.trim() ||
    content.bullets?.[0]?.trim() ||
    content.cards?.[0]?.title?.trim() ||
    content.caption?.trim() ||
    content.eyebrow?.trim() ||
    content.attribution?.trim();

  return promoted ? { ...content, heading: promoted } : content;
}

/** The elements a layout draws from this content, and nothing else. */
function build(layout: SceneLayout, slots: LayoutSlots, content: LayoutContent): SceneElement[] {
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
      hotspot: null,
      animation: {
        entrance: "fade",
        delay: nextDelay(),
        duration: 0.45,
        emphasis: "none",
        onAdvance: false,
        exit: "none",
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
      hotspot: null,
      animation: {
        entrance: isBackdrop ? "fade" : "scale",
        delay: 0,
        duration: 0.7,
        emphasis: "none",
        onAdvance: false,
        exit: "none",
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
            hotspot: null,
            animation: {
              entrance: "rise",
              delay: nextDelay(),
              duration: 0.6,
              emphasis: "none",
              onAdvance: false,
              exit: "none",
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
            content: content.headingAccent
              ? richTextAccent(headingText, content.headingAccent)
              : richText(headingText),
            hidden: false,
            locked: false,
            opacity: 1,
            hotspot: null,
            animation: {
              entrance: "rise",
              delay: nextDelay(),
              duration: 0.55,
              emphasis: "none",
              onAdvance: false,
              exit: "none",
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
    // Always left, even on a centred layout: see the closing slots above.
    elements.push(listElement(content.bullets, slots.body, "left", nextDelay()));
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
    elements.push(listElement(content.bulletsB, slots.bodyB, "left", nextDelay()));
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
      hotspot: null,
      animation: {
        entrance: "fade",
        delay: nextDelay(),
        duration: 0.5,
        emphasis: "none",
        onAdvance: false,
        exit: "none",
      },
      style: {
        // 0.6, up from 0.42. Code on a slide is read by a room, not by the
        // person who wrote it.
        size: 0.6,
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
      hotspot: null,
      animation: {
        entrance: "rise",
        delay: nextDelay(),
        duration: 0.7,
        emphasis: "none",
        onAdvance: false,
        exit: "none",
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
        hotspot: null,
        animation: {
          entrance: "rise",
          delay: nextDelay(),
          duration: 0.5,
          emphasis: "none",
          onAdvance: false,
          exit: "none",
        },
        style: {
          // 0.66, up from 0.44. A card column is a quarter of the stage
          // wide, which is room enough for body text; at 0.44 the three cards
          // read as grey texture rather than as three points. The callout now
          // fits its own body, so a longer one shrinks rather than clipping.
          size: 0.66,
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

  return elements;
}

/**
 * Compose a full scene from a layout plus content. Everything the generator and
 * the "change layout" control produce goes through here, so composition quality
 * is consistent regardless of origin.
 *
 * Composed, then rescued — in that order, and the order is the point. The
 * layout draws what it draws; only when that comes to *nothing* does the
 * composition reach for a heading it was not given, and only then does it fall
 * back to a different layout. Rescuing first would print the same prose twice
 * on every layout that had a slot for it all along.
 */
export function composeScene(layout: SceneLayout, given: LayoutContent): SceneContent {
  if (layout === "cover") return composeCover(given);
  const slots = layoutSlots(layout);

  // Cards, always: a three-up with a heading and three bullets is not blank,
  // it is a heading with its three points silently missing.
  const content = withCards(layout, given);
  const drawn = build(layout, slots, content);
  if (drawn.length) return scene(layout, drawn);

  const promoted = withHeading(slots, content);
  if (promoted !== content) {
    const rescued = build(layout, slots, promoted);
    if (rescued.length) return scene(layout, rescued);
  }

  // The last resort, and the one that makes "an empty scene" mean the author
  // wrote nothing rather than that the composition lost it. Code and a chart
  // are drawn by exactly one layout each; everything else with words in it
  // survives on `bullets`, which holds a heading, prose and a list. The scene
  // really does become that layout: reporting `statement` over bullets
  // geometry would blank it again the next time a layout was applied.
  if (hasWords(given)) {
    if (given.code?.code.trim() && layout !== "code") return composeScene("code", given);
    if (given.chart?.data.length && layout !== "chart") return composeScene("chart", given);
    if (layout !== "bullets") return composeScene("bullets", given);
  }

  return scene(layout, drawn);
}

/** The composed scene around a set of elements. */
function scene(layout: SceneLayout, elements: SceneElement[]): SceneContent {
  return {
    version: 1,
    layout,
    background: { kind: "theme" },
    elements,
    themeOverride: null,
  };
}

/**
 * The cover: a title slide with a veil over it.
 *
 * Beneath is a real title composition — entrances stripped, because those
 * elements are simply *there* when the veil lifts rather than arriving. Over
 * it, when there is an image, sit two `veil_`-prefixed elements: the full-bleed
 * photograph and the display title, both dismissed by the first advance (see
 * `ExitAnimation`). The prefix is the contract `settleCover` strips by when a
 * generated cover's image never got filled — a cover without a picture must
 * degrade to a title slide, never to a full-screen placeholder.
 */
function composeCover(content: LayoutContent): SceneContent {
  const base = composeScene("title", { ...content, media: undefined });
  const beneath = base.elements.map((el) => ({
    ...el,
    animation: { ...el.animation, entrance: "none" as const, delay: 0 },
  }));
  if (!content.media) return { ...base, layout: "cover" as const, elements: beneath };

  const veil: SceneElement[] = [
    {
      id: elementId("veil"),
      type: "image",
      frame: frame(0, 0, STAGE_WIDTH, STAGE_HEIGHT),
      assetId: content.media.assetId ?? null,
      url: content.media.url,
      alt: content.media.alt,
      fit: "cover",
      focalX: 0.5,
      focalY: 0.5,
      radius: 0,
      scrim: 0.45,
      hidden: false,
      locked: false,
      opacity: 1,
      hotspot: null,
      animation: {
        entrance: "fade",
        delay: 0,
        duration: 0.9,
        emphasis: "none",
        onAdvance: false,
        exit: "zoom",
      },
    },
  ];

  if (content.heading) {
    veil.push({
      id: elementId("veil"),
      type: "heading",
      level: 1,
      frame: frame(M, 50, W * 0.84, 32),
      content: content.headingAccent
        ? richTextAccent(content.heading, content.headingAccent)
        : richText(content.heading),
      hidden: false,
      locked: false,
      opacity: 1,
      hotspot: null,
      animation: {
        entrance: "rise",
        delay: 0.2,
        duration: 0.7,
        emphasis: "none",
        onAdvance: false,
        exit: "fade",
      },
      style: {
        size: 1.2,
        weight: 600,
        align: "left",
        valign: "bottom",
        italic: false,
        underline: false,
        uppercase: false,
        lineHeight: 1.05,
        letterSpacing: -0.02,
        family: "display",
        // Always over the scrimmed photograph, so always white regardless of
        // theme — the beneath heading carries the theme's own ink.
        color: { kind: "hex", hex: "#FFFFFF" },
      },
    });
  }

  return { ...base, layout: "cover" as const, elements: [...beneath, ...veil] };
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
    hotspot: null,
    animation: {
      entrance: "rise",
      delay,
      duration: 0.5,
      emphasis: "none",
      onAdvance: false,
      exit: "none",
    },
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
    hotspot: null,
    animation: {
      entrance: "rise",
      delay,
      duration: 0.5,
      emphasis: "none",
      onAdvance: false,
      exit: "none",
    },
    style: {
      /**
       * Near the theme's own body scale, not half of it.
       *
       * 0.92, up from 0.56. The scale exists so body text reads from the back
       * of a room; composing a list at just over half of it produced bullets
       * around twenty pixels on a 1600-pixel stage — unreadable on a
       * projector, and stranded in the top third of a frame that runs to the
       * bottom of the scene. Growing them is safe because `fitTextSize` only
       * ever shrinks: a list too long for its box still gets pulled back, and
       * a short one now fills the space it was given.
       */
      size: 0.92,
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
/**
 * A cover whose picture never arrived is a title slide.
 *
 * Composing a cover always lays down a veil — a full-bleed image over the
 * title — because generation fills that slot from a stock search *after* the
 * scene exists. Until it does, the veil is an empty placeholder with the
 * deck's title drawn on it, over the same title drawn beneath: one scene, two
 * copies of its heading, and a grey rectangle across the whole stage.
 *
 * So the veil is stripped wherever a picture is not going to arrive. The
 * generation pass calls this once its sourcing has finished; `relayoutScene`
 * calls it because the editor's "change layout" control has no sourcing pass
 * at all, and a cover chosen for a scene with no image is a title slide the
 * moment it is chosen.
 */
export function settleCover(content: SceneContent): SceneContent {
  if (content.layout !== "cover") return content;
  const unfilled = content.elements.some(
    (element) =>
      element.type === "image" &&
      element.id.startsWith("veil_") &&
      !element.url &&
      !element.assetId,
  );
  if (!unfilled) return content;
  return {
    ...content,
    elements: content.elements.filter((element) => !element.id.startsWith("veil_")),
  };
}

export function relayoutScene(content: SceneContent, layout: SceneLayout): SceneContent {
  const extracted = extractContent(content);
  const next = composeScene(layout, extracted);
  return settleCover({
    ...next,
    background: content.background,
    themeOverride: content.themeOverride,
  });
}

/** Pull structured content back out of a composed scene. */
export function extractContent(content: SceneContent): LayoutContent {
  const out: LayoutContent = {};
  const texts: string[] = [];

  for (const el of content.elements) {
    switch (el.type) {
      case "heading": {
        // Split so a re-layout keeps the emphasis rather than flattening the
        // claim back into one colour.
        const { text, accent } = splitAccent(el.content);
        out.heading ??= text;
        if (accent) out.headingAccent ??= accent;
        break;
      }
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
  { value: "cover", label: "Cover", hint: "Full-screen image that lifts on the first advance" },
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
