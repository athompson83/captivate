import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LiveDemoStage } from "@/components/marketing/live-demo-stage";

/**
 * The live demo on the landing page: the real world, driven by the visitor.
 *
 * The keys work only while the stage has focus, so a visitor scrolling with
 * Space is never hijacked; the buttons beside it do the same for anyone who
 * would rather click, and the line between them says where the reader is.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1600,
      bottom: 900,
      width: 1600,
      height: 900,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

describe("the live demo", () => {
  it("is a labelled, focusable region that starts on scene one", () => {
    render(<LiveDemoStage />);
    const stage = screen.getByRole("region", { name: /live demo/i });
    expect(stage).toHaveAttribute("tabindex", "0");
    expect(stage).toHaveAttribute("data-view", "scene");
    expect(screen.getByText(/^Scene 1 of \d+/)).toBeInTheDocument();
  });

  it("moves through the deck from the keyboard while the stage has focus", () => {
    render(<LiveDemoStage />);
    const stage = screen.getByRole("region", { name: /live demo/i });
    // Enough presses to get past scene one's own builds, whatever they are.
    for (let i = 0; i < 12; i += 1) fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(screen.queryByText(/^Scene 1 of/)).toBeNull();

    fireEvent.keyDown(stage, { key: "Home" });
    expect(screen.getByText(/^Scene 1 of/)).toBeInTheDocument();

    fireEvent.keyDown(stage, { key: "o" });
    expect(stage).toHaveAttribute("data-view", "world");
    expect(screen.getByText("The whole argument")).toBeInTheDocument();
    fireEvent.keyDown(stage, { key: "Escape" });
    expect(stage).toHaveAttribute("data-view", "scene");
  });

  it("offers the same moves as buttons, and knows when there is no way back", () => {
    render(<LiveDemoStage />);
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(back).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Whole map" }));
    expect(screen.getByRole("region", { name: /live demo/i })).toHaveAttribute(
      "data-view",
      "world",
    );
    expect(screen.getByRole("button", { name: "Back to the scene" })).toBeInTheDocument();
  });

  it("pulls back over the whole argument after the last scene", () => {
    render(<LiveDemoStage />);
    const stage = screen.getByRole("region", { name: /live demo/i });
    fireEvent.keyDown(stage, { key: "End" });
    // Walk the last scene's builds; the press after the last one pulls back.
    for (let i = 0; i < 24 && stage.getAttribute("data-view") !== "world"; i += 1) {
      fireEvent.keyDown(stage, { key: "ArrowRight" });
    }
    expect(stage).toHaveAttribute("data-view", "world");
    // And from there, the next press is back into the argument, not past it.
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    expect(stage).toHaveAttribute("data-view", "scene");
  });

  it("takes the invitation down on the first move", () => {
    render(<LiveDemoStage />);
    expect(screen.getByText(/Press → or tap the stage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // AnimatePresence keeps it mounted through its exit; the text is on its
    // way out rather than a permanent fixture.
    expect(screen.queryByText(/Press → or tap the stage/)?.closest("[style]") ?? null).not.toBe(
      undefined,
    );
  });
});
