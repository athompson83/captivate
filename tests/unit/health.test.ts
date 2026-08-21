import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/analysis/health";
import { balance, estimateScene, formatDuration, pacingOf, wordsOn } from "@/lib/analysis/pacing";
import { contrastRatio, relativeLuminance } from "@/lib/utils/color";
import { composeScene } from "@/lib/editor/layouts";
import { JOURNEY_DEFAULTS } from "@/lib/schema/presentation";
import type { PresentationDocument, Scene, Section } from "@/lib/schema/presentation";

function scene(i: number, overrides: Partial<Scene> = {}): Scene {
  return {
    id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
    presentationId: "00000000-0000-4000-8000-000000000fff",
    sectionId: null,
    position: i,
    title: `Scene ${i}`,
    content: composeScene("statement", { heading: "A short claim" }),
    placement: null,
    speakerNotes: "",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function section(id: string, label: string): Section {
  return {
    id,
    presentationId: "00000000-0000-4000-8000-000000000fff",
    title: label,
    label,
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function doc(
  scenes: Scene[],
  sections: Section[] = [],
  themeId = "midnight",
): PresentationDocument {
  return {
    presentation: {
      id: "00000000-0000-4000-8000-000000000fff",
      ownerId: "00000000-0000-4000-8000-00000000000a",
      folderId: null,
      title: "Deck",
      description: "",
      themeId,
      themeOverrides: null,
      aspectRatio: "16:9",
      journey: JOURNEY_DEFAULTS,
      tags: [],
      isFavorite: false,
      thumbnailUrl: null,
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      lastOpenedAt: null,
    },
    sections,
    scenes,
  };
}

describe("counting what is on a scene", () => {
  it("counts words across every kind of text", () => {
    const content = composeScene("bullets", {
      heading: "Three things",
      bullets: ["First point here", "Second point", "Third"],
    });
    // Heading (2) + bullets (3 + 2 + 1).
    expect(wordsOn(content.elements)).toBe(8);
  });

  it("ignores hidden elements", () => {
    const content = composeScene("statement", { heading: "One two three four" });
    const hidden = { ...content, elements: content.elements.map((e) => ({ ...e, hidden: true })) };
    expect(wordsOn(hidden.elements)).toBe(0);
  });

  it("does not read code aloud word by word", () => {
    const content = composeScene("code", {
      heading: "Example",
      code: { code: "const a = 1; const b = 2; const c = 3;", language: "ts" },
    });
    // Only the heading counts; the code block is pointed at, not narrated.
    expect(wordsOn(content.elements)).toBe(1);
  });
});

describe("estimating time", () => {
  it("never returns less than a floor, however empty the scene", () => {
    expect(estimateScene(scene(0, { content: composeScene("statement", { heading: "" }) }))).toBe(
      8,
    );
  });

  it("grows with the amount to say", () => {
    const short = estimateScene(scene(0));
    const long = estimateScene(
      scene(1, {
        content: composeScene("bullets", {
          heading: "A longer scene",
          bullets: Array.from({ length: 6 }, (_, i) => `Point number ${i} with some words on it`),
        }),
      }),
    );
    expect(long).toBeGreaterThan(short * 2);
  });

  it("lets an authored rehearsal target win over the estimate", () => {
    const pacing = pacingOf([scene(0, { durationSeconds: 300 })], []);
    expect(pacing.scenes[0].seconds).toBe(300);
    expect(pacing.scenes[0].estimated).toBe(false);
    expect(pacing.anyAuthored).toBe(true);
  });

  it("estimates the scenes nobody has timed", () => {
    // The reason this exists: reporting a forty-minute lecture as two minutes
    // because only one scene has a number on it is worse than saying nothing.
    const pacing = pacingOf([scene(0, { durationSeconds: 60 }), scene(1)], []);
    expect(pacing.scenes[1].estimated).toBe(true);
    expect(pacing.totalSeconds).toBeGreaterThan(60);
  });

  it("rolls time up into movements, splitting repeated sections", () => {
    const scenes = [
      scene(0, { sectionId: "a" }),
      scene(1, { sectionId: "a" }),
      scene(2, { sectionId: "b" }),
      scene(3, { sectionId: "a" }),
    ];
    const pacing = pacingOf(scenes, [section("a", "OPEN"), section("b", "MIDDLE")]);
    expect(pacing.movements.map((m) => m.label)).toEqual(["OPEN", "MIDDLE", "OPEN"]);
    expect(pacing.movements[0].sceneCount).toBe(2);
    expect(pacing.movements.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1, 6);
  });

  it("survives an empty presentation", () => {
    const pacing = pacingOf([], []);
    expect(pacing.totalSeconds).toBe(0);
    expect(balance(pacing)).toBe(1);
  });
});

describe("balance", () => {
  const evenly = (shares: number[]) =>
    balance({
      scenes: [],
      totalSeconds: 100,
      anyAuthored: false,
      movements: shares.map((share, i) => ({
        sectionId: `s${i}`,
        label: `M${i}`,
        seconds: share * 100,
        sceneCount: 1,
        share,
      })),
    });

  it("is one when the time is spread evenly", () => {
    expect(evenly([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(1, 6);
    expect(evenly([0.5, 0.5])).toBeCloseTo(1, 6);
  });

  it("is zero when one movement takes everything", () => {
    expect(evenly([1, 0, 0, 0])).toBeCloseTo(0, 6);
  });

  it("stays between the extremes for a lopsided deck", () => {
    const score = evenly([0.6, 0.2, 0.2]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("does not call a single movement unbalanced", () => {
    expect(evenly([1])).toBe(1);
  });
});

describe("contrast", () => {
  it("matches the WCAG reference points", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 4);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 6);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0F1117", "#F5F6F8")).toBeCloseTo(contrastRatio("#F5F6F8", "#0F1117"), 9);
  });
});

describe("health", () => {
  it("does not call an empty presentation healthy", () => {
    // Most checks pass vacuously on an empty deck — "no scene is a wall of
    // text" is true and meaningless with no scenes — which scored it Good.
    const health = analyse(doc([]));
    expect(health.score).toBe(0);
    expect(health.grade).toBe("Needs work");
    expect(health.checks).toHaveLength(1);
    expect(health.checks[0].detail).toBe("No scenes yet.");
    expect(health.checks[0].fix).toBeTruthy();
  });

  it("scores a well-formed presentation well", () => {
    const scenes = [
      scene(0, { sectionId: "a", speakerNotes: "Open with the question." }),
      scene(1, { sectionId: "a", speakerNotes: "Land the stakes." }),
      scene(2, { sectionId: "b", speakerNotes: "The mechanism." }),
      scene(3, { sectionId: "b", speakerNotes: "The evidence." }),
      scene(4, { sectionId: "c", speakerNotes: "What to do." }),
      scene(5, { sectionId: "c", speakerNotes: "Close." }),
    ];
    const health = analyse(
      doc(scenes, [section("a", "OPEN"), section("b", "EVIDENCE"), section("c", "CLOSE")]),
    );
    expect(health.score).toBeGreaterThanOrEqual(85);
    expect(health.grade).toBe("Excellent");
  });

  it("names the movement that is eating the clock", () => {
    const scenes = [
      scene(0, { sectionId: "a", durationSeconds: 600 }),
      scene(1, { sectionId: "b", durationSeconds: 30 }),
      scene(2, { sectionId: "c", durationSeconds: 30 }),
    ];
    const check = analyse(
      doc(scenes, [section("a", "OPEN"), section("b", "MIDDLE"), section("c", "CLOSE")]),
    ).checks.find((c) => c.id === "pacing")!;

    expect(check.status).not.toBe("pass");
    expect(check.detail).toContain("OPEN");
    expect(check.fix).toBeTruthy();
  });

  it("flags a wall of text", () => {
    const wall = composeScene("bullets", {
      heading: "Everything at once",
      bullets: Array.from(
        { length: 8 },
        () => "A sentence that runs on with plenty of words in it",
      ),
    });
    const check = analyse(doc([scene(0, { content: wall })])).checks.find(
      (c) => c.id === "density",
    )!;
    expect(check.status).not.toBe("pass");
    expect(check.detail).toContain("1 scene");
  });

  it("counts undescribed media exactly", () => {
    const withMedia = composeScene("split-right", {
      heading: "A picture",
      media: { url: "https://example.com/a.png", alt: "" },
      bullets: ["One"],
    });
    const check = analyse(doc([scene(0, { content: withMedia })])).checks.find(
      (c) => c.id === "alt-text",
    )!;
    expect(check.status).not.toBe("pass");
    expect(check.detail).toContain("1 of 1");
  });

  it("reports the real contrast ratio of the chosen theme", () => {
    const check = analyse(doc([scene(0)], [], "midnight")).checks.find((c) => c.id === "contrast")!;
    expect(check.status).toBe("pass");
    // The number shown is the actual ratio, not a proxy for it.
    expect(check.detail).toMatch(/\d+\.\d:1/);
  });

  it("is the weighted mean of its checks and nothing else", () => {
    // The score has to be arguable. If it were a secret formula, none of the
    // detail lines would be worth reading.
    const health = analyse(doc([scene(0, { sectionId: "a" })], [section("a", "OPEN")]));
    const weight = health.checks.reduce((sum, c) => sum + c.weight, 0);
    const value = { pass: 1, warn: 0.5, fail: 0 };
    const expected = Math.round(
      (health.checks.reduce((sum, c) => sum + value[c.status] * c.weight, 0) / weight) * 100,
    );
    expect(health.score).toBe(expected);
  });

  it("gives every failing check something to do about it", () => {
    // A finding with no fix is a complaint.
    for (const document of [doc([]), doc([scene(0)]), doc([scene(0), scene(1)])]) {
      for (const check of analyse(document).checks) {
        if (check.status === "pass") continue;
        expect(check.fix, check.id).toBeTruthy();
      }
    }
  });
});

describe("formatting a duration", () => {
  it("reads the way a person would say it", () => {
    expect(formatDuration(45)).toBe("45 sec");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(1050)).toBe("17 min 30 sec");
    expect(formatDuration(0)).toBe("0 sec");
    expect(formatDuration(-5)).toBe("0 sec");
  });
});
