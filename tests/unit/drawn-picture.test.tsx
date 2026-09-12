// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  DrawnPicture,
  UNDER_OPACITY,
  UNDER_WEIGHT,
  washBleed,
  washOffset,
} from "@/components/stage/drawn-picture";
import { createElement } from "@/lib/editor/element-factory";
import type { DrawingElement } from "@/lib/schema/presentation";

/**
 * The sketch renderer. What matters here is not that CSS animates — jsdom
 * cannot see that — but the contract the CSS keys off: which paths carry the
 * drawn class at a given step, that every path is in the DOM regardless (so
 * lengths can be measured and a finished picture needs no reflow), and that
 * an unmeasured path is left with the 0 fallback that renders it *complete*.
 */

const element = createElement("drawing") as DrawingElement; // stages 0, 1, 2

/** The ink: the committed strokes, not the underdrawing beneath them nor the washes. */
const pathsIn = (container: HTMLElement) => [
  ...container.querySelectorAll("path.dp-path:not(.dp-under)"),
];
const drawn = (p: Element) => p.classList.contains("dp-drawn");

describe("DrawnPicture", () => {
  it("renders every path, drawn or not, so all can be measured", () => {
    const { container } = render(<DrawnPicture element={element} step={0} />);
    expect(pathsIn(container)).toHaveLength(element.paths.length);
  });

  it("marks only the reached stages as drawn", () => {
    const { container } = render(<DrawnPicture element={element} step={1} />);
    const flags = pathsIn(container).map(drawn);
    expect(flags).toEqual(element.paths.map((p) => p.stage <= 1));
  });

  it("stepping back un-draws the later stages", () => {
    const { container, rerender } = render(<DrawnPicture element={element} step={2} />);
    expect(pathsIn(container).every(drawn)).toBe(true);
    rerender(<DrawnPicture element={element} step={0} />);
    expect(pathsIn(container).map(drawn)).toEqual(element.paths.map((p) => p.stage === 0));
  });

  it("renders the whole picture at Infinity — the editor and thumbnail case", () => {
    const { container } = render(
      <DrawnPicture element={element} step={Number.POSITIVE_INFINITY} />,
    );
    expect(pathsIn(container).every(drawn)).toBe(true);
  });

  it("leaves an unmeasurable path on the fallback that renders it complete", () => {
    // jsdom has no getTotalLength, which is exactly the degraded environment
    // the fallback exists for: --dp-len stays unset and the CSS default of 0
    // gives a solid, finished stroke.
    const { container } = render(<DrawnPicture element={element} step={2} />);
    for (const p of pathsIn(container)) {
      expect((p as SVGPathElement).style.getPropertyValue("--dp-len")).toBe("");
    }
  });

  it("splits a stage's pace between its paths, in drawing order", () => {
    const two: DrawingElement = {
      ...element,
      paceSeconds: 2,
      paths: [
        { d: "M 0 0 L 1 1", stage: 0 },
        { d: "M 1 1 L 2 2", stage: 1 },
        { d: "M 2 2 L 3 3", stage: 1 },
      ],
    };
    const { container } = render(<DrawnPicture element={two} step={1} />);
    const styles = pathsIn(container).map((p) => (p as SVGPathElement).style);
    // The lone stage-0 path takes the whole pace; the stage-1 pair split it,
    // the second starting where the first ends.
    expect(styles[0].getPropertyValue("--dp-dur")).toBe("2s");
    expect(styles[1].getPropertyValue("--dp-dur")).toBe("1s");
    expect(styles[1].getPropertyValue("--dp-del")).toBe("0s");
    expect(styles[2].getPropertyValue("--dp-del")).toBe("1s");
  });

  it("names the picture for a screen reader", () => {
    const { container } = render(<DrawnPicture element={element} step={0} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe(element.alt);
  });
});

describe("what a stroke may carry beyond its geometry", () => {
  const picture: DrawingElement = {
    ...element,
    strokeWidth: 3,
    paths: [
      { d: "M 0 0 L 10 0", stage: 0, weight: 1.6 },
      { d: "M 0 5 L 10 5", stage: 0, ink: "accent" },
      { d: "M 0 0 L 10 0 L 10 10 Z", stage: 1, fill: true },
    ],
  };

  it("scales the stroke by the path's weight", () => {
    const { container } = render(<DrawnPicture element={picture} step={1} />);
    const strokes = [...container.querySelectorAll("path.dp-path:not(.dp-under)")];
    expect(strokes[0].getAttribute("stroke-width")).toBe(String(3 * 1.6));
    expect(strokes[1].getAttribute("stroke-width")).toBe("3");
  });

  it("lets one stroke take the accent while the element stays in ink", () => {
    const { container } = render(<DrawnPicture element={picture} step={1} />);
    const strokes = [...container.querySelectorAll("path.dp-path:not(.dp-under)")];
    expect(strokes[0].getAttribute("stroke")).toBe("var(--stage-ink)");
    expect(strokes[1].getAttribute("stroke")).toBe("var(--stage-accent)");
  });

  it("lays a wash under a filled path that waits for its stroke", () => {
    const { container } = render(<DrawnPicture element={picture} step={1} />);
    const washes = [...container.querySelectorAll("path.dp-fill")];
    expect(washes).toHaveLength(1);
    const wash = washes[0] as SVGPathElement;
    expect(wash.classList.contains("dp-drawn")).toBe(true);
    // The lone stage-1 path takes the whole pace; its wash starts as it ends.
    expect(wash.style.getPropertyValue("--dp-del")).toBe(`${picture.paceSeconds}s`);
    // And it comes before its own stroke in document order, so the stroke
    // paints over it.
    const group = wash.parentElement!;
    expect(group.firstElementChild).toBe(wash);
  });

  it("holds the wash back with the stroke until its stage is reached", () => {
    const { container } = render(<DrawnPicture element={picture} step={0} />);
    const wash = container.querySelector("path.dp-fill")!;
    expect(wash.classList.contains("dp-drawn")).toBe(false);
  });
});

describe("labels on a drawing", () => {
  const labelled: DrawingElement = {
    ...element,
    labels: [
      { text: "Heart", x: 50, y: 120, stage: 0, size: 1, anchor: "middle" },
      { text: "Later", x: 150, y: 120, stage: 2, size: 0.8, anchor: "start", ink: "accent" },
    ],
  };

  it("are set beside their parts in the theme's face and arrive with their stage", () => {
    const { container } = render(
      <DrawnPicture element={labelled} step={0} fontFamily="var(--font-inter)" />,
    );
    const texts = [...container.querySelectorAll("text")];
    expect(texts.map((t) => t.textContent)).toEqual(["Heart", "Later"]);
    expect(texts[0].classList.contains("dp-drawn")).toBe(true);
    expect(texts[1].classList.contains("dp-drawn")).toBe(false);
    expect(texts[0].getAttribute("font-family")).toBe("var(--font-inter)");
    expect(texts[1].getAttribute("fill")).toBe("var(--stage-accent)");
    expect(texts[1].getAttribute("text-anchor")).toBe("start");
    // Outside the hand's filter: a wobbled word reads as a fault.
    expect(texts[0].closest("g[filter]")).toBeNull();
    expect(container.querySelector("g[filter]")).not.toBeNull();
  });

  it("draws every stroke through a hand, three of them defined once per picture", () => {
    const { container } = render(<DrawnPicture element={labelled} step={2} />);
    const filters = [...container.querySelectorAll("filter")];
    expect(filters.map((f) => f.id.split("-")[0])).toEqual(["hand", "under", "wash"]);
    expect(container.querySelectorAll("feDisplacementMap")).toHaveLength(3);
    const paths = [...container.querySelectorAll("path")];
    expect(paths.every((p) => p.closest("g[filter]") !== null)).toBe(true);
  });
});

describe("drawn like an illustrator", () => {
  const filled: DrawingElement = {
    ...element,
    strokeWidth: 3,
    paths: [
      { d: "M 0 0 L 100 0 L 100 100 Z", stage: 0, fill: true, weight: 1.6 },
      { d: "M 0 0 L 50 50", stage: 1 },
    ],
  };

  it("draws every stroke twice: a lighter underdrawing through its own hand, then the ink", () => {
    const { container } = render(<DrawnPicture element={filled} step={1} />);
    const under = [...container.querySelectorAll("path.dp-under")];
    const ink = [...container.querySelectorAll("path.dp-path:not(.dp-under)")];
    expect(under).toHaveLength(filled.paths.length);
    expect(ink).toHaveLength(filled.paths.length);
    // Same geometry, same stage, lighter weight, and its own hand.
    expect(under[0].getAttribute("d")).toBe(ink[0].getAttribute("d"));
    expect(under.map((p) => p.classList.contains("dp-drawn"))).toEqual(
      ink.map((p) => p.classList.contains("dp-drawn")),
    );
    expect(Number(under[0].getAttribute("stroke-width"))).toBeCloseTo(3 * 1.6 * UNDER_WEIGHT);
    expect(Number(ink[0].getAttribute("stroke-width"))).toBeCloseTo(3 * 1.6);
    const underGroup = under[0].closest("g[filter]")!;
    const inkGroup = ink[0].closest("g[filter]")!;
    expect(underGroup).not.toBe(inkGroup);
    expect(underGroup.getAttribute("filter")).toMatch(/^url\(#under-/);
    expect(inkGroup.getAttribute("filter")).toMatch(/^url\(#hand-/);
    expect(Number(underGroup.getAttribute("opacity"))).toBe(UNDER_OPACITY);
  });

  it("lays a wash that bleeds past its line, off it, through a coarser hand, under the ink", () => {
    const { container } = render(<DrawnPicture element={filled} step={1} />);
    const washes = [...container.querySelectorAll("path.dp-fill")];
    expect(washes).toHaveLength(1);
    const wash = washes[0];
    // The bleed: a wide stroke of the wash's own colour, faded by the CSS.
    expect(wash.getAttribute("stroke")).toBe(wash.getAttribute("fill"));
    expect(Number(wash.getAttribute("stroke-width"))).toBeCloseTo(washBleed(3));
    const group = wash.closest("g[filter]")!;
    expect(group.getAttribute("filter")).toMatch(/^url\(#wash-/);
    const offset = washOffset(filled.viewBox.width);
    expect(group.getAttribute("transform")).toBe(`translate(${offset} ${offset})`);
    // Under everything: the wash group precedes both stroke passes.
    const groups = [...container.querySelectorAll("svg > g[filter]")];
    expect(groups.indexOf(group)).toBe(0);
    expect(groups).toHaveLength(3);
  });

  it("lays a wash with no line down at once, taking no slot on the sketch clock", () => {
    // Two strokes and a line-less wash in one stage: the strokes split the
    // stage's pace between the two of them, the wash goes down at 0s and
    // draws no stroke at all.
    const washed: DrawingElement = {
      ...element,
      paceSeconds: 2,
      paths: [
        { d: "M 0 0 L 100 0 L 100 100 Z", stage: 0, fill: true, weight: 0 },
        { d: "M 0 0 L 100 100", stage: 0 },
        { d: "M 0 100 L 100 0", stage: 0 },
      ],
    };
    const { container } = render(<DrawnPicture element={washed} step={0} />);
    const strokes = [...container.querySelectorAll("path.dp-path:not(.dp-under)")];
    expect(strokes).toHaveLength(2);
    expect(strokes.map((p) => (p as HTMLElement).style.getPropertyValue("--dp-dur"))).toEqual([
      "1s",
      "1s",
    ]);
    expect(strokes.map((p) => (p as HTMLElement).style.getPropertyValue("--dp-del"))).toEqual([
      "0s",
      "1s",
    ]);
    const wash = container.querySelector<HTMLElement>("path.dp-fill")!;
    expect(wash.style.getPropertyValue("--dp-del")).toBe("0s");
    expect(container.querySelectorAll("path.dp-under")).toHaveLength(2);
  });

  it("is deterministic: the hands are seeded from the picture's size, not the clock", () => {
    const a = render(<DrawnPicture element={filled} step={1} />).container.innerHTML;
    const b = render(<DrawnPicture element={filled} step={1} />).container.innerHTML;
    // Ids differ per mount; everything else is identical.
    const anon = (html: string) => html.replace(/(hand|under|wash)-[a-zA-Z0-9]+/g, "$1");
    expect(anon(a)).toBe(anon(b));
    const seeds = [
      ...render(<DrawnPicture element={filled} step={1} />).container.querySelectorAll(
        "feTurbulence",
      ),
    ].map((t) => t.getAttribute("seed"));
    expect(new Set(seeds).size).toBe(3);
  });
});
