import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuildPips } from "@/components/present/build-pips";

/**
 * The row a presenter reads without reading.
 *
 * Both the console and the phone already stated the remaining presses in
 * words. Words are the wrong shape for it — this is looked at in the
 * half-second between finishing a sentence and reaching for the key, in
 * peripheral vision, and a count has to be parsed before it means anything.
 * A length does not.
 *
 * So what is asserted here is the *shape*: one pip per press, filled behind
 * the presenter and hollow in front, and nothing at all on a scene that does
 * not build. The words are still there beside it; these are the second reading
 * of the same fact, not a replacement for it.
 */
describe("the build indicator", () => {
  it("draws one pip per press, not one per step", () => {
    // A scene with four steps costs three presses to finish: arriving on it is
    // not a press. Drawing four would make every scene look like one more than
    // it is, which is exactly the overshoot this whole indicator exists to
    // stop.
    const { container } = render(<BuildPips total={4} current={0} />);
    expect(container.querySelectorAll("span[aria-hidden]")).toHaveLength(3);
  });

  it("says nothing on a scene that does not build", () => {
    // Most scenes are one step. A single pip on every one of them would make
    // the row furniture, and furniture stops being looked at — which costs the
    // scenes that do build.
    const { container } = render(<BuildPips total={1} current={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("fills what is spent and leaves what is coming", () => {
    const { container } = render(<BuildPips total={5} current={2} />);
    const pips = [...container.querySelectorAll("span[aria-hidden]")];
    // Two behind, one ringed as next, one still to come.
    expect(pips.filter((p) => p.className.includes("bg-accent"))).toHaveLength(2);
    expect(pips.filter((p) => p.className.includes("ring-accent"))).toHaveLength(1);
  });

  it("counts down as the presenter advances", () => {
    const { rerender, container } = render(<BuildPips total={4} current={0} />);
    const spent = () =>
      [...container.querySelectorAll("span[aria-hidden]")].filter((p) =>
        p.className.includes("bg-accent"),
      ).length;

    expect(spent()).toBe(0);
    rerender(<BuildPips total={4} current={2} />);
    expect(spent()).toBe(2);
  });

  it("gives the whole row one spoken label rather than eight dots", () => {
    // A screen reader announcing each pip is worse than announcing nothing.
    render(<BuildPips total={4} current={1} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "2 of 3 builds left on this scene",
    );
  });

  it("falls back to the number when a scene builds too many times to draw", () => {
    // A row of nineteen dots is not glanceable either, and a scene with that
    // many builds has a problem this component should not disguise as a tidy
    // little row.
    const { container } = render(<BuildPips total={20} current={0} />);
    expect(container.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
    expect(container.textContent).toContain("19 of 19 builds left");
  });

  it("tints from white on the phone, where the surface is black", () => {
    const { container } = render(<BuildPips total={3} current={1} tone="dark" />);
    const pips = [...container.querySelectorAll("span[aria-hidden]")];
    expect(pips.some((p) => p.className.includes("bg-white/70"))).toBe(true);
    expect(pips.some((p) => p.className.includes("bg-accent"))).toBe(false);
  });
});
