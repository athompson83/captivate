import { describe, expect, it } from "vitest";
import {
  GeneratedScene,
  GeneratedScenes,
  ProposedMap,
  RewriteResult,
  REWRITE_LABELS,
} from "@/lib/ai/schemas";
import {
  deriveTitle,
  fallbackRewrite,
  fallbackScene,
  keywords,
  subjectOf,
} from "@/lib/ai/fallback";
import { fallbackMap } from "@/lib/ai/narrative-fallback";
import { layoutFor } from "@/lib/narrative/generate";
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

describe("proposed map schema", () => {
  const proposal = {
    title: "Shock",
    movements: [
      {
        label: "OPEN",
        title: "Why this matters",
        purpose: "Earn attention.",
        moments: [
          {
            title: "The call",
            role: "hook",
            purpose: "Start where they live.",
            takeaway: "This is my job.",
          },
        ],
      },
      {
        label: "PROVE",
        title: "Why believe it",
        purpose: "Ground the claim.",
        moments: [
          {
            title: "The data",
            role: "evidence",
            purpose: "Show the support.",
            takeaway: "The claim holds.",
          },
        ],
      },
    ],
  };

  it("accepts a minimal proposal and fills its defaults", () => {
    const parsed = ProposedMap.parse(proposal);
    expect(parsed.suggestedThemeId).toBe("midnight");
    expect(parsed.movements[0].weight).toBe(1);
    expect(parsed.movements[0].moments[0].visualIntent).toBe("auto");
    expect(parsed.movements[0].moments[0].evidenceIds).toEqual([]);
  });

  it("refuses a one-movement argument", () => {
    // A single movement is a list of beats, not a shape. The point of the map
    // is that the argument has parts that do different jobs.
    const one = { ...proposal, movements: [proposal.movements[0]] };
    expect(ProposedMap.safeParse(one).success).toBe(false);
  });

  it("rejects a movement with no moments", () => {
    const empty = {
      ...proposal,
      movements: [{ ...proposal.movements[0], moments: [] }, proposal.movements[1]],
    };
    expect(ProposedMap.safeParse(empty).success).toBe(false);
  });

  it("requires a purpose and a takeaway on every moment", () => {
    // These two fields are the whole difference between a map and an outline.
    for (const field of ["purpose", "takeaway"]) {
      const stripped = structuredClone(proposal) as typeof proposal;
      const moment = stripped.movements[0].moments[0] as Record<string, unknown>;
      moment[field] = "";
      expect(ProposedMap.safeParse(stripped).success, field).toBe(false);
    }
  });

  it("caps movements and moments per movement", () => {
    const many = Array.from({ length: 9 }, () => proposal.movements[0]);
    expect(ProposedMap.safeParse({ ...proposal, movements: many }).success).toBe(false);

    const crowded = {
      ...proposal,
      movements: [
        {
          ...proposal.movements[0],
          moments: Array.from({ length: 11 }, () => proposal.movements[0].moments[0]),
        },
        proposal.movements[1],
      ],
    };
    expect(ProposedMap.safeParse(crowded).success).toBe(false);
  });

  it("refuses an invented role", () => {
    const bogus = structuredClone(proposal) as typeof proposal;
    (bogus.movements[0].moments[0] as Record<string, unknown>).role = "razzle";
    expect(ProposedMap.safeParse(bogus).success).toBe(false);
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
    const title = deriveTitle(
      "Create a presentation about recognising compensated shock in paediatric patients",
    );
    expect(title.toLowerCase()).toContain("recognising");
    expect(title.toLowerCase()).not.toContain("create a presentation");
  });

  it("produces a map that satisfies the real schema", () => {
    const map = fallbackMap("Teach the basics of capnography", "Capnography", "capnography");
    expect(ProposedMap.safeParse(map).success).toBe(true);
  });

  it("varies compositions rather than emitting a wall of bullet scenes", () => {
    const map = fallbackMap("A lecture on six different mechanisms", "Mechanisms", null);
    const layouts = map.movements
      .flatMap((movement) => movement.moments)
      .map((moment, index) => layoutFor(moment.visualIntent, moment.role, index));
    expect(new Set(layouts).size).toBeGreaterThan(2);
  });

  it("produces scenes that compose into valid scene content", () => {
    const map = fallbackMap("Airway management", "Airway management", "airway");
    const beats = map.movements.flatMap((movement) => movement.moments);

    beats.forEach((beat, index) => {
      const layout = layoutFor(beat.visualIntent, beat.role, index);
      const generated = fallbackScene(
        { title: beat.title, purpose: beat.purpose, layout },
        { title: map.title, prompt: "" },
      );
      expect(GeneratedScene.safeParse(generated).success, layout).toBe(true);

      const content = composeScene(generated.layout, {
        heading: generated.heading || undefined,
        bullets: generated.bullets.length ? generated.bullets : undefined,
        quote: generated.quote || undefined,
        cards: generated.cards.length ? generated.cards : undefined,
        chart: generated.chart ?? undefined,
        code: generated.code ?? undefined,
      });
      expect(SceneContent.safeParse(content).success, layout).toBe(true);
    });
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
    expect(ProposedMap.safeParse(fallbackMap("", "Untitled", null)).success).toBe(true);
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
    const title = deriveTitle(prompt);
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

  it("gives every moment a title a human would recognise as a beat", () => {
    const map = fallbackMap(
      "A 50-minute lecture on recognising and managing compensated shock",
      "Compensated shock",
      "shock",
    );
    const titles = map.movements.flatMap((movement) =>
      movement.moments.map((moment) => moment.title),
    );

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
      expect(deriveTitle(prompt).length, JSON.stringify(prompt)).toBeGreaterThan(0);
    }
  });
});

describe("subject extraction", () => {
  it("never treats a duration as the subject", () => {
    // "Focus on 45-minute." appeared in every movement purpose: a measurement
    // ties on frequency with every other word and wins the alphabetical
    // tie-break, so it was always the top keyword.
    for (const prompt of [
      "A 45-minute lecture on recognising compensated shock in paediatric patients",
      "90 minute workshop about capnography",
      "A 2-hour session on the sepsis six",
    ]) {
      const [top] = keywords(prompt, 1);
      expect(top, prompt).toBeDefined();
      expect(top, prompt).not.toMatch(/\d/);
    }
  });

  it("finds the actual subject", () => {
    expect(keywords("A 45-minute lecture on capnography waveforms", 2)).toContain("capnography");
  });

  it("names a subject only when the author repeated it", () => {
    // In a one-line brief nothing repeats, so the "top" keyword is whatever
    // wins an alphabetical tie-break. That produced "Focus on compensated."
    // in every movement purpose of a lecture about compensated shock.
    expect(subjectOf("A 45-minute lecture on recognising compensated shock")).toBeNull();
    expect(
      subjectOf("Sepsis recognition for paramedics. Cover sepsis screening and sepsis bundles."),
    ).toBe("sepsis");
  });

  it("weaves a real subject into the map's purposes, never a measurement", () => {
    const prompt = "Sepsis recognition for paramedics. Cover sepsis screening and sepsis bundles.";
    const map = fallbackMap(prompt, "Sepsis recognition", subjectOf(prompt));
    for (const movement of map.movements) {
      expect(movement.purpose).toContain("sepsis");
      expect(movement.purpose).not.toMatch(/\d/);
    }
  });

  it("leaves the purposes alone when there is no confident subject", () => {
    const prompt = "A 45-minute lecture on recognising compensated shock";
    const map = fallbackMap(prompt, "Compensated shock", subjectOf(prompt));
    for (const movement of map.movements) expect(movement.purpose).not.toMatch(/Focus on/);
  });
});
