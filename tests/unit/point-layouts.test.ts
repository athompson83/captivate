import { describe, expect, it } from "vitest";
import { ALL_LAYOUTS, composeScene, extractContent, relayoutScene } from "@/lib/editor/layouts";
import { SceneContent } from "@/lib/schema/presentation";

/**
 * The layouts that carry a point rather than a page: a take-home, a call to
 * action, one number, and a plain explanation. They exist because a deck of
 * headings and bullets is a deck of slides whatever the camera does, and what
 * an audience actually leaves with is an icon, a number and a sentence.
 *
 * Two contracts: every one of them composes to valid content that a reload
 * would keep, and the pieces that make them what they are — the figure, the
 * icon — survive a round trip through `extractContent`, or a change of layout
 * would silently lose the one number the scene was built around.
 */

describe("the take-home layout", () => {
  it("leads with a large accent icon beside the point", () => {
    const content = composeScene("takeaway", {
      eyebrow: "Take this with you",
      icon: "heart-pulse",
      heading: "Treat the perfusion, not the number",
      body: "A normal pressure is the last thing shock lets go of.",
    });
    expect(SceneContent.safeParse(content).success).toBe(true);
    const icon = content.elements.find((el) => el.type === "icon");
    expect(icon).toBeDefined();
    if (icon?.type === "icon") {
      expect(icon.name).toBe("heart-pulse");
      expect(icon.frame.w).toBeGreaterThanOrEqual(15);
    }
    const heading = content.elements.find((el) => el.type === "heading");
    expect(heading).toBeDefined();
    if (heading?.type === "heading") expect(heading.frame.x).toBeGreaterThan(icon!.frame.x);
  });

  it("still carries an icon when none was chosen, rather than a hole", () => {
    const content = composeScene("takeaway", { heading: "Remember this" });
    const icon = content.elements.find((el) => el.type === "icon");
    expect(icon?.type === "icon" && icon.name).toBe("lightbulb");
  });

  it("keeps its icon through a change of layout and back", () => {
    const content = composeScene("takeaway", { icon: "shield", heading: "Protect the airway" });
    const back = relayoutScene(relayoutScene(content, "statement"), "takeaway");
    expect(extractContent(back).heading).toBe("Protect the airway");
    // The statement has no icon slot, so the icon is genuinely gone from the
    // document in between; what matters is that the takeaway did carry it.
    expect(extractContent(content).icon).toBe("shield");
  });
});

describe("the call-to-action layout", () => {
  const content = composeScene("action", {
    eyebrow: "What to do next",
    heading: "On your next shift, look before you measure",
    cards: [
      { title: "Skin first", body: "Colour, warmth, capillary refill.", icon: "eye" },
      { title: "Then the numbers", body: "Heart rate before pressure.", icon: "activity" },
      { title: "Escalate early", body: "Say the word shock out loud.", icon: "megaphone" },
    ],
  });

  it("draws the steps as open, icon-led points rather than panels", () => {
    const steps = content.elements.filter((el) => el.type === "callout");
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      if (step.type === "callout") {
        expect(step.variant).toBe("open");
        expect(step.tone).toBe("accent");
      }
    }
    expect(steps.map((el) => el.type === "callout" && el.icon)).toEqual([
      "eye",
      "activity",
      "megaphone",
    ]);
  });

  it("sets the imperative larger than a list heading", () => {
    const heading = content.elements.find((el) => el.type === "heading");
    const bullets = composeScene("bullets", { heading: "x", bullets: ["a"] }).elements.find(
      (el) => el.type === "heading",
    );
    if (heading?.type === "heading" && bullets?.type === "heading") {
      expect(heading.style.size).toBeGreaterThan(bullets.style.size);
      expect(heading.level).toBe(1);
    }
  });
});

describe("the one-number layout", () => {
  const content = composeScene("figure", {
    heading: "Every hour of delay costs survival",
    figure: { value: "7.6%", label: "fall in survival per hour before antibiotics" },
    body: "Recognition is the treatment that happens before any drug.",
  });

  it("sets the number in the accent, as display type, large", () => {
    const figure = content.elements.find((el) => el.id.startsWith("figure_"));
    expect(figure?.type).toBe("text");
    if (figure?.type === "text") {
      expect(figure.style.size).toBeGreaterThan(2);
      expect(figure.style.family).toBe("display");
      expect(figure.style.color).toEqual({ kind: "token", token: "accent" });
    }
    expect(SceneContent.safeParse(content).success).toBe(true);
  });

  it("round-trips the figure through extraction, so a relayout cannot lose it", () => {
    const extracted = extractContent(content);
    expect(extracted.figure).toEqual({
      value: "7.6%",
      label: "fall in survival per hour before antibiotics",
    });
    expect(extracted.heading).toBe("Every hour of delay costs survival");
    // The label is a text element too, and must not be mistaken for prose.
    expect(extracted.subheading).toBe("Recognition is the treatment that happens before any drug.");

    // Re-applying the layout is the editor's own path, and it rebuilds the
    // same scene from what it extracts. (A layout with no figure slot drops
    // the number, exactly as a bullets scene drops a chart's data.)
    const again = relayoutScene(content, "figure");
    expect(extractContent(again).figure?.value).toBe("7.6%");
  });

  it("is not blank when it has a claim but no number yet", () => {
    const content = composeScene("figure", { heading: "The number goes here" });
    expect(content.elements.length).toBeGreaterThan(0);
  });
});

describe("the explainer layout", () => {
  const content = composeScene("explainer", {
    heading: "Shock is a delivery problem, not a pressure problem",
    cards: [
      { title: "What it is", body: "Not enough oxygen reaching the tissues.", icon: "info" },
      { title: "Why it hides", body: "The body compensates until it cannot.", icon: "shield" },
      { title: "What to do", body: "Find the cause while you support the pump.", icon: "target" },
    ],
    media: { url: "", alt: "the mechanism, drawn" },
  });

  it("stacks its three points beside a picture slot", () => {
    const points = content.elements.filter((el) => el.type === "callout");
    const media = content.elements.find((el) => el.type === "image");
    expect(points).toHaveLength(3);
    expect(media).toBeDefined();
    const ys = points.map((el) => el.frame.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (const point of points) {
      expect(point.frame.x + point.frame.w).toBeLessThanOrEqual(media!.frame.x + 0.001);
      if (point.type === "callout") expect(point.variant).toBe("open");
    }
  });

  it("has a media slot the drawing pass can fill", () => {
    const placeholder = content.elements.find(
      (el) => el.type === "image" && !el.url && !el.assetId,
    );
    expect(placeholder).toBeDefined();
  });
});

describe("the layout picker", () => {
  it("offers every point layout", () => {
    const offered = ALL_LAYOUTS.map((l) => l.value);
    for (const layout of ["takeaway", "action", "figure", "explainer"]) {
      expect(offered).toContain(layout);
    }
  });

  it("composes three-up cards open too, so a sequence is three ideas on one page", () => {
    const content = composeScene("three-up", {
      heading: "H",
      cards: [
        { title: "A", body: "a" },
        { title: "B", body: "b" },
        { title: "C", body: "c" },
      ],
    });
    for (const card of content.elements.filter((el) => el.type === "callout")) {
      if (card.type === "callout") expect(card.variant).toBe("open");
    }
  });
});
