import { describe, expect, it } from "vitest";
import { layoutFor } from "@/lib/narrative/generate";
import { composeScene } from "@/lib/editor/layouts";
import { fallbackScene } from "@/lib/ai/fallback";
import { GeneratedScene } from "@/lib/ai/schemas";
import { SceneContent } from "@/lib/schema/presentation";
import type { NarrativeRole } from "@/lib/schema/narrative";

/**
 * Where the point layouts come from.
 *
 * The model never chooses a layout; `layoutFor` does, from the moment's role,
 * its intent and its place in the argument. So whether a deck carries
 * take-home points, calls to action, figures and explanations is decided
 * here, before a word is written — and a deck of headings and bullets is
 * what this produced when every role mapped to a page.
 */

describe("the end of a movement hands over its point", () => {
  it("lands a movement-ending claim, evidence or example as a take-home", () => {
    for (const role of [
      "claim",
      "reframe",
      "synthesis",
      "evidence",
      "example",
    ] as NarrativeRole[]) {
      expect(layoutFor("auto", role, 5, { endsMovement: true }), role).toBe("takeaway");
    }
  });

  it("leaves a mid-movement beat where it was", () => {
    expect(layoutFor("auto", "synthesis", 5, { endsMovement: false })).not.toBe("takeaway");
    expect(layoutFor("auto", "synthesis", 5)).not.toBe("takeaway");
  });

  it("still yields to an intent the author stated", () => {
    // A comparison that closes a movement is a comparison.
    expect(layoutFor("comparison", "claim", 5, { endsMovement: true })).toBe("two-column");
    expect(layoutFor("data", "evidence", 5, { endsMovement: true })).toBe("chart");
  });

  it("does not turn a transition or a hook into a take-home", () => {
    expect(layoutFor("auto", "transition", 5, { endsMovement: true })).toBe("section");
    expect(layoutFor("auto", "hook", 5, { endsMovement: true })).toBe("statement");
  });
});

describe("roles that are points rather than pages", () => {
  it("makes an application and a close a call to action", () => {
    expect(layoutFor("auto", "application", 8)).toBe("action");
    expect(layoutFor("auto", "close", 11)).toBe("action");
  });

  it("gives context a plain explanation with a picture", () => {
    expect(layoutFor("auto", "context", 2)).toBe("explainer");
  });

  it("alternates evidence between one number and a chart", () => {
    expect(layoutFor("auto", "evidence", 4)).toBe("figure");
    expect(layoutFor("auto", "evidence", 5)).toBe("chart");
    // Data the author asked for as data is always a chart.
    expect(layoutFor("data", "evidence", 4)).toBe("chart");
  });
});

describe("the structural fallback for each point layout", () => {
  const brief = {
    title: "Perfusion before pressure",
    purpose: "Show that blood pressure is a late sign of shock.",
    takeaway: "Treat the perfusion, not the number.",
    evidence: [{ label: "Regional trauma audit 2024" }],
  };

  it.each(["takeaway", "action", "figure", "explainer"] as const)(
    "writes the author's own argument into a %s, and composes validly",
    (layout) => {
      const scene = fallbackScene({ ...brief, layout }, { title: "Shock", prompt: "shock" });
      expect(GeneratedScene.safeParse(scene).success).toBe(true);
      const content = composeScene(layout, {
        eyebrow: scene.eyebrow || undefined,
        heading: scene.heading || undefined,
        body: scene.body || undefined,
        cards: scene.cards.length ? scene.cards : undefined,
        icon: scene.icon ?? undefined,
        figure: scene.figure ?? undefined,
        media: scene.imagePrompt ? { url: "", alt: scene.imagePrompt } : undefined,
      });
      expect(SceneContent.safeParse(content).success).toBe(true);
      expect(content.elements.length).toBeGreaterThan(0);
      const words = JSON.stringify(scene);
      expect(words).toContain("Treat the perfusion");
    },
  );

  it("never invents a number for a figure", () => {
    const scene = fallbackScene(
      { ...brief, layout: "figure" },
      { title: "Shock", prompt: "shock" },
    );
    expect(scene.figure).toBeNull();
  });
});

describe("what the model may hand back for a point", () => {
  it("accepts an icon and a figure, and refuses an icon that does not exist", () => {
    const base = { title: "t", layout: "takeaway" as const, heading: "h" };
    expect(GeneratedScene.safeParse({ ...base, icon: "heart-pulse" }).success).toBe(true);
    expect(GeneratedScene.safeParse({ ...base, icon: "unicorn" }).success).toBe(false);
    expect(
      GeneratedScene.safeParse({
        ...base,
        layout: "figure",
        figure: { value: "7.6%", label: "per hour" },
      }).success,
    ).toBe(true);
  });

  it("keeps a figure short enough to be set as the whole scene", () => {
    expect(
      GeneratedScene.safeParse({
        title: "t",
        layout: "figure",
        figure: { value: "approximately seven point six percent", label: "" },
      }).success,
    ).toBe(false);
  });
});
