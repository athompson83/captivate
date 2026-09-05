import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClosingFrame } from "@/components/present/closing-frame";

describe("the closing frame", () => {
  it("names the end after the presentation", () => {
    render(<ClosingFrame title="Hold the room" />);
    const frame = screen.getByRole("status", { name: "The end: Hold the room" });
    expect(frame).toHaveAttribute("data-closing");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Hold the room");
    // The map beneath is still live; the frame must not swallow a click.
    expect(frame.className).toContain("pointer-events-none");
  });

  it("still says something when the deck has no title", () => {
    render(<ClosingFrame title="   " />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("The end");
  });
});
