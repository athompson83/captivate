import { describe, expect, it } from "vitest";
import { layoutFor } from "@/lib/narrative/generate";
import { drawableScenes } from "@/lib/editor/place-drawing";
import { composeScene } from "@/lib/editor/layouts";

/**
 * The contradiction that shipped a deck with empty picture slots.
 *
 * The generation pipeline fills empty *side* slots with staged drawings and
 * deliberately skips media-full (line art under a heading is noise). But
 * `layoutFor` routed the "imagery" intent — the most visual moments of the
 * deck — to media-full, so exactly those scenes were guaranteed to arrive
 * with nothing in them. The owner's live deck had two empty slots; both were
 * media-full; zero drawing calls were even attempted.
 *
 * The invariant this pins spans the two modules: whatever layout imagery
 * maps to, a scene built from it with an imagePrompt must be one the
 * drawing pass will pick up.
 */
describe("imagery moments get drawable layouts", () => {
  it("routes imagery to a side-by-side, alternating", () => {
    expect(layoutFor("imagery", "example", 0)).toBe("split-right");
    expect(layoutFor("imagery", "example", 1)).toBe("split-left");
  });

  it("produces scenes the drawing pass actually selects", () => {
    const scenes = [0, 1].map((index) => ({
      content: composeScene(layoutFor("imagery", "example", index), {
        heading: "The picture",
        media: { url: "", alt: "a mechanism, drawn" },
      }),
      imagePrompt: "a mechanism, drawn",
    }));
    expect(drawableScenes(scenes)).toHaveLength(2);
  });
});
