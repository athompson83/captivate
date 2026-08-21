import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stage } from "@/components/stage/stage";
import { getTheme } from "@/lib/schema/theme";
import { composeScene } from "@/lib/editor/layouts";
import { SceneContent } from "@/lib/schema/presentation";

const theme = getTheme("midnight");

function renderStage(content: SceneContent) {
  return render(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} />);
}

describe("stage rendering", () => {
  it("renders headings and bullets as real text", () => {
    const content = composeScene("bullets", {
      heading: "Recognising shock",
      bullets: ["Tachycardia first", "Pressure falls late"],
    });

    renderStage(content);

    expect(screen.getByText("Recognising shock")).toBeInTheDocument();
    expect(screen.getByText("Tachycardia first")).toBeInTheDocument();
    expect(screen.getByText("Pressure falls late")).toBeInTheDocument();
  });

  it("renders markup in content as literal text, never as HTML", () => {
    // Text is rendered from typed runs, so there is no innerHTML path at all.
    const content = SceneContent.parse({
      elements: [
        {
          id: "t",
          type: "text",
          frame: { x: 10, y: 10, w: 60, h: 20 },
          content: [{ text: "<img src=x onerror=alert(1)>" }],
        },
      ],
    });

    const { container } = renderStage(content);

    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("gives images their alt text", () => {
    const content = composeScene("media-full", {
      heading: "A photo",
      media: { url: "https://example.com/x.jpg", alt: "A paramedic assessing a patient" },
    });

    renderStage(content);
    expect(screen.getByAltText("A paramedic assessing a patient")).toBeInTheDocument();
  });

  it("exposes a chart's summary to assistive technology", () => {
    const content = composeScene("chart", {
      heading: "Growth",
      chart: {
        chart: "column",
        data: [
          { label: "Q1", value: 10 },
          { label: "Q2", value: 20 },
        ],
        summary: "Doubled between Q1 and Q2.",
      },
    });

    renderStage(content);
    expect(screen.getByRole("img", { name: "Doubled between Q1 and Q2." })).toBeInTheDocument();
  });

  it("sandboxes embedded content", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "e",
          type: "embed",
          frame: { x: 10, y: 10, w: 60, h: 40 },
          url: "https://example.com/embed",
          title: "An embed",
        },
      ],
    });

    renderStage(content);
    const frame = screen.getByTitle("An embed");
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups");
    expect(frame).toHaveAttribute("referrerPolicy", "no-referrer");
  });

  it("does not render hidden elements", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "shown",
          type: "text",
          frame: { x: 0, y: 0, w: 20, h: 10 },
          content: [{ text: "visible" }],
        },
        {
          id: "hidden",
          type: "text",
          frame: { x: 0, y: 20, w: 20, h: 10 },
          content: [{ text: "invisible" }],
          hidden: true,
        },
      ],
    });

    renderStage(content);
    expect(screen.getByText("visible")).toBeInTheDocument();
    expect(screen.queryByText("invisible")).toBeNull();
  });

  it("holds back build-on-advance elements until their step", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "always",
          type: "text",
          frame: { x: 0, y: 0, w: 20, h: 10 },
          content: [{ text: "always" }],
        },
        {
          id: "later",
          type: "text",
          frame: { x: 0, y: 20, w: 20, h: 10 },
          content: [{ text: "later" }],
          animation: { onAdvance: true },
        },
      ],
    });

    const { rerender } = render(
      <Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={0} />,
    );
    expect(screen.getByText("always")).toBeInTheDocument();
    expect(screen.queryByText("later")).toBeNull();

    rerender(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={1} />);
    expect(screen.getByText("later")).toBeInTheDocument();
  });

  it("reveals a staggered list one item at a time while presenting", () => {
    const content = composeScene("bullets", {
      heading: "Points",
      bullets: ["first", "second", "third"],
    });

    const { rerender } = render(
      <Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={0} />,
    );
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("second")).toBeNull();

    rerender(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={1} />);
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("third")).toBeNull();
  });

  it("shows the whole list when the scene is not being presented", () => {
    // In the editor the author needs to see everything, not a build state.
    const content = composeScene("bullets", { heading: "H", bullets: ["a", "b", "c"] });
    renderStage(content);
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("renders an empty scene without crashing", () => {
    const { container } = renderStage(SceneContent.parse({ elements: [] }));
    expect(container.querySelector("[data-stage]")).not.toBeNull();
  });
});

describe("text auto-fit", () => {
  /** Reads back the font size the stage actually applied to an element. */
  function fontSizeOf(el: Element | null): number {
    return Number.parseFloat((el as HTMLElement).style.fontSize || "0");
  }

  it("keeps a short heading at its authored size", () => {
    const content = composeScene("title", { heading: "Shock" });
    const { container } = renderStage(content);
    // 5.4rem at a 16px stage rem, unmodified.
    expect(fontSizeOf(container.querySelector("h1"))).toBeCloseTo(5.4 * 16, 1);
  });

  it("shrinks a heading that would overflow its box", () => {
    const long = composeScene("title", {
      heading:
        "Recognising and managing compensated shock for second-year paramedic students in the field",
    });
    const { container } = renderStage(long);

    const size = fontSizeOf(container.querySelector("h1"));
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(5.4 * 16);
  });

  it("shrinks a list that genuinely overflows its box", () => {
    const short = composeScene("bullets", { heading: "H", bullets: ["One", "Two"] });
    const long = composeScene("bullets", {
      heading: "H",
      bullets: Array.from(
        { length: 12 },
        (_, i) => `Point ${i + 1}: a considerably longer line that runs on for a good while`,
      ),
    });

    const shortSize = fontSizeOf(
      render(
        <Stage content={short} theme={theme} aspect="16:9" fixedScale={1} />,
      ).container.querySelector("ul"),
    );
    const longSize = fontSizeOf(
      render(
        <Stage content={long} theme={theme} aspect="16:9" fixedScale={1} />,
      ).container.querySelector("ul"),
    );

    expect(longSize).toBeLessThan(shortSize);
  });

  it("leaves a list that fits at its authored size", () => {
    // Auto-fit must not quietly shrink content that was already fine.
    const content = composeScene("bullets", {
      heading: "H",
      bullets: ["Tachycardia first", "Narrow pulse pressure", "Delayed capillary refill"],
    });
    const { container } = renderStage(content);
    expect(fontSizeOf(container.querySelector("ul"))).toBeCloseTo(3.4 * 16 * 0.56, 2);
  });

  it("applies the same fit in a thumbnail as on the stage", () => {
    // A thumbnail renders the stage at fixedScale 1 inside a CSS transform, so
    // the computed font size must be identical — otherwise a card preview would
    // not match what gets projected.
    const content = composeScene("title", {
      heading: "Recognising and managing compensated shock for paramedic students",
    });

    const a = render(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} />);
    const b = render(<Stage content={content} theme={theme} aspect="16:9" fixedScale={0.2} />);

    expect(fontSizeOf(a.container.querySelector("h1"))).toBeCloseTo(
      fontSizeOf(b.container.querySelector("h1")),
      5,
    );
  });
});
