import { describe, expect, it } from "vitest";
import { composeDeck } from "@/lib/narrative/compose";
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
  it("routes imagery to a side-by-side, alternating from the last one placed", () => {
    // Alternation is a property of the sequence, not of the index. Two
    // imagery beats running land on opposite sides; scenes in between them do
    // not silently flip the side, which is what keying off `index % 2` did.
    const sides = composeDeck([
      { role: "example", visualIntent: "imagery" },
      { role: "example", visualIntent: "imagery" },
    ]);
    expect(sides[0]).toBe("split-right");
    expect(sides[1]).toBe("split-left");
    expect(layoutFor("imagery", "example", 0)).toBe("split-right");
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
