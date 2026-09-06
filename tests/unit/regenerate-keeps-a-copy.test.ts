import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The upgrade path for a deck that already exists.
 *
 * A generator fix does not reach stored scenes. The composition a deck was
 * built with is written down in its scene content, so the only way an existing
 * deck gets a better one is to write it again — and writing it again replaces
 * everything the author has since edited. That is destructive by definition,
 * and until now it happened on one click with nothing kept.
 *
 * So regeneration can take a copy first. Two properties matter, and neither
 * can be shown by rendering the control or by exercising either server action
 * on its own: the copy is taken *before* the model call, and a copy that fails
 * stops the whole thing rather than being reported as a warning while the
 * original is overwritten anyway.
 */

const root = join(__dirname, "..", "..");
const hook = readFileSync(join(root, "src/components/narrative/use-scene-generation.ts"), "utf8");

describe("regenerating a deck that already has scenes", () => {
  it("copies it before anything is written, not after", () => {
    const copy = hook.indexOf("await duplicatePresentation(presentationId)");
    const write = hook.indexOf('fetch("/api/ai/scenes-from-map"');
    expect(copy, "the copy should be taken in the generation path").toBeGreaterThan(-1);
    expect(write, "the generation path should call the scenes route").toBeGreaterThan(-1);
    // A copy taken afterwards is no copy at all: a generation that half
    // succeeds would have already replaced the scenes it is meant to preserve.
    expect(copy).toBeLessThan(write);
  });

  it("abandons the regeneration when the copy could not be made", () => {
    const block = hook.slice(
      hook.indexOf("if (keepCopy) {"),
      hook.indexOf('fetch("/api/ai/scenes-from-map"'),
    );
    expect(block).toMatch(/if \(!copied\.ok\)/);
    // `return`, not a warning toast and carry on. The author asked for the old
    // deck to survive; carrying on is the one outcome they ruled out.
    expect(block).toMatch(/return;/);
  });

  it("offers the choice only where there is something to lose", () => {
    const view = readFileSync(
      join(root, "src/components/narrative/narrative-map-view.tsx"),
      "utf8",
    );
    expect(view).toMatch(/\{replacing > 0 && \(/);
    // On by default when it is offered — the safe answer should not be the one
    // the author has to remember.
    expect(view).toMatch(/useState\(true\)/);
  });
});

describe("a regeneration the author walks away from", () => {
  /**
   * This route hands its scenes back for the browser to save one at a time,
   * so a phone that locks between the answer arriving and the last save leaves
   * a half-written deck that looks finished. The deck now says otherwise.
   */
  const route = readFileSync(join(root, "src/app/api/ai/scenes-from-map/route.ts"), "utf8");

  it("is claimed by the route, before the model is asked", () => {
    const claim = route.indexOf('generation_status: "generating"');
    const model = route.indexOf("await buildScenesFromMap(");
    expect(claim, "the route should mark the deck as being written").toBeGreaterThan(-1);
    // Claimed after the answer would be claiming it once it no longer matters.
    expect(claim).toBeLessThan(model);
  });

  it("records when the claim started, because that is what lets it expire", () => {
    expect(route).toMatch(/generation_started_at: new Date\(\)\.toISOString\(\)/);
  });

  it("only ever lets a browser say a deck has finished", () => {
    // The route knows when writing began and so can time out its own claim; a
    // client cannot, and a client that could say "generating" could leave a
    // deck spinning with nothing able to disprove it.
    const actions = readFileSync(join(root, "src/lib/data/actions.ts"), "utf8");
    expect(actions).toMatch(/generationStatus: z\.literal\("ready"\)\.optional\(\)/);
  });
});
