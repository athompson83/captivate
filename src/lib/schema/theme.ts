import { z } from "zod";

/**
 * A theme is a *token set*, not a stylesheet. Scenes reference tokens
 * (`{ kind: "token", token: "ink" }`), so re-theming a deck never rewrites
 * element content — it just resolves the same tokens differently.
 */

/**
 * Every ground a stage can be given, named once.
 *
 * A list rather than an inline enum because the switch in `stageBackgroundCss`
 * has to cover it and nothing makes that true — its default arm returns the
 * canvas colour, which is correct for `flat` and silent for a style added here
 * and forgotten there. The theme suite walks this list and asserts each one
 * paints something of its own.
 */
export const BACKGROUND_STYLES = ["flat", "gradient", "vignette", "bloom", "mesh"] as const;
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];

export const ThemeFonts = z.object({
  display: z.string().max(120),
  sans: z.string().max(120),
  mono: z.string().max(120),
});

export const ThemeTokens = z.object({
  /** Stage background. */
  canvas: z.string(),
  /** Secondary surface used by callouts, cards, code blocks. */
  surface: z.string(),
  /** Primary text on `canvas`. */
  ink: z.string(),
  /** Muted / supporting text. */
  inkMuted: z.string(),
  /** Brand / emphasis colour. */
  accent: z.string(),
  /** Text placed on top of `accent`. */
  onAccent: z.string(),
  /** Hairlines, dividers, chart gridlines. */
  line: z.string(),
});
export type ThemeTokens = z.infer<typeof ThemeTokens>;

export const ThemeScale = z.object({
  /** rem-equivalent sizes at a 1920px-wide stage; scaled by the renderer. */
  h1: z.number(),
  h2: z.number(),
  h3: z.number(),
  body: z.number(),
  caption: z.number(),
});

export const PresentationTheme = z.object({
  id: z.string().max(64),
  name: z.string().max(120),
  description: z.string().max(400),
  /** Drives the default UI chrome shown while editing this deck. */
  mode: z.enum(["light", "dark"]),
  tokens: ThemeTokens,
  fonts: ThemeFonts,
  scale: ThemeScale,
  /**
   * Default background applied to new scenes, and the world's own ground.
   *
   * `flat`, `gradient` and `vignette` are one colour, two stops and a centre
   * light. `bloom` and `mesh` are the two that have depth: several offset
   * washes composed from the theme's own tokens, so a stage has somewhere to
   * be rather than a colour behind it. See `stageBackgroundCss`.
   */
  backgroundStyle: z.enum(BACKGROUND_STYLES).default("flat"),
  /** The far end of a two-stop gradient, and the second light in the others. */
  gradientTo: z.string().optional(),
});
export type PresentationTheme = z.infer<typeof PresentationTheme>;

const scale = { h1: 5.4, h2: 3.4, h3: 2.2, body: 1.6, caption: 1.1 };

/**
 * Sixteen themes, each with a genuinely different point of view. Still curated
 * rather than exhaustive — an educator should be able to pick one in five
 * seconds, so the bar for a new one is that it does a job none of the others
 * does, not that it is another nice palette. Eight dark and eight light,
 * because the room decides that and the author does not always get to choose
 * the room.
 *
 * The first twelve are chosen by *room*: a dim lecture hall · an editorial
 * read · dense technical teaching · a keynote · storytelling · a workshop ·
 * engineering and systems · creative and product work · low vision and bad
 * projectors · a bright room with the lights on · the humanities · the life
 * sciences.
 *
 * The last four are chosen by *ground*, which is an axis the first twelve
 * do not have: every one of them is lit by a single light — one colour, one
 * two-stop gradient, or one centre vignette — and a stage lit by one light
 * reads as a page. These four use `bloom` and `mesh`, so the ground has a near
 * side and a far side. Two dark and two light, because that is still the
 * question the room asks first.
 */
export const THEMES: PresentationTheme[] = [
  {
    id: "midnight",
    name: "Midnight",
    description: "Dark stage, warm spotlight. Reads beautifully in a dim lecture hall.",
    mode: "dark",
    tokens: {
      canvas: "#0F1117",
      surface: "#191C26",
      ink: "#F5F6F8",
      inkMuted: "#9AA0AE",
      accent: "#F0B858",
      onAccent: "#1A1408",
      line: "#2A2E3A",
    },
    fonts: { display: "var(--font-display)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale,
    backgroundStyle: "vignette",
  },
  {
    id: "paper",
    name: "Paper",
    description: "Editorial and calm. High-contrast serif headings on warm white.",
    mode: "light",
    tokens: {
      canvas: "#FBF9F5",
      surface: "#F1EDE4",
      ink: "#1B1917",
      inkMuted: "#6B655D",
      accent: "#B4451F",
      onAccent: "#FFF8F4",
      line: "#DED8CC",
    },
    fonts: { display: "var(--font-display)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale,
    backgroundStyle: "flat",
  },
  {
    id: "clinical",
    name: "Clinical",
    description: "Clear, neutral and legible. Built for dense technical teaching.",
    mode: "light",
    tokens: {
      canvas: "#FFFFFF",
      surface: "#F2F5F9",
      ink: "#0E1726",
      inkMuted: "#5C6B82",
      accent: "#0F6FCB",
      onAccent: "#FFFFFF",
      line: "#DCE3ED",
    },
    fonts: { display: "var(--font-inter)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale: { ...scale, h1: 4.8, body: 1.7 },
    backgroundStyle: "flat",
  },
  {
    id: "signal",
    name: "Signal",
    description: "Bold, confident and modern. For keynotes and pitch decks.",
    mode: "dark",
    tokens: {
      canvas: "#101418",
      surface: "#1B2128",
      ink: "#FFFFFF",
      inkMuted: "#94A2B0",
      accent: "#28E0A6",
      onAccent: "#04241A",
      line: "#28313A",
    },
    fonts: {
      display: "var(--font-grotesk)",
      sans: "var(--font-grotesk)",
      mono: "var(--font-mono)",
    },
    scale: { ...scale, h1: 6.0 },
    backgroundStyle: "gradient",
    gradientTo: "#161D24",
  },
  {
    id: "ember",
    name: "Ember",
    description: "Warm and human. Storytelling, narrative and case-based teaching.",
    mode: "dark",
    tokens: {
      canvas: "#17110E",
      surface: "#241A15",
      ink: "#F8F1EA",
      inkMuted: "#B09A8B",
      accent: "#E8734A",
      onAccent: "#1B0D06",
      line: "#3A2A22",
    },
    fonts: { display: "var(--font-display)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale,
    backgroundStyle: "vignette",
  },
  {
    id: "chalk",
    name: "Chalk",
    description: "Soft slate with a hand-taught feel. Classroom and workshop material.",
    mode: "dark",
    tokens: {
      canvas: "#1E2A28",
      surface: "#283634",
      ink: "#EFF4F2",
      inkMuted: "#9DB2AD",
      accent: "#7FD1B9",
      onAccent: "#0C1A17",
      line: "#35443F",
    },
    fonts: { display: "var(--font-grotesk)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale,
    backgroundStyle: "flat",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    description: "Deep navy and cyan, set in mono. Engineering, systems and architecture.",
    mode: "dark",
    tokens: {
      canvas: "#0B1522",
      surface: "#132131",
      ink: "#E8F2FB",
      inkMuted: "#8CA6C0",
      accent: "#4CC9F0",
      onAccent: "#05131C",
      line: "#22344A",
    },
    fonts: { display: "var(--font-mono)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale: { ...scale, h1: 4.6, h2: 3.0 },
    backgroundStyle: "gradient",
    gradientTo: "#0E1B2B",
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "Violet dusk with a magenta edge. Creative, product and design work.",
    mode: "dark",
    tokens: {
      canvas: "#140F22",
      surface: "#1F1734",
      ink: "#F4EFFF",
      inkMuted: "#A99BC7",
      accent: "#F26DBD",
      onAccent: "#25061A",
      line: "#2E2447",
    },
    fonts: {
      display: "var(--font-grotesk)",
      sans: "var(--font-inter)",
      mono: "var(--font-mono)",
    },
    scale: { ...scale, h1: 5.8 },
    backgroundStyle: "gradient",
    gradientTo: "#1B1030",
  },
  {
    /**
     * Built for the two rooms that break every other theme: a projector with
     * a washed-out lamp, and an audience with low vision. Pure black behind
     * pure white is the highest contrast a screen can produce, the accent is
     * the one hue that survives a yellowing bulb, and the type is a step
     * larger throughout — which costs words on a scene and is the point.
     */
    id: "contrast",
    name: "High contrast",
    description: "Maximum legibility. Low vision, tired projectors, the back of a big room.",
    mode: "dark",
    tokens: {
      canvas: "#000000",
      surface: "#141414",
      ink: "#FFFFFF",
      inkMuted: "#C8C8C8",
      accent: "#FFD400",
      onAccent: "#000000",
      line: "#3A3A3A",
    },
    fonts: {
      display: "var(--font-grotesk)",
      sans: "var(--font-grotesk)",
      mono: "var(--font-mono)",
    },
    scale: { h1: 6.2, h2: 4.0, h3: 2.7, body: 2.0, caption: 1.4 },
    backgroundStyle: "flat",
  },
  {
    id: "field",
    name: "Field",
    description: "Black on white, oversized. For teaching with the lights on.",
    mode: "light",
    tokens: {
      canvas: "#FFFFFF",
      surface: "#EFEFEF",
      ink: "#111111",
      inkMuted: "#555555",
      accent: "#D62828",
      onAccent: "#FFFFFF",
      line: "#D6D6D6",
    },
    fonts: {
      display: "var(--font-grotesk)",
      sans: "var(--font-inter)",
      mono: "var(--font-mono)",
    },
    scale: { ...scale, h1: 5.8, body: 1.9 },
    backgroundStyle: "flat",
  },
  {
    id: "archive",
    name: "Archive",
    description: "Parchment and oxblood serif. History, law, literature and argument.",
    mode: "light",
    tokens: {
      canvas: "#F6EFE1",
      surface: "#EDE3D0",
      ink: "#241C14",
      inkMuted: "#6E5D48",
      accent: "#7B2D26",
      onAccent: "#FBF6EC",
      line: "#DCCEB5",
    },
    fonts: {
      display: "var(--font-display)",
      sans: "var(--font-display)",
      mono: "var(--font-mono)",
    },
    scale: { ...scale, h1: 4.9, body: 1.75 },
    backgroundStyle: "vignette",
  },
  {
    id: "meadow",
    name: "Meadow",
    description: "Pale green and deep forest ink. Biology, ecology and the field sciences.",
    mode: "light",
    tokens: {
      canvas: "#F3F7EF",
      surface: "#E6EEDE",
      ink: "#16241A",
      inkMuted: "#54685A",
      accent: "#2E7D4F",
      onAccent: "#F4FBF6",
      line: "#D2DFC8",
    },
    fonts: { display: "var(--font-display)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale,
    backgroundStyle: "flat",
  },
  {
    /**
     * The room lit from its corners rather than from a lamp. Deep indigo with
     * a cyan-violet bloom — where `aurora` is a flat violet dusk, this has
     * distance in it, which is what a launch or a demo wants when the deck
     * itself is part of the impression.
     */
    id: "nebula",
    name: "Nebula",
    description:
      "Indigo depth with a violet bloom. A launch, a demo, a deck that is part of the pitch.",
    mode: "dark",
    tokens: {
      canvas: "#0A0D1A",
      surface: "#161A2E",
      ink: "#EFF1FB",
      inkMuted: "#96A0C4",
      accent: "#7C6BF5",
      onAccent: "#0A0716",
      line: "#242942",
    },
    fonts: {
      display: "var(--font-grotesk)",
      sans: "var(--font-inter)",
      mono: "var(--font-mono)",
    },
    scale: { ...scale, h1: 5.8 },
    backgroundStyle: "bloom",
    gradientTo: "#1B2450",
  },
  {
    /**
     * Dusk, and the light is coming from somewhere. `ember` is warm and flat;
     * this is warm and *directional*, which is what a story wants when the
     * point is that time is passing.
     */
    id: "horizon",
    name: "Horizon",
    description: "Warm dusk over deep teal. Narrative, time passing, a talk with an arc.",
    mode: "dark",
    tokens: {
      canvas: "#0C1719",
      surface: "#16282B",
      ink: "#F6F1E9",
      inkMuted: "#9DB0AF",
      accent: "#F2914A",
      onAccent: "#1B0E03",
      line: "#243A3D",
    },
    fonts: { display: "var(--font-display)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale: { ...scale, h1: 5.2 },
    backgroundStyle: "mesh",
    gradientTo: "#123338",
  },
  {
    /**
     * For the bright room where `field`'s pure white reads as a spreadsheet.
     * Same lights-on legibility, but the page has a temperature — the blush is
     * far too weak to touch contrast and just enough that the stage stops
     * looking like a document someone forgot to design.
     */
    id: "porcelain",
    name: "Porcelain",
    description: "Warm white with a blush bloom. A lit room, without looking like a document.",
    mode: "light",
    tokens: {
      canvas: "#FCFAFA",
      surface: "#F2ECEE",
      ink: "#1A1618",
      inkMuted: "#6A6165",
      accent: "#C0466B",
      onAccent: "#FFF7F9",
      line: "#E4DADE",
    },
    fonts: { display: "var(--font-display)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale,
    backgroundStyle: "bloom",
    gradientTo: "#EFE6F0",
  },
  {
    /**
     * The light counterpart to `blueprint`: a technical review with the lights
     * on. Cool grey with steel washes at the corners, mono display, and a
     * centre band left almost clear because that is where the diagram goes.
     */
    id: "graphite",
    name: "Graphite",
    description: "Cool grey with steel corners, set in mono. Technical review, lights on.",
    mode: "light",
    tokens: {
      canvas: "#F7F8F9",
      surface: "#E8ECEF",
      ink: "#15191D",
      inkMuted: "#5C666F",
      accent: "#1D6FA5",
      onAccent: "#F4FAFF",
      line: "#D5DCE2",
    },
    fonts: { display: "var(--font-mono)", sans: "var(--font-inter)", mono: "var(--font-mono)" },
    scale: { ...scale, h1: 4.6, h2: 3.0 },
    backgroundStyle: "mesh",
    gradientTo: "#DCE4EA",
  },
];

export const DEFAULT_THEME_ID = "midnight";

export function getTheme(id: string | null | undefined): PresentationTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Resolve a schema `ColorValue` against a theme. */
export function resolveColor(
  value: { kind: "token"; token: string } | { kind: "hex"; hex: string } | null | undefined,
  theme: PresentationTheme,
  fallback: keyof ThemeTokens = "ink",
): string {
  if (!value) return theme.tokens[fallback];
  if (value.kind === "hex") return value.hex;
  const token = value.token as keyof ThemeTokens;
  return theme.tokens[token] ?? theme.tokens[fallback];
}

/** CSS custom properties for a stage rendered with this theme. */
/**
 * Categorical hues for anything that has to tell several things apart — chart
 * series, movements on the pacing strip. Deliberately literal rather than
 * token-derived: a categorical palette's job is *distinguishability*, and
 * deriving six colours from one accent produces six colours nobody can tell
 * apart. The theme's own accent leads, so it still belongs to the deck.
 */
export function categoricalHues(theme: PresentationTheme): string[] {
  return [theme.tokens.accent, "#5AA9E6", "#7FD1B9", "#E8A34A", "#C77DD6", "#E2726E"];
}

export function themeCssVars(theme: PresentationTheme): Record<string, string> {
  return {
    "--stage-canvas": theme.tokens.canvas,
    "--stage-surface": theme.tokens.surface,
    "--stage-ink": theme.tokens.ink,
    "--stage-ink-muted": theme.tokens.inkMuted,
    "--stage-accent": theme.tokens.accent,
    "--stage-on-accent": theme.tokens.onAccent,
    "--stage-line": theme.tokens.line,
    "--stage-font-display": theme.fonts.display,
    "--stage-font-sans": theme.fonts.sans,
    "--stage-font-mono": theme.fonts.mono,
  };
}

/**
 * A colour of the theme's, thinned so it reads as light rather than as paint.
 *
 * `oklab` and not `srgb`: mixing toward transparent in sRGB darkens as it
 * fades, so a warm accent washes out through a muddy brown on its way to
 * nothing. This is the same reason the world's atmosphere blends in OKLab.
 */
const wash = (colour: string, percent: number) =>
  `color-mix(in oklab, ${colour} ${percent}%, transparent)`;

/**
 * Background CSS for the stage surface itself.
 *
 * Every one of these is built from the theme's own tokens and nothing else, so
 * re-theming a deck moves its ground with it and no background can disagree
 * with the text standing on it.
 *
 * `bloom` and `mesh` exist because the other three are flat. A single colour,
 * a two-stop linear gradient and a centre vignette are all *one* light, and a
 * stage lit by one light looks like a page — which is the complaint they were
 * added to answer. Both of these are several offset washes over the canvas, so
 * the ground has a near side and a far side.
 *
 * They stay deliberately quiet. These sit *behind* text at presentation size,
 * so the washes are thinned to somewhere between a tenth and a third and the
 * canvas is still the colour the eye reads — contrast is measured against
 * `canvas` everywhere else in this file and in `analysis/`, and a background
 * bright enough to change that answer would make those numbers lies.
 */
export function stageBackgroundCss(theme: PresentationTheme): string {
  const { canvas, surface, accent } = theme.tokens;
  // The second light. A theme that named a gradient end has already chosen it;
  // otherwise its surface is the nearest thing to "canvas, but lifted".
  const far = theme.gradientTo ?? surface;

  switch (theme.backgroundStyle) {
    case "gradient":
      return `linear-gradient(160deg, ${canvas} 0%, ${far} 100%)`;
    case "vignette":
      return `radial-gradient(120% 90% at 50% 0%, ${surface} 0%, ${canvas} 62%)`;
    case "bloom":
      // Light entering from the top corners and pooling at the foot, which is
      // how a room is lit. The accent appears twice at different strengths so
      // the two ends of the stage are the same colour at different distances,
      // rather than two colours.
      return [
        `radial-gradient(62% 48% at 10% 4%, ${wash(accent, 20)} 0%, transparent 64%)`,
        `radial-gradient(54% 42% at 92% 14%, ${wash(far, 62)} 0%, transparent 68%)`,
        `radial-gradient(84% 62% at 50% 116%, ${wash(accent, 11)} 0%, transparent 72%)`,
        canvas,
      ].join(", ");
    case "mesh":
      // Four corners, none of them meeting in the middle — where the heading
      // goes. The washes are weakest along the centre band on purpose.
      return [
        `radial-gradient(46% 40% at 4% 8%, ${wash(far, 70)} 0%, transparent 70%)`,
        `radial-gradient(42% 38% at 96% 6%, ${wash(accent, 16)} 0%, transparent 68%)`,
        `radial-gradient(50% 44% at 2% 96%, ${wash(accent, 10)} 0%, transparent 72%)`,
        `radial-gradient(48% 42% at 98% 92%, ${wash(far, 52)} 0%, transparent 70%)`,
        canvas,
      ].join(", ");
    default:
      return canvas;
  }
}
