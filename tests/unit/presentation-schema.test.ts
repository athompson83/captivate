import { describe, expect, it } from "vitest";
import {
  SCENE_SCHEMA_VERSION,
  SceneContent,
  SceneElement,
  emptySceneContent,
  parseSceneContent,
  plainText,
  richText,
  sceneTextLength,
} from "@/lib/schema/presentation";

/**
 * The scene schema is the contract between the database, the editor, the stage
 * and the model. If it drifts, stored decks stop opening — so these tests are
 * about durability, not coverage.
 */
describe("scene content schema", () => {
  it("fills defaults for a minimal payload", () => {
    const content = SceneContent.parse({ elements: [] });
    expect(content.version).toBe(SCENE_SCHEMA_VERSION);
    expect(content.layout).toBe("custom");
    expect(content.background).toEqual({ kind: "theme" });
  });

  it("applies element defaults so partial elements are still valid", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "h1",
          type: "heading",
          frame: { x: 10, y: 10, w: 50, h: 20 },
          content: [{ text: "Hello" }],
        },
      ],
    });

    const element = content.elements[0];
    expect(element.type).toBe("heading");
    expect(element.frame.rotation).toBe(0);
    expect(element.hidden).toBe(false);
    expect(element.opacity).toBe(1);
    expect(element.animation.entrance).toBe("fade");
    if (element.type === "heading") {
      expect(element.level).toBe(1);
      expect(element.style.align).toBe("left");
    }
  });

  it("rejects an unknown element type rather than rendering it", () => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "iframe-of-doom",
      frame: { x: 0, y: 0, w: 10, h: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a frame that is wildly off stage", () => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "text",
      frame: { x: 9999, y: 0, w: 10, h: 10 },
      content: [{ text: "hi" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https link that is not a valid URL", () => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "text",
      frame: { x: 0, y: 0, w: 10, h: 10 },
      content: [{ text: "hi", href: "javascript:alert(1)" }],
    });
    expect(result.success).toBe(false);
  });

  it("caps the number of elements on a scene", () => {
    const tooMany = Array.from({ length: 61 }, (_, i) => ({
      id: `e${i}`,
      type: "text" as const,
      frame: { x: 0, y: 0, w: 10, h: 10 },
      content: [{ text: "x" }],
    }));
    expect(SceneContent.safeParse({ elements: tooMany }).success).toBe(false);
  });
});

describe("parseSceneContent recovery", () => {
  it("passes valid content through untouched", () => {
    const original = emptySceneContent("bullets");
    const { content, recovered } = parseSceneContent(original);
    expect(recovered).toBe(false);
    expect(content.layout).toBe("bullets");
  });

  it("salvages the valid elements from a partly corrupt scene", () => {
    // One good element, one with a broken discriminator. Losing the whole deck
    // because of a single bad element would be a far worse failure.
    const { content, recovered } = parseSceneContent({
      version: 1,
      layout: "custom",
      background: { kind: "theme" },
      transition: { type: "fade", duration: 0.6, direction: "left" },
      themeOverride: null,
      elements: [
        {
          id: "ok",
          type: "text",
          frame: { x: 1, y: 1, w: 10, h: 10 },
          content: [{ text: "kept" }],
        },
        { id: "bad", type: "not-a-type", frame: { x: 1, y: 1, w: 10, h: 10 } },
      ],
    });

    expect(recovered).toBe(true);
    expect(content.elements).toHaveLength(1);
    expect(content.elements[0].id).toBe("ok");
  });

  it("returns an empty scene for junk rather than throwing", () => {
    for (const junk of [null, undefined, 42, "nope", [], { elements: "no" }]) {
      const { content, recovered } = parseSceneContent(junk);
      expect(recovered).toBe(true);
      expect(content.elements).toEqual([]);
    }
  });
});

describe("text helpers", () => {
  it("round-trips rich text", () => {
    expect(plainText(richText("hello world"))).toBe("hello world");
  });

  it("measures scene text length across element types", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "a",
          type: "heading",
          frame: { x: 0, y: 0, w: 10, h: 10 },
          content: [{ text: "12345" }],
        },
        {
          id: "b",
          type: "list",
          frame: { x: 0, y: 0, w: 10, h: 10 },
          items: [[{ text: "abc" }], [{ text: "de" }]],
        },
      ],
    });
    expect(sceneTextLength(content)).toBe(10);
  });
});

describe("URL safety", () => {
  const frame = { x: 0, y: 0, w: 10, h: 10 };

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("rejects %s as a link target", (href) => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "text",
      frame,
      content: [{ text: "click me", href }],
    });
    expect(result.success).toBe(false);
  });

  it.each(["https://example.com/page", "http://example.com"])(
    "accepts %s as a link target",
    (href) => {
      const result = SceneElement.safeParse({
        id: "x",
        type: "text",
        frame,
        content: [{ text: "ok", href }],
      });
      expect(result.success).toBe(true);
    },
  );

  it("rejects a script-bearing embed URL", () => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "embed",
      frame,
      url: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("accepts the app's own asset route as a media source", () => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "image",
      frame,
      url: "/api/assets/00000000-0000-4000-8000-000000000001/content",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a protocol-relative media source", () => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "image",
      frame,
      url: "//evil.example.com/tracker.gif",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a script-bearing media source", () => {
    const result = SceneElement.safeParse({
      id: "x",
      type: "image",
      frame,
      url: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });
});
