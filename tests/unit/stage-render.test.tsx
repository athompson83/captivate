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
