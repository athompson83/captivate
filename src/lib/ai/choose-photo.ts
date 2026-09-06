import type { StockResult } from "./visual-sourcing";

/**
 * Which of the search results actually goes on the scene.
 *
 * The pipeline used to take `found.data[0]` — the provider's first result — and
 * call that the creative decision. It is not one. A stock search returns
 * twenty-four candidates and the first is merely the one the provider ranked
 * highest for the *words*; nothing in that ranking knows the shape of the hole
 * it has to fill, how much of the picture survives being cropped into it, or
 * that the scene three beats ago already used it.
 *
 * So this is a ranking rather than a rewrite. The provider's order is real
 * signal about meaning and it is kept as the tie-breaker; what is added on top
 * is everything the provider could not have known:
 *
 *  - **crop survival** — a landscape photograph centre-cropped into the tall
 *    half of a split scene loses most of itself, and what it loses is usually
 *    the subject. Scored as how much of the frame is still there afterwards;
 *  - **enough pixels** — a picture that is sharp in a thumbnail and soft on a
 *    three-metre projector is worse than no picture, because it is the thing
 *    the room is looking at;
 *  - **meaning** — the provider matched the query; the scene's own words are a
 *    second opinion, and a candidate whose description shares them is more
 *    likely to be about the moment rather than about the search term;
 *  - **not this one again** — the same photograph twice in a deck reads as a
 *    mistake even when both scenes are about the same thing.
 *
 * Pure and synchronous: no second API call, nothing to time out, and every
 * decision is testable against a fixed list of candidates.
 */

/**
 * Below this on the long edge a photograph is soft on a projector.
 *
 * Measured against the *original's* dimensions, which is what the search
 * returns, and that is a claim about the candidate rather than about the file
 * that ends up stored: the fetched URL is one of the provider's named
 * renditions, and this environment has no provider key with which to read back
 * what those actually contain. So read this as "the source has pixels to
 * spare", not as "the delivered image is sharp". The delivered size is a
 * question for the real-provider run (BETA-003); until then the honest thing
 * is that a candidate failing this is definitely too small, while one passing
 * it is merely not disqualified.
 */
const MIN_LONG_EDGE = 1400;

/** Words that say nothing about what a picture shows. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "over",
  "under",
  "your",
  "their",
  "its",
  "are",
  "was",
  "one",
  "two",
  "not",
  "but",
  "how",
  "why",
  "what",
  "when",
  "who",
  "photo",
  "photograph",
  "image",
  "picture",
  "shot",
  "background",
]);

export interface PhotoChoiceOptions {
  /**
   * The rendered width-to-height ratio of the slot this fills.
   *
   * Rendered, not normalised: the stage is 100x100 units letterboxed into the
   * display, so the tall half of a split scene is a 50x100 region that reaches
   * the audience at roughly 8:9. Cropping is decided by what the room sees.
   */
  slotAspect: number;
  /** The scene's own words — the image prompt, the heading, the search terms. */
  terms: string;
  /** Provider asset ids already used elsewhere in this deck. */
  taken?: ReadonlySet<string>;
}

/**
 * The best candidate for one slot, or null where the list is empty or every
 * candidate is already used elsewhere in the deck.
 */
export function chooseStockPhoto(
  candidates: readonly StockResult[],
  options: PhotoChoiceOptions,
): StockResult | null {
  const wanted = words(options.terms);
  let best: StockResult | null = null;
  let bestScore = -Infinity;

  candidates.forEach((candidate, rank) => {
    if (options.taken?.has(candidate.providerAssetId)) return;
    const score = scorePhoto(candidate, options.slotAspect, wanted) - rank * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  return best;
}

/** Exposed for testing: what one candidate is worth for one slot. */
export function scorePhoto(
  candidate: StockResult,
  slotAspect: number,
  wanted: ReadonlySet<string>,
): number {
  return (
    cropSurvival(candidate, slotAspect) * 2 + sharpness(candidate) + relevance(candidate, wanted)
  );
}

/**
 * How much of the picture is left after a centre crop into the slot.
 *
 * 1 where the shapes match, and it falls away as they diverge — a 16:9
 * photograph in an 8:9 hole keeps half its width, so half the composition the
 * photographer made is gone and the subject may go with it.
 *
 * Same caveat as `MIN_LONG_EDGE`: this is the *original's* shape. Where a
 * provider's rendition is itself a fixed crop, the delivered aspect is that
 * rendition's rather than this one, and the comparison is then about which
 * original survives the provider's crop best rather than ours. It still ranks
 * candidates in the right order; it is not a promise about the final frame.
 */
function cropSurvival(candidate: StockResult, slotAspect: number): number {
  if (candidate.width <= 0 || candidate.height <= 0 || slotAspect <= 0) return 0;
  const imageAspect = candidate.width / candidate.height;
  return Math.min(imageAspect, slotAspect) / Math.max(imageAspect, slotAspect);
}

/** Full marks at the projector threshold, falling away below it. */
function sharpness(candidate: StockResult): number {
  const longEdge = Math.max(candidate.width, candidate.height);
  if (longEdge >= MIN_LONG_EDGE) return 1;
  return Math.max(0, longEdge / MIN_LONG_EDGE) - 1;
}

/** How much of the scene's own vocabulary the candidate's description shares. */
function relevance(candidate: StockResult, wanted: ReadonlySet<string>): number {
  if (wanted.size === 0) return 0;
  const described = words(candidate.altText);
  let shared = 0;
  for (const word of described) if (wanted.has(word)) shared += 1;
  return Math.min(1, shared / Math.min(4, wanted.size));
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}
