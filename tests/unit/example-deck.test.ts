import { describe, expect, it } from "vitest";
import { EXAMPLE_TITLE, exampleDeck, exampleId } from "@/lib/marketing/example-deck";
import { buildStepCount } from "@/lib/present/motion";
import { getTheme } from "@/lib/schema/theme";

/**
 * The deck the landing page runs live is the shipped worked example, built
 * through the same machinery creation uses. It has to be a real deck: real
 * ids, sections its scenes actually belong to, a theme that resolves.
 */
describe("the worked example as a deck", () => {
  const deck = exampleDeck();

  it("has stable rows: the same ids and titles every time it is built", () => {
    // Element ids inside a scene are minted per composition, as they are for
    // any new deck; the rows a viewer navigates by are fixed.
    const again = exampleDeck();
    expect(again.scenes.map((s) => [s.id, s.title, s.sectionId])).toEqual(
      deck.scenes.map((s) => [s.id, s.title, s.sectionId]),
    );
    expect(again.sections.map((s) => s.id)).toEqual(deck.sections.map((s) => s.id));
    expect(exampleId(7)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is a whole talk, not a structure with prompts", () => {
    expect(deck.title).toBe(EXAMPLE_TITLE);
    expect(deck.scenes.length).toBeGreaterThanOrEqual(10);
    expect(deck.sections.length).toBeGreaterThanOrEqual(3);
    expect(deck.scenes.every((scene) => scene.content.elements.length > 0)).toBe(true);
  });

  it("gives every row a unique id and every scene a section that exists", () => {
    const ids = [...deck.scenes, ...deck.sections].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sectionIds = new Set(deck.sections.map((section) => section.id));
    for (const scene of deck.scenes) {
      expect(scene.sectionId).not.toBeNull();
      expect(sectionIds.has(scene.sectionId!)).toBe(true);
    }
  });

  it("resolves its theme and has something to build", () => {
    expect(getTheme(deck.themeId).id).toBe(deck.themeId);
    const steps = deck.scenes.map((scene) => buildStepCount(scene.content.elements));
    expect(steps.every((n) => n >= 1)).toBe(true);
  });
});
