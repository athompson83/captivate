import { z } from "zod";

/**
 * A theme is a *token set*, not a stylesheet. Scenes reference tokens
 * (`{ kind: "token", token: "ink" }`), so re-theming a deck never rewrites
 * element content — it just resolves the same tokens differently.
 */

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
  /** Default background applied to new scenes. */
  backgroundStyle: z.enum(["flat", "gradient", "vignette"]).default("flat"),
  gradientTo: z.string().optional(),
});
export type PresentationTheme = z.infer<typeof PresentationTheme>;

const scale = { h1: 5.4, h2: 3.4, h3: 2.2, body: 1.6, caption: 1.1 };

/**
 * Twelve themes, each with a genuinely different point of view. Still curated
 * rather than exhaustive — an educator should be able to pick one in five
 * seconds, so the bar for a new one is that it does a job none of the others
 * does, not that it is another nice palette. Six dark and six light, because
 * the room decides that and the author does not always get to choose the room.
 *
 * The jobs, in order: a dim lecture hall · an editorial read · dense technical
 * teaching · a keynote · storytelling · a workshop · engineering and systems ·
 * creative and product work · low vision and bad projectors · a bright room
 * with the lights on · the humanities · the life sciences.
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

/** Background CSS for the stage surface itself. */
export function stageBackgroundCss(theme: PresentationTheme): string {
  switch (theme.backgroundStyle) {
    case "gradient":
      return `linear-gradient(160deg, ${theme.tokens.canvas} 0%, ${theme.gradientTo ?? theme.tokens.surface} 100%)`;
    case "vignette":
      return `radial-gradient(120% 90% at 50% 0%, ${theme.tokens.surface} 0%, ${theme.tokens.canvas} 62%)`;
    default:
      return theme.tokens.canvas;
  }
}
