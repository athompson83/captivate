import type { BackdropGraphic } from "@/lib/schema/presentation";
import type { PresentationTheme } from "@/lib/schema/theme";
import { toOklab } from "@/lib/utils/color";

/**
 * A look for every deck.
 *
 * Every picture a generated deck had was a stock photograph in its own colour
 * world — a library's, a phone's — and a deck of them read as a scrapbook.
 * A look is one sentence of visual direction the scene writer sets for the
 * whole talk (medium, light, a recurring motif, what to avoid), kept on the
 * journey so a picture made later follows it too, and folded into every
 * prompt an image model is given, with the theme's own palette in words.
 *
 * Pure, and free of `server-only`: the journey panel shows the look and a
 * test reads the briefs.
 */

/** How long a look may be. */
export const LOOK_MAX = 400;

/** Pictures a deck may generate, the cover first. The room is one more. */
export const GENERATED_PER_DECK = 4;

/** What a deck is given when the model wrote no look. */
export const DEFAULT_LOOK =
  "Documentary photography, available light, shallow depth, one clear subject with air around it, nothing posed.";

const NEVER = "No text, no lettering, no logos, no watermarks, no borders.";

/** The name of a hue, from its OKLab angle. */
function hueName(a: number, b: number): string {
  const angle = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const names: [number, string][] = [
    [20, "rose"],
    [45, "red"],
    [70, "orange"],
    [95, "amber"],
    [115, "yellow"],
    [165, "green"],
    [200, "teal"],
    [235, "cyan"],
    [275, "blue"],
    [305, "violet"],
    [340, "magenta"],
    [360, "rose"],
  ];
  return names.find(([limit]) => angle < limit)?.[1] ?? "rose";
}

/** One colour in words: its lightness and its hue, or its greyness. */
export function colourWords(hex: string): string {
  const { L, a, b } = toOklab(hex);
  const chroma = Math.hypot(a, b);
  const light = L < 0.22 ? "near-black" : L < 0.5 ? "deep" : L < 0.8 ? "mid" : "pale";
  if (chroma < 0.03) return L < 0.22 ? "near-black" : L > 0.9 ? "off-white" : `${light} grey`;
  return `${light} ${hueName(a, b)}`;
}

/** The theme's palette, in the words an image model can act on. */
export function paletteWords(theme: PresentationTheme): string {
  return `a ${colourWords(theme.tokens.canvas)} ground, ${colourWords(theme.tokens.accent)} accents`;
}

/** What is asked of the image model for one scene's picture. */
export function pictureBrief(imagePrompt: string, look: string, palette: string): string {
  const direction = look.trim() || DEFAULT_LOOK;
  return `${imagePrompt.trim().replace(/\.$/, "")}. ${direction} Colour world: ${palette}. ${NEVER}`.slice(
    0,
    1000,
  );
}

/**
 * The room a talk stands in: the picture behind the whole show.
 *
 * Deliberately empty at the centre and soft everywhere. It sits behind every
 * scene at a distance, dimmed toward the canvas, and a subject in it would
 * fight the one on the stage; what it should carry is the place and the
 * light of the subject, out of focus.
 */
export function roomBrief(title: string, look: string, palette: string): string {
  const direction = look.trim() || DEFAULT_LOOK;
  return `The room a talk called "${title.trim().slice(0, 120)}" stands in: an atmospheric environment seen out of focus, empty at the centre, no people, no readable detail, soft depth, light from one side, quiet enough for words to sit over it. ${direction} Colour world: ${palette}. ${NEVER}`.slice(
    0,
    1000,
  );
}

/**
 * The drawn room that suits a look.
 *
 * A deck with no room picture — every deck on a deployment without an image
 * key, and every deck whose room the provider refused — stands in front of a
 * drawn room, and it was always the same one: `aurora`, whatever the talk.
 * The look already says what the pictures are made of, so it can say what
 * the wall behind them is too. A printed medium — ink, wash, paper, a plan —
 * stands in front of `strata`, bands like distance seen through air; a
 * photographic or lit one — film, lamplight, a single source — in front of
 * `halo`, one light and the room falling away from it; anything else keeps
 * the aurora. Matched on words, not understood, so a look that names neither
 * gets the default rather than a guess.
 */
export function roomFor(look: string): BackdropGraphic {
  const words = look.toLowerCase();
  const printed =
    /\b(ink|wash|watercolou?r|gouache|paper|print|linocut|woodcut|etching|engraving|charcoal|pencil|drafting|blueprint|architectural|schematic|diagram|map|atlas|cartograph)/;
  const lit =
    /\b(photograph|documentary|film|cinema|cinematic|noir|lamplight|lamp|torch|candle|spotlight|studio|window light|single light|one light|low light|dusk|dawn|night|neon)/;
  if (printed.test(words)) return "strata";
  if (lit.test(words)) return "halo";
  return "aurora";
}
