import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GeneratedScene, GeneratedScenes, sceneName } from "@/lib/ai/schemas";

/**
 * A whole deck must not be lost to a field the audience never sees.
 *
 * Read from the production ledger, 2026-09-06 16:47 and 16:48 — two decks in
 * a row, both refused:
 *
 *     write_scenes: - scenes.0.title: Invalid input: expected string, received undefined
 *                   - scenes.1.title: Invalid input: expected string, received undefined
 *                   … and so on for almost every scene
 *
 * The model wrote the whole deck. Every heading, every bullet, every speaker
 * note. It omitted `title`, which is the scene's name in the navigator and is
 * **never drawn on the stage** — and because the schema required it, all of
 * that work was thrown away and the author was handed structural placeholders
 * with a notice about the model not returning what was asked for.
 *
 * It omitted it because nothing ever asked for it. The system prompt lists,
 * layout by layout, exactly which fields to write into, and tells the model
 * that a scene "draws a fixed set of fields and shows nothing else". `title`
 * appears in none of those lists, because it is not drawn. The contract asked
 * the model to write the drawn fields and then rejected it for omitting an
 * undrawn one.
 *
 * So: the prompt now names it, and the schema no longer treats it as the
 * difference between a deck and no deck. A missing name is recoverable from
 * the content that *is* there; a missing card body is not, and still fails.
 */

const written = (over: Record<string, unknown> = {}) => ({
  layout: "statement",
  heading: "Ninety seconds without oxygen",
  speakerNotes: "Open on the clock, not the physiology.",
  ...over,
});

describe("a scene the model wrote but did not name", () => {
  it("is accepted rather than discarding the deck", () => {
    const parsed = GeneratedScene.safeParse(written());
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("is accepted across a whole deck, which is how it actually arrived", () => {
    const parsed = GeneratedScenes.safeParse({
      scenes: [written(), written({ heading: "The second beat" }), written({ layout: "takeaway" })],
    });
    expect(parsed.success).toBe(true);
  });

  it("still keeps a name the model did write", () => {
    expect(sceneName(written({ title: "Time to hypoxia" }))).toBe("Time to hypoxia");
  });
});

describe("naming a scene from what it says", () => {
  it("falls back to the heading, which every composed scene has", () => {
    expect(sceneName(written())).toBe("Ninety seconds without oxygen");
  });

  it("uses the quote where a pull-quote scene has no heading", () => {
    expect(sceneName({ heading: "", quote: "The pressure is the last thing to go." })).toBe(
      "The pressure is the last thing to go.",
    );
  });

  it("uses the eyebrow where a section beat carries only that", () => {
    expect(sceneName({ heading: "", eyebrow: "Movement 2" })).toBe("Movement 2");
  });

  it("is never empty, because a scene with no name cannot be navigated to", () => {
    expect(sceneName({ heading: "" }).length).toBeGreaterThan(0);
    expect(sceneName({}).length).toBeGreaterThan(0);
  });

  it("fits the column it is written into", () => {
    const long = "x".repeat(400);
    expect(sceneName({ heading: long }).length).toBeLessThanOrEqual(120);
  });

  it("does not name a scene after whitespace", () => {
    expect(sceneName({ title: "   ", heading: "The real heading" })).toBe("The real heading");
  });
});

describe("the prompt asks for what the schema wants", () => {
  it("names `title` in the scenes brief", () => {
    // The defect was a contract that asked for the drawn fields and refused
    // the answer for omitting an undrawn one. Reading the source because the
    // claim is about two files agreeing, which neither one can show alone.
    const service = readFileSync(join(__dirname, "..", "..", "src/lib/ai/service.ts"), "utf8");
    const asked = service.indexOf("naming it in the presenter's own navigator");
    const fieldList = service.indexOf("Each layout draws a fixed set of fields");
    expect(asked, "the scenes brief should ask for a title").toBeGreaterThan(-1);
    // Before the per-layout field list, which is what the model reads as the
    // exhaustive set and why it stopped writing one.
    expect(asked).toBeLessThan(fieldList);
  });
});

describe("what is still refused", () => {
  it("refuses a card with no body, because that is a scene with a hole in it", () => {
    const parsed = GeneratedScene.safeParse(
      written({ layout: "three-up", cards: [{ title: "Skin", icon: "eye" }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses a layout it does not have", () => {
    expect(GeneratedScene.safeParse(written({ layout: "carousel" })).success).toBe(false);
  });

  it("accepts a scene that omits the layout too, rather than losing the deck", () => {
    // The deck route overrides the model's layout with the composer's own, so
    // a missing one there was never even read — and it could still refuse the
    // whole batch. The single-scene route gets a plain statement instead of an
    // error.
    const parsed = GeneratedScene.safeParse({ heading: "A line", speakerNotes: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.layout).toBe("statement");
  });
});
