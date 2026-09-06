import type { NarrativeRole, VisualIntent } from "@/lib/schema/narrative";
import { layoutSlots } from "@/lib/editor/layouts";
import type { SceneLayout } from "@/lib/schema/presentation";

/**
 * Choosing what every scene in a deck looks like.
 *
 * This used to be one pure function of a single moment, and that is why every
 * generated deck looked the same. Read out of production on 2026-09-06, across
 * every deck the product has ever generated:
 *
 * | intent the model chose | count |   | layout composed | count |
 * | ---------------------- | ----- |   | --------------- | ----- |
 * | statement              |   152 |   | statement       |   143 |
 * | comparison             |    50 |   | two-column      |    50 |
 * | imagery                |    47 |   | three-up        |    40 |
 * | sequence               |    40 |   | bullets         |    38 |
 * | enumeration            |    32 |   | split-*         |    47 |
 * | demonstration          |    17 |   | chart           |     3 |
 * | data                   |     4 |   | takeaway        | **0** |
 * | auto                   | **1** |   | action          | **0** |
 * |                        |       |   | figure          | **0** |
 * |                        |       |   | explainer       | **0** |
 * |                        |       |   | quote           | **0** |
 *
 * Four compositions this engine ships had never once reached an audience, and
 * a fifth had reached three scenes in 351. Two causes, and they are the same
 * cause twice:
 *
 *  - **`statement` was read as an instruction.** It is what a model says when
 *    it has no opinion — 44% of all moments — and it named no content, so it
 *    vetoed the role's own answer. An `application` beat is a call to action
 *    by definition and became a centred line; `evidence` became a centred line
 *    instead of the number it is about; `context` never became an explanation.
 *  - **The take-home rule required `auto`**, an intent the model has emitted
 *    once in the product's life. So a movement's point was never handed over.
 *
 * What replaces it is not another percentage. Composition here is a *sequence*
 * decision: each moment offers its ranked compositions, and the deck picks
 * from them by what has just been on screen — no run of three alike, no four
 * scenes with nowhere to put a picture, splits alternating from the last one
 * actually placed. Nothing keys off `index % 2`, which is the arbitrariness
 * this replaces: a scene's shape now depends on the argument around it, which
 * is the same thing every other decision in this file is made from.
 *
 * Pure and deterministic: the same map composes the same deck every time, in
 * the editor, on the stage and in a thumbnail.
 */

export interface Beat {
  role: NarrativeRole;
  visualIntent: VisualIntent;
  /** True where this is the last moment of its movement. */
  endsMovement?: boolean;
  /**
   * The author picked this intent, rather than the model proposing it.
   *
   * The whole distinction this file exists for. An author who chooses "one
   * statement" for a call to action means it and gets it; a model that says
   * `statement` because it had nothing to say does not get to silence the
   * role. Absent (the default) means nobody has touched it.
   */
  intentAuthored?: boolean;
}

/** Layouts a scene generation may compose. `title` and `code` are author-only. */
type Layout = Extract<
  SceneLayout,
  | "cover"
  | "statement"
  | "bullets"
  | "two-column"
  | "three-up"
  | "chart"
  | "media-full"
  | "quote"
  | "split-left"
  | "split-right"
  | "closing"
  | "section"
  | "takeaway"
  | "action"
  | "figure"
  | "explainer"
  | "title"
  | "code"
>;

/**
 * Intents that name content. These are instructions and win outright.
 *
 * `statement` and `auto` are not here: one is the model's shrug and the other
 * says so in its name. An author who sets either is honoured through
 * `intentAuthored` instead — provenance, not vocabulary.
 */
const NAMES_CONTENT = new Map<VisualIntent, Layout | null>([
  ["comparison", "two-column"],
  ["data", "chart"],
  ["sequence", "three-up"],
  ["quotation", "quote"],
  ["enumeration", "bullets"],
  // A picture rather than a composition; the role picks which kind, below.
  ["imagery", null],
  ["demonstration", null],
]);

/** A cover is the opening image. These intents asked for something else. */
const NOT_A_COVER: VisualIntent[] = ["data", "quotation", "comparison", "sequence"];

/** Roles whose movement-ending beat is the take-home point of that movement. */
const LANDS_A_POINT: NarrativeRole[] = [
  "claim",
  "reframe",
  "synthesis",
  "evidence",
  "example",
  "contrast",
  "context",
];

/**
 * What each role asks to be, best first.
 *
 * Ranked rather than single, so the deck can take a role's second answer when
 * its first has just been on screen. Every list ends somewhere safe.
 */
const ROLE_CHOICES: Record<NarrativeRole, Layout[]> = {
  // The opening line. A cover when it opens the deck (handled below), and a
  // line with air around it when it does not.
  hook: ["statement", "split-right"],
  // Both of these unsettle, and both are one sentence. A provocation that has
  // a voice behind it is a quotation.
  provocation: ["statement", "quote"],
  question: ["statement", "section"],
  // What the room needs in order to follow: the plain sentence, the three
  // parts, and the picture of the mechanism.
  context: ["explainer", "split-left", "bullets"],
  // How to think about what follows. A frame is a single idea, not a list —
  // this used to fall through to `bullets`, which is why a deck's framing beat
  // arrived as four fragments.
  frame: ["statement", "section", "explainer"],
  // The spine. A claim lands hardest with a picture beside it or with air
  // around it, and the deck decides which by what preceded it.
  claim: ["split-right", "statement", "takeaway"],
  reframe: ["split-left", "statement", "takeaway"],
  // Pulling threads into one idea is a take-home *at the end of a movement*,
  // where the rule below promotes it. Mid-movement it is still an argument
  // being made, and a deck whose every synthesis is a take-home has stopped
  // meaning anything by the word.
  synthesis: ["split-right", "statement", "takeaway"],
  // Most evidence a talk leans on is one figure — a rate, a count, a ratio.
  // A chart drawn around one number is a chart with nothing to compare.
  evidence: ["figure", "chart", "split-left"],
  // Not `media-full`: the drawing pass skips a full-bleed backdrop on purpose
  // (line art under a heading is noise), so a full-bleed scene can only ever
  // be filled by a photograph. On a deployment with no stock key that is a
  // full-screen empty placeholder, which is worse than any composition it
  // could have replaced. It stays available to an author with a real picture.
  example: ["split-right", "three-up"],
  demonstration: ["split-left", "three-up"],
  contrast: ["two-column", "split-right"],
  // "Show them what to do differently" is a call to action by definition.
  application: ["action", "bullets", "takeaway"],
  transition: ["section", "statement"],
  callback: ["quote", "statement", "split-left"],
  // A deck ends on what to do next, not on a list of what was said.
  close: ["action", "takeaway", "closing"],
};

/** Compositions with somewhere to put a picture. */
function carriesPicture(layout: Layout): boolean {
  return Boolean(layoutSlots(layout).media);
}

/** Compositions that fill the screen with structure rather than one idea. */
const DENSE: Layout[] = ["bullets", "two-column", "three-up", "action", "explainer", "chart"];

/**
 * What the room sees, which is coarser than which layout it is.
 *
 * A split-left and a split-right are the same composition seen twice: a
 * picture beside some words. Counting them as different is how a deck ends up
 * seven-twelfths side-by-side while every rule about repetition reports itself
 * satisfied — the mirror image is not variety.
 */
function shapeOf(layout: Layout): string {
  if (layout === "split-left" || layout === "split-right") return "split";
  if (layout === "statement" || layout === "section") return "line";
  return layout;
}

/**
 * The compositions a single beat will accept, best first.
 *
 * Never empty. An intent that names content returns exactly one — it is an
 * instruction, and the deck's rhythm does not get to overrule the author.
 */
export function layoutChoices(beat: Beat, index: number): Layout[] {
  const { role, visualIntent: intent } = beat;

  // An intent the author set is an instruction wherever it appears, and that
  // has to include the first scene. Checked before the cover rule below rather
  // than after it: an author who opens the picker on their opening beat and
  // chooses "One statement" is saying they want a line, and answering that
  // with a full-bleed photograph is the same override this file exists to
  // remove — just aimed at the person instead of the role.
  if (beat.intentAuthored && intent === "statement") return ["statement"];

  // The deck opens on a cover: a full-bleed image with the title over it,
  // lifted by the first advance. Stated as what a cover loses to, because the
  // classic opening line carries the `statement` intent and a line over a
  // photograph is the same line.
  if (
    index === 0 &&
    !NOT_A_COVER.includes(intent) &&
    (role === "hook" || role === "provocation" || role === "question")
  ) {
    return ["cover"];
  }

  if (NAMES_CONTENT.has(intent)) {
    const named = NAMES_CONTENT.get(intent);
    if (named) return [named];
    // Imagery and demonstration name a *picture*, not a composition. So the
    // role still chooses which kind of picture composition: a context beat
    // asking for imagery is the explanation with the mechanism drawn beside
    // it, not a heading and a photograph. A chart is excluded — it is a data
    // graphic, and nobody asking for imagery meant one. Both split sides trail
    // the list so the sequence, not the index, decides which side this gets.
    const pictorial = ROLE_CHOICES[role].filter(
      (layout) => carriesPicture(layout) && layout !== "chart",
    );
    return [...pictorial, "split-right", "split-left"];
  }

  const choices = ROLE_CHOICES[role];

  // The end of a movement is where its point is handed over. An explicit
  // intent still wins — a comparison that closes a movement is a comparison —
  // but a beat the application is composing lands as a take-home.
  if (beat.endsMovement && LANDS_A_POINT.includes(role)) {
    return ["takeaway", ...choices.filter((layout) => layout !== "takeaway")];
  }

  return [...choices];
}

/**
 * Composes a whole deck, in order.
 *
 * Each beat's choices are scored against what has just been on screen and the
 * best-scoring one is placed. Preference order breaks every tie, so a deck
 * with no repetition in it composes exactly as each moment asked.
 */
export function composeDeck(beats: Beat[]): Layout[] {
  const placed: Layout[] = [];
  let lastSplit: "split-left" | "split-right" | null = null;

  beats.forEach((beat, index) => {
    const choices = layoutChoices(beat, index);
    const previous = placed[placed.length - 1];
    const before = placed[placed.length - 2];
    // How long since the room last had something to look at.
    let dry = 0;
    for (let i = placed.length - 1; i >= 0 && !carriesPicture(placed[i]); i--) dry += 1;

    let best = choices[0];
    let bestCost = Infinity;

    choices.forEach((candidate, rank) => {
      let cost = rank;
      // The same shape three times running is a form letter — and a
      // split-right after a split-left is the same shape.
      const shape = shapeOf(candidate);
      if (previous && shape === shapeOf(previous)) {
        cost += before && shape === shapeOf(before) ? 12 : 5;
      }
      // Three dense screens in a row is a document, not a talk.
      if (DENSE.includes(candidate) && dense(previous) && dense(before)) cost += 8;
      // Four scenes with nowhere for a picture is the reported deck.
      if (dry >= 3 && !carriesPicture(candidate)) cost += 10;
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    });

    // Which side a split lands on is decided by the last split actually
    // placed, not by the scene's position — a deck whose splits alternate by
    // index flips sides across the scenes that fall between them.
    if (best === "split-left" || best === "split-right") {
      if (lastSplit === best) best = best === "split-left" ? "split-right" : "split-left";
      lastSplit = best;
    }

    placed.push(best);
  });

  return placed;
}

function dense(layout: Layout | undefined): boolean {
  return layout !== undefined && DENSE.includes(layout);
}
