import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_STYLES,
  DEFAULT_THEME_ID,
  PresentationTheme,
  THEMES,
  getTheme,
  resolveColor,
  stageBackgroundCss,
  themeCssVars,
} from "@/lib/schema/theme";
import { detectSupport, sanitiseFilename } from "@/lib/record/recorder";
import { contrastRatio, toOklab } from "@/lib/utils/color";
import { MIN_CONTRAST } from "@/lib/analysis/health";

/** Perceptual distance between two hex colours, in OKLab. */
function oklabDistance(a: string, b: string): number {
  const x = toOklab(a);
  const y = toOklab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}
import { TEMPLATES, buildTemplateScenes, getTemplate } from "@/lib/templates/registry";
import { SceneContent } from "@/lib/schema/presentation";

describe("themes", () => {
  it("every theme satisfies its own schema", () => {
    for (const theme of THEMES) {
      expect(PresentationTheme.safeParse(theme).success, theme.id).toBe(true);
    }
  });

  it("has unique ids and includes the default", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_THEME_ID);
  });

  it("falls back to the first theme for an unknown id", () => {
    expect(getTheme("does-not-exist").id).toBe(THEMES[0].id);
    expect(getTheme(null).id).toBe(THEMES[0].id);
    expect(getTheme(undefined).id).toBe(THEMES[0].id);
  });

  it("resolves token references against the active theme", () => {
    const theme = getTheme("paper");
    expect(resolveColor({ kind: "token", token: "accent" }, theme)).toBe(theme.tokens.accent);
    expect(resolveColor({ kind: "hex", hex: "#ABCDEF" }, theme)).toBe("#ABCDEF");
  });

  it("falls back rather than rendering undefined for an unknown token", () => {
    const theme = getTheme("paper");
    expect(resolveColor({ kind: "token", token: "nonsense" }, theme)).toBe(theme.tokens.ink);
    expect(resolveColor(null, theme, "accent")).toBe(theme.tokens.accent);
  });

  it("exposes every token as a CSS variable", () => {
    const vars = themeCssVars(getTheme("midnight"));
    for (const key of ["--stage-canvas", "--stage-ink", "--stage-accent", "--stage-font-display"]) {
      expect(vars[key]).toBeTruthy();
    }
  });

  it("produces a background for every background style", () => {
    for (const theme of THEMES) {
      expect(stageBackgroundCss(theme), theme.id).toBeTruthy();
    }
  });

  it("keeps every shipped palette above the bar the app itself measures", () => {
    // This used to assert only that ink and canvas were different *strings*,
    // which a theme at 1.2:1 passes comfortably. `health.ts` scores a deck's
    // contrast against MIN_CONTRAST and marks it down below that, so a palette
    // that ships under the bar puts a permanent warning on every deck using
    // it — and picking a theme from the product's own picker is not something
    // an author should be marked down for. The threshold is imported rather
    // than restated so the two cannot drift.
    for (const theme of THEMES) {
      const ink = contrastRatio(theme.tokens.ink, theme.tokens.canvas);
      const accent = contrastRatio(theme.tokens.accent, theme.tokens.canvas);
      const onAccent = contrastRatio(theme.tokens.onAccent, theme.tokens.accent);

      expect(ink, `${theme.id} ink on canvas`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(accent, `${theme.id} accent on canvas`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      // Text sitting *on* the accent — a button, a filled callout — is the
      // pairing the two checks above never look at.
      expect(onAccent, `${theme.id} onAccent on accent`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("handles every background style it offers, rather than falling through to flat", () => {
    // The switch in `stageBackgroundCss` has a default arm that returns the
    // canvas colour. That is right for `flat` and silent for a style added to
    // the enum and forgotten in the switch — the theme would simply look
    // undesigned, with nothing failing anywhere.
    const flat = getTheme("field");
    for (const style of BACKGROUND_STYLES) {
      const painted = stageBackgroundCss({ ...flat, backgroundStyle: style });
      if (style === "flat") continue;
      expect(painted, `${style} is not handled`).not.toBe(flat.tokens.canvas);
    }
  });

  it("layers the deep backgrounds over the canvas rather than replacing it", () => {
    // `bloom` and `mesh` are several washes *plus* the canvas underneath. A
    // simplification that dropped the final colour would leave the stage
    // transparent, which on the world canvas means the page shows through.
    for (const style of ["bloom", "mesh"] as const) {
      const theme = { ...getTheme("midnight"), backgroundStyle: style };
      const painted = stageBackgroundCss(theme);
      expect(painted.split("radial-gradient").length - 1, style).toBeGreaterThanOrEqual(3);
      expect(painted.endsWith(theme.tokens.canvas), `${style} must end on the canvas`).toBe(true);
      // Built from tokens, never from a literal colour, so re-theming moves
      // the ground with the text.
      expect(painted).toContain(theme.tokens.accent);
    }
  });

  /**
   * Contrast, measured rather than eyeballed.
   *
   * "Not the same hex" is not a legibility guarantee — it passes for grey on
   * grey. These are WCAG ratios on relative luminance, which is the right
   * measure for a threshold (OKLab lightness is right for blending and wrong
   * here; a number that looks like a contrast ratio and is not one is worse
   * than no number).
   */
  describe("legibility", () => {
    it("clears AAA for body text on the canvas, in every theme", () => {
      for (const theme of THEMES) {
        expect(
          contrastRatio(theme.tokens.ink, theme.tokens.canvas),
          theme.id,
        ).toBeGreaterThanOrEqual(7);
      }
    });

    it("clears AA for muted text, which is still read from the back of a room", () => {
      for (const theme of THEMES) {
        expect(
          contrastRatio(theme.tokens.inkMuted, theme.tokens.canvas),
          theme.id,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("clears large-text AA for the accent, which headings and marks use", () => {
      for (const theme of THEMES) {
        expect(
          contrastRatio(theme.tokens.accent, theme.tokens.canvas),
          theme.id,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it("keeps text on the accent readable, since that is a filled control", () => {
      for (const theme of THEMES) {
        expect(
          contrastRatio(theme.tokens.onAccent, theme.tokens.accent),
          theme.id,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps ink readable on the secondary surface too", () => {
      // Callouts, cards and code blocks sit on `surface`, not on `canvas`.
      for (const theme of THEMES) {
        expect(
          contrastRatio(theme.tokens.ink, theme.tokens.surface),
          theme.id,
        ).toBeGreaterThanOrEqual(7);
      }
    });
  });

  /**
   * The curation bar, as a test.
   *
   * The set exists to be picked from in five seconds. That fails in two ways:
   * too few points of view, and two themes nobody can tell apart.
   */
  describe("the set as a whole", () => {
    it("offers both a dark and a light theme, because the room decides", () => {
      const modes = new Set(THEMES.map((theme) => theme.mode));
      expect(modes).toEqual(new Set(["dark", "light"]));
      expect(THEMES.filter((t) => t.mode === "dark").length).toBeGreaterThanOrEqual(3);
      expect(THEMES.filter((t) => t.mode === "light").length).toBeGreaterThanOrEqual(3);
    });

    it("has no two themes a person could not tell apart", () => {
      // Same mode, near-identical canvas and accent is two entries doing one
      // job — which is how a curated list quietly becomes a long one.
      for (const a of THEMES) {
        for (const b of THEMES) {
          if (a.id >= b.id || a.mode !== b.mode) continue;
          // Measured in OKLab, not as a contrast ratio. A ratio sees only
          // luminance, and Midnight's amber against Signal's mint is two
          // obviously different colours with nearly the same luminance — the
          // ratio calls them identical. Perceptual difference is exactly what
          // OKLab distance is for, which is the mirror of the rule that a
          // contrast *threshold* must not be taken from OKLab lightness.
          const sameGround = oklabDistance(a.tokens.canvas, b.tokens.canvas) < 0.04;
          const sameAccent = oklabDistance(a.tokens.accent, b.tokens.accent) < 0.04;
          expect(sameGround && sameAccent, `${a.id} and ${b.id}`).toBe(false);
        }
      }
    });

    it("says what each theme is for, not what it looks like", () => {
      for (const theme of THEMES) {
        expect(theme.description.length, theme.id).toBeGreaterThan(30);
        expect(theme.name.length, theme.id).toBeLessThan(20);
      }
    });
  });
});

describe("templates", () => {
  it("every template builds scenes that satisfy the scene schema", () => {
    for (const template of TEMPLATES) {
      const scenes = buildTemplateScenes(template, "My presentation");
      expect(scenes.length, template.id).toBe(template.scenes.length);

      for (const scene of scenes) {
        expect(SceneContent.safeParse(scene.content).success, `${template.id}/${scene.title}`).toBe(
          true,
        );
        expect(scene.content.elements.length, `${template.id}/${scene.title}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The curation bar for templates, which is a different bar from themes.
   *
   * A theme is a look; a template is an *argument shape*. Two templates that
   * propose the same sequence of beats are one template with two names, and a
   * template whose every scene is a bulleted list has failed at the only thing
   * it is for.
   */
  describe("the set as a whole", () => {
    it("names who each one is for, and has unique ids", () => {
      const ids = TEMPLATES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const template of TEMPLATES) {
        expect(template.audience.length, template.id).toBeGreaterThan(8);
        expect(template.description.length, template.id).toBeGreaterThan(30);
      }
    });

    it("varies its layouts — a deck of bulleted lists has failed", () => {
      for (const template of TEMPLATES) {
        if (template.id === "blank") continue;
        const layouts = template.scenes.map((scene) => scene.layout);
        const distinct = new Set(layouts).size;
        expect(distinct, template.id).toBeGreaterThanOrEqual(4);
        // No single layout may be more than half the deck.
        for (const layout of new Set(layouts)) {
          const share = layouts.filter((l) => l === layout).length / layouts.length;
          expect(share, `${template.id}/${layout}`).toBeLessThanOrEqual(0.5);
        }
      }
    });

    it("proposes a shape, not just a look: no two share a movement sequence", () => {
      const sequences = new Map<string, string>();
      for (const template of TEMPLATES) {
        if (template.id === "blank") continue;
        // Consecutive duplicates collapse: two scenes in one movement are one
        // beat of the argument, not two.
        const movements = template.scenes
          .map((scene) => scene.movement)
          .filter((movement, index, all) => movement !== all[index - 1])
          .join(" → ");
        const already = sequences.get(movements);
        expect(already, `${template.id} repeats ${already}'s shape`).toBeUndefined();
        sequences.set(movements, template.id);
      }
    });

    it("names a theme that exists, so a template cannot open on the fallback", () => {
      const themeIds = new Set(THEMES.map((theme) => theme.id));
      for (const template of TEMPLATES) {
        expect(themeIds.has(template.themeId), `${template.id} → ${template.themeId}`).toBe(true);
      }
    });

    it("gives every scene a movement, or the map has nothing to show", () => {
      for (const template of TEMPLATES) {
        for (const scene of template.scenes) {
          expect(scene.movement.length, `${template.id}/${scene.title}`).toBeGreaterThan(0);
        }
      }
    });

    it("covers both a talk and a document-shaped session", () => {
      // The set exists because a lecture, a briefing and a workshop are
      // genuinely different arguments — if they all look like a lecture, one
      // template would do.
      const audiences = TEMPLATES.map((t) => t.audience.toLowerCase()).join(" ");
      expect(audiences).toMatch(/educator|teaching/);
      expect(audiences).toMatch(/engineer|technical/);
      expect(audiences).toMatch(/research/);
    });
  });

  it("substitutes the chosen title into the opening scene", () => {
    const scenes = buildTemplateScenes(TEMPLATES[0], "Recognising Shock");
    const text = JSON.stringify(scenes[0].content);
    expect(text).toContain("Recognising Shock");
    expect(text).not.toContain("{{TITLE}}");
  });

  it("falls back to a placeholder title when given an empty one", () => {
    const scenes = buildTemplateScenes(TEMPLATES[0], "   ");
    expect(JSON.stringify(scenes[0].content)).not.toContain("{{TITLE}}");
  });

  it("ships a worked example that is genuinely finished", () => {
    const example = getTemplate("example");
    expect(example).toBeDefined();
    expect(example!.scenes.length).toBeGreaterThanOrEqual(10);

    // Finished means written: every scene carries speakable notes, and none
    // of the content is a prompt left for the author to fill in.
    for (const scene of example!.scenes) {
      expect(scene.speakerNotes.length, scene.title).toBeGreaterThan(40);
    }
    const text = JSON.stringify(example!.scenes.map((s) => s.content));
    expect(text).not.toMatch(/\{\{(?!TITLE)/);

    // The map's movements must be movements the scenes actually visit, or
    // creation would file the example's moments under orphaned sections.
    const sceneMovements = new Set(example!.scenes.map((s) => s.movement));
    for (const movement of example!.shape ?? []) {
      expect(sceneMovements.has(movement.label), movement.label).toBe(true);
    }
  });

  it("ships speaker notes with every template scene that teaches something", () => {
    const lecture = TEMPLATES.find((t) => t.id === "lecture")!;
    const withNotes = lecture.scenes.filter((s) => s.speakerNotes.trim().length > 0);
    expect(withNotes.length).toBe(lecture.scenes.length);
  });

  it("references only real theme ids", () => {
    const ids = new Set(THEMES.map((t) => t.id));
    for (const template of TEMPLATES) {
      expect(ids.has(template.themeId), template.id).toBe(true);
    }
  });

  it("looks templates up by id", () => {
    expect(getTemplate("lecture")?.name).toBe("Lecture");
    expect(getTemplate("nope")).toBeUndefined();
  });
});

describe("recorder capability detection", () => {
  it("reports unsupported, with a reason, when MediaRecorder is missing", () => {
    const original = globalThis.MediaRecorder;
    // @ts-expect-error deliberately removing the API to test the fallback path
    delete globalThis.MediaRecorder;

    const support = detectSupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toMatch(/MediaRecorder/i);

    if (original) globalThis.MediaRecorder = original;
  });

  it("reports unsupported when screen capture is unavailable", () => {
    const originalRecorder = globalThis.MediaRecorder;
    globalThis.MediaRecorder = Object.assign(vi.fn(), {
      isTypeSupported: () => true,
    }) as unknown as typeof MediaRecorder;

    const originalDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });

    const support = detectSupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toMatch(/screen/i);

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalDevices,
      configurable: true,
    });
    if (originalRecorder) globalThis.MediaRecorder = originalRecorder;
    else delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  });

  it("picks a supported container and matching extension", () => {
    const originalRecorder = globalThis.MediaRecorder;
    const originalDevices = navigator.mediaDevices;

    globalThis.MediaRecorder = Object.assign(vi.fn(), {
      isTypeSupported: (type: string) => type.startsWith("video/webm"),
    }) as unknown as typeof MediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getDisplayMedia: vi.fn() },
      configurable: true,
    });

    const support = detectSupport();
    expect(support.supported).toBe(true);
    expect(support.mimeType).toContain("webm");
    expect(support.extension).toBe("webm");

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalDevices,
      configurable: true,
    });
    if (originalRecorder) globalThis.MediaRecorder = originalRecorder;
    else delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  });

  it("reports mp4 when the browser prefers it", () => {
    const originalRecorder = globalThis.MediaRecorder;
    const originalDevices = navigator.mediaDevices;

    globalThis.MediaRecorder = Object.assign(vi.fn(), {
      isTypeSupported: (type: string) => type.startsWith("video/mp4"),
    }) as unknown as typeof MediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getDisplayMedia: vi.fn() },
      configurable: true,
    });

    const support = detectSupport();
    expect(support.extension).toBe("mp4");

    Object.defineProperty(navigator, "mediaDevices", {
      value: originalDevices,
      configurable: true,
    });
    if (originalRecorder) globalThis.MediaRecorder = originalRecorder;
    else delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  });
});

describe("sanitiseFilename", () => {
  it("strips characters that break downloads", () => {
    expect(sanitiseFilename('My deck: "shock" / 2026')).not.toMatch(/[:"/]/);
  });

  it("replaces spaces and truncates", () => {
    expect(sanitiseFilename("a b c")).toBe("a-b-c");
    expect(sanitiseFilename("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("falls back to a usable name for empty input", () => {
    expect(sanitiseFilename("   ")).toBe("captivate-recording");
    expect(sanitiseFilename("///")).toBe("captivate-recording");
  });
});
