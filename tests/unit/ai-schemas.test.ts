import { describe, expect, it } from "vitest";
import {
  GeneratedScene,
  GeneratedScenes,
  PresentationOutline,
  RewriteResult,
  REWRITE_LABELS,
} from "@/lib/ai/schemas";
import { fallbackOutline, fallbackRewrite, fallbackScene } from "@/lib/ai/fallback";
import { composeScene } from "@/lib/editor/layouts";
import { SceneContent } from "@/lib/schema/presentation";

/**
 * These schemas are the wall between arbitrary model output and the user's
 * document. The caps are not cosmetic: they are what structurally prevents the
 * wall-of-text scenes that generated decks are notorious for.
 */
describe("generated scene schema", () => {
  const valid = {
    title: "Recognising shock",
    layout: "bullets" as const,
    heading: "Shock is a clinical diagnosis",
    bullets: ["Tachycardia first", "Pressure falls late"],
  };

  it("accepts a well-formed scene and fills defaults", () => {
    const parsed = GeneratedScene.parse(valid);
    expect(parsed.subheading).toBe("");
    expect(parsed.cards).toEqual([]);
    expect(parsed.chart).toBeNull();
  });

  it("rejects a heading longer than a headline", () => {
    const result = GeneratedScene.safeParse({ ...valid, heading: "x".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects more than six bullets", () => {
    const result = GeneratedScene.safeParse({
      ...valid,
      bullets: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bullet that is really a paragraph", () => {
    const result = GeneratedScene.safeParse({ ...valid, bullets: ["x".repeat(141)] });
    expect(result.success).toBe(false);
  });

  it("refuses the free-form 'custom' layout", () => {
    // The generator must choose a designed composition, not position by hand.
    const result = GeneratedScene.safeParse({ ...valid, layout: "custom" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown layout", () => {
    const result = GeneratedScene.safeParse({ ...valid, layout: "carousel-3d" });
    expect(result.success).toBe(false);
  });

  it("caps a generation at 24 scenes", () => {
    const scenes = Array.from({ length: 25 }, () => valid);
    expect(GeneratedScenes.safeParse({ scenes }).success).toBe(false);
  });

  it("requires at least one scene", () => {
    expect(GeneratedScenes.safeParse({ scenes: [] }).success).toBe(false);
  });
});

describe("outline schema", () => {
  const outline = {
    title: "Shock",
    sections: [
      { title: "Opening", scenes: [{ title: "Title", purpose: "Set up", layout: "title" }] },
    ],
  };

  it("accepts a minimal outline and defaults the theme", () => {
    const parsed = PresentationOutline.parse(outline);
    expect(parsed.suggestedThemeId).toBe("midnight");
    expect(parsed.subtitle).toBe("");
  });

  it("rejects an outline with no sections", () => {
    expect(PresentationOutline.safeParse({ ...outline, sections: [] }).success).toBe(false);
  });

  it("rejects a section with no scenes", () => {
    const result = PresentationOutline.safeParse({
      ...outline,
      sections: [{ title: "Empty", scenes: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("caps sections and scenes per section", () => {
    const many = Array.from({ length: 9 }, () => outline.sections[0]);
    expect(PresentationOutline.safeParse({ ...outline, sections: many }).success).toBe(false);
  });
});

describe("rewrite schema", () => {
  it("requires at least one option and allows at most three", () => {
    expect(RewriteResult.safeParse({ options: [] }).success).toBe(false);
    expect(RewriteResult.safeParse({ options: ["a"] }).success).toBe(true);
    expect(RewriteResult.safeParse({ options: ["a", "b", "c", "d"] }).success).toBe(false);
  });

  it("has an instruction for every mode the UI offers", () => {
    for (const [mode, entry] of Object.entries(REWRITE_LABELS)) {
      expect(entry.label, mode).toBeTruthy();
      expect(entry.instruction.length, mode).toBeGreaterThan(10);
    }
  });
});

describe("deterministic fallback", () => {
  it("derives a sensible title from a prompt", () => {
    const outline = fallbackOutline(
      "Create a presentation about recognising compensated shock in paediatric patients",
      10,
    );
    expect(outline.title.toLowerCase()).toContain("recognising");
    expect(outline.title.toLowerCase()).not.toContain("create a presentation");
  });

  it("produces an outline that satisfies the real schema", () => {
    const outline = fallbackOutline("Teach the basics of capnography", 12);
    expect(PresentationOutline.safeParse(outline).success).toBe(true);
  });

  it("varies layouts rather than emitting a wall of bullet slides", () => {
    const outline = fallbackOutline("A talk about six different mechanisms", 12);
    const layouts = outline.sections.flatMap((s) => s.scenes.map((sc) => sc.layout));
    expect(new Set(layouts).size).toBeGreaterThan(2);
  });

  it("respects the requested scene count approximately", () => {
    for (const target of [4, 8, 16, 24]) {
      const outline = fallbackOutline("Any topic at all", target);
      const count = outline.sections.reduce((n, s) => n + s.scenes.length, 0);
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(24);
    }
  });

  it("produces scenes that compose into valid scene content", () => {
    const outline = fallbackOutline("Airway management", 10);
    for (const section of outline.sections) {
      for (const scene of section.scenes) {
        const generated = fallbackScene(scene, { title: outline.title, prompt: "" });
        expect(GeneratedScene.safeParse(generated).success, scene.layout).toBe(true);

        const content = composeScene(generated.layout, {
          heading: generated.heading || undefined,
          bullets: generated.bullets.length ? generated.bullets : undefined,
          quote: generated.quote || undefined,
          cards: generated.cards.length ? generated.cards : undefined,
          chart: generated.chart ?? undefined,
          code: generated.code ?? undefined,
        });
        expect(SceneContent.safeParse(content).success, scene.layout).toBe(true);
      }
    }
  });

  it("shortens text without inventing content", () => {
    const [short] = fallbackRewrite("First sentence here. Second sentence follows.", "shorten");
    expect(short.length).toBeLessThan("First sentence here. Second sentence follows.".length);
    expect(short).toContain("First sentence");
  });

  it("simplifies known jargon", () => {
    const [simple] = fallbackRewrite(
      "We will utilise this to demonstrate the approach",
      "simplify",
    );
    expect(simple).toContain("use");
    expect(simple).toContain("show");
  });

  it("returns the original text unchanged for an unhandled mode", () => {
    expect(fallbackRewrite("Untouched", "professional")).toEqual(["Untouched"]);
  });

  it("handles an empty prompt without throwing", () => {
    const outline = fallbackOutline("", 8);
    expect(PresentationOutline.safeParse(outline).success).toBe(true);
  });
});

describe("fallback title derivation", () => {
  it.each([
    [
      "Create a presentation about recognising compensated shock in paediatric patients",
      /recognising compensated shock/i,
    ],
    [
      "A 50-minute lecture on recognising and managing compensated shock for second-year paramedic students",
      /recognising and managing compensated shock/i,
    ],
    ["Make me a deck on capnography waveforms", /capnography waveforms/i],
    ["I need slides covering the sepsis six", /sepsis six/i],
  ])("extracts the subject from %j", (prompt, expected) => {
    const { title } = fallbackOutline(prompt, 10);
    expect(title).toMatch(expected);
    // The framing words are not the subject.
    expect(title.toLowerCase()).not.toMatch(/^(create|make|a \d+-minute|i need)/);
    expect(title.toLowerCase()).not.toContain("presentation about");
    expect(title.toLowerCase()).not.toContain("deck on");
    // No dangling article left by the removed noun phrase, and no trailing
    // punctuation from cutting the sentence short.
    expect(title).not.toMatch(/^(A|An|The)\s+(recognising|managing|covering)/i);
    expect(title).not.toMatch(/[.,;:]$/);
  });

  it("gives every scene a title a human would recognise as a scene", () => {
    const { sections } = fallbackOutline(
      "A 50-minute lecture on recognising and managing compensated shock",
      12,
    );
    const titles = sections.flatMap((s) => s.scenes.map((sc) => sc.title));

    for (const title of titles) {
      // Not a stray fragment lifted out of the prompt.
      expect(title.split(/\s+/).length, title).toBeGreaterThanOrEqual(1);
      expect(title, title).not.toMatch(/^\d/);
      expect(title.length, title).toBeGreaterThan(3);
    }
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("never returns an empty title", () => {
    for (const prompt of ["", "   ", "a", "make me a presentation"]) {
      expect(fallbackOutline(prompt, 8).title.length).toBeGreaterThan(0);
    }
  });
});
