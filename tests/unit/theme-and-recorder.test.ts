import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_ID,
  PresentationTheme,
  THEMES,
  getTheme,
  resolveColor,
  stageBackgroundCss,
  themeCssVars,
} from "@/lib/schema/theme";
import { detectSupport, sanitiseFilename } from "@/lib/record/recorder";
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

  it("keeps ink and canvas visibly different in every theme", () => {
    // A theme whose text matches its background is unusable on a projector.
    for (const theme of THEMES) {
      expect(theme.tokens.ink.toLowerCase(), theme.id).not.toBe(theme.tokens.canvas.toLowerCase());
      expect(theme.tokens.accent.toLowerCase(), theme.id).not.toBe(
        theme.tokens.canvas.toLowerCase(),
      );
    }
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
