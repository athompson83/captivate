import { describe, expect, it } from "vitest";
import {
  DrawingElement,
  DrawnPath,
  SceneElement,
  parseSceneContent,
} from "@/lib/schema/presentation";
import { buildStepCount } from "@/lib/present/motion";
import { forAudience } from "@/lib/present/audience";
import { createElement } from "@/lib/editor/element-factory";
import { GeneratedDrawing } from "@/lib/ai/schemas";
import type { Scene } from "@/lib/schema/presentation";

/**
 * The drawing element: a picture that sketches itself, one stage per advance.
 *
 * The security claim worth a test of its own: we store path *data*, never
 * markup, and the grammar admits only the SVG path language. Everything a
 * malicious `d` could try to be — script, a URL, an attribute escape — fails
 * the regex before it reaches the document, from the model and from a
 * hand-edited row alike.
 */

const drawing = () => createElement("drawing") as Extract<SceneElement, { type: "drawing" }>;

describe("path data grammar", () => {
  it("accepts real path data", () => {
    expect(DrawnPath.safeParse({ d: "M 10 10 L 90 90 C 1,2 3,4 5,6 Z", stage: 0 }).success).toBe(
      true,
    );
    expect(DrawnPath.safeParse({ d: "m-1.5e2,3 a25,25 -30 0,1 50,-25z" }).success).toBe(true);
  });

  it.each([
    ["script", "M 0 0 <script>alert(1)</script>"],
    ["a URL", "javascript:alert(1)"],
    ["an attribute escape", 'M 0 0" onload="alert(1)'],
    ["markup", "<path d='M 0 0'/>"],
    ["empty", ""],
  ])("rejects %s", (_label, d) => {
    expect(DrawnPath.safeParse({ d, stage: 0 }).success).toBe(false);
  });

  it("caps stage where the step machinery caps", () => {
    expect(DrawnPath.safeParse({ d: "M 0 0", stage: 20 }).success).toBe(false);
    expect(DrawnPath.safeParse({ d: "M 0 0", stage: -1 }).success).toBe(false);
  });
});

describe("stages are build steps", () => {
  it("counts a drawing's stages exactly as a staggered list counts items", () => {
    const el = drawing(); // The factory sample has stages 0, 1, 2.
    expect(buildStepCount([el])).toBe(3);
  });

  it("costs nothing when every path is stage 0", () => {
    const el = { ...drawing(), paths: [{ d: "M 0 0 L 1 1", stage: 0 }] };
    expect(buildStepCount([el])).toBe(1);
  });

  it("adds to other builds in the same scene rather than replacing them", () => {
    const el = drawing();
    const advanced = {
      ...createElement("text"),
      animation: { ...el.animation, onAdvance: true },
    };
    expect(buildStepCount([el, advanced])).toBe(4);
  });
});

describe("the audience boundary", () => {
  const scene = (element: SceneElement): Scene =>
    ({
      id: "s1",
      presentationId: "p1",
      sectionId: null,
      position: 0,
      title: "Scene",
      content: { version: 2, layout: "custom", elements: [element], background: null },
      placement: null,
      momentId: null,
      speakerNotes: "private",
      durationSeconds: null,
      flowRole: "main",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }) as unknown as Scene;

  it("strips the stage labels and the prompt, keeping the picture", () => {
    const el = { ...drawing(), prompt: "the author's prompt" };
    const [sent] = forAudience([scene(el)]);
    const sentEl = sent.content.elements[0] as Extract<SceneElement, { type: "drawing" }>;
    expect(sentEl.paths).toEqual(el.paths);
    expect(sentEl.viewBox).toEqual(el.viewBox);
    expect(sentEl.stageLabels).toEqual([]);
    expect(sentEl.prompt).toBe("");
  });

  it("leaves scenes without drawings untouched, by identity", () => {
    const s = scene(createElement("text"));
    const [sent] = forAudience([s]);
    expect(sent.content).toBe(s.content);
  });
});

describe("salvage", () => {
  it("drops one corrupt path rather than the picture", () => {
    const el = drawing();
    const corrupted = {
      ...el,
      paths: [...el.paths, { d: "<script>alert(1)</script>", stage: 0 }],
    };
    const { content, recovered } = parseSceneContent({
      version: 2,
      layout: "custom",
      elements: [corrupted],
      background: null,
    });
    expect(recovered).toBe(true);
    const saved = content.elements[0] as Extract<SceneElement, { type: "drawing" }>;
    expect(saved.type).toBe("drawing");
    expect(saved.paths).toHaveLength(el.paths.length);
  });

  it("drops the element rather than the scene when nothing survives", () => {
    const el = { ...drawing(), paths: [{ d: "<script/>", stage: 0 }] };
    const other = createElement("text");
    const { content, recovered } = parseSceneContent({
      version: 2,
      layout: "custom",
      elements: [el, other],
      background: null,
    });
    expect(recovered).toBe(true);
    expect(content.elements.map((e) => e.type)).toEqual(["text"]);
  });
});

describe("generated drawings pass the same boundary as user input", () => {
  it("accepts a well-formed generation", () => {
    const result = GeneratedDrawing.safeParse({
      viewBox: { width: 800, height: 500 },
      paths: [
        { d: "M 100 100 L 700 100", stage: 0 },
        { d: "M 100 200 L 700 200", stage: 1 },
      ],
      stageLabels: ["The baseline", "The comparison"],
      alt: "Two horizontal lines",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a generation smuggling markup in a path", () => {
    const result = GeneratedDrawing.safeParse({
      viewBox: { width: 800, height: 500 },
      paths: [{ d: 'M 0 0" onload="x', stage: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("the inserted element", () => {
  it("is valid against its own schema, with staged sample paths", () => {
    const el = drawing();
    const parsed = DrawingElement.safeParse(el);
    expect(parsed.success).toBe(true);
    expect(new Set(el.paths.map((p) => p.stage)).size).toBeGreaterThan(1);
    expect(el.alt).not.toBe("");
  });
});
