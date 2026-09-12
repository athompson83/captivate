import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GeneratedScene } from "@/lib/ai/schemas";

/**
 * A drawing is briefed as a drawing.
 *
 * The diagram compiler was handed the same prompt the photo search used, and
 * "a paramedic standing beside an ambulance, natural daylight" became a stick
 * figure in the accent beside a filled box. The scene writer now separates a
 * drawing brief — parts, names, relations — from the photograph's prompt, the
 * illustrator's brief teaches the richer forms and labels, and the dressing
 * pass draws only from a brief where photographs are available. Held to the
 * source, because the prompts are strings inside `service.ts`.
 */
const source = readFileSync("src/lib/ai/service.ts", "utf8");

describe("the drawing brief", () => {
  it("is a field the scene writer is asked for, empty by default", () => {
    expect(GeneratedScene.parse({}).drawingBrief).toBe("");
    expect(source).toContain("write a drawingBrief");
    expect(source).toContain("Leave drawingBrief empty where a photograph is the right picture");
  });

  it("tells the illustrator to draw the mechanism and teaches the forms and labels", () => {
    const brief = source.slice(source.indexOf("You compose one teaching diagram"));
    expect(brief).toContain("Draw the mechanism, never the photograph");
    for (const form of ["blob", "ring", "bar", "stack", "hatch", "dashed", "leader"]) {
      expect(brief, form).toContain(form);
    }
    expect(brief).toContain("Labels. Name what needs naming");
  });

  it("is what the drawing pass draws from, and a photograph's prompt only when nothing else can be a picture", () => {
    const pass = source.slice(source.indexOf("async function dressScenes"));
    expect(pass).toMatch(
      /scene\.drawingBrief\?\.trim\(\) \|\| \(stockAvailable \? "" : scene\.imagePrompt\)/,
    );
    expect(pass).toContain("generateDrawing(brief, presentationId)");
  });
});
