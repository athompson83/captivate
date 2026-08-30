// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DrawnPicture } from "@/components/stage/drawn-picture";
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

const pathsIn = (container: HTMLElement) => [...container.querySelectorAll("path")];
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
