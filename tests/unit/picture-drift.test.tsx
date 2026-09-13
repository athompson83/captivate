// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SceneContent } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { Stage } from "@/components/stage/stage";
import { DRIFT_MS, DRIFT_RETURN_MS } from "@/lib/present/drift";

/**
 * A picture that lives: a photograph drifts while its scene is performed —
 * only then. In the editor and a thumbnail it is being looked at and stays
 * exactly where it was put; when the camera leaves it comes back.
 */
const theme = getTheme("midnight");

const shot = SceneContent.parse({
  elements: [
    {
      id: "img-1",
      type: "image",
      frame: { x: 10, y: 10, w: 60, h: 60 },
      url: "https://example.com/harbour.jpg",
      alt: "The harbour",
      focalX: 0.3,
      focalY: 0.6,
    },
  ],
});

const picture = (container: HTMLElement) => container.querySelector("img")!;

describe("a picture that lives", () => {
  it("drifts from the identity once the camera has landed on its scene", async () => {
    const { container, rerender } = render(
      <Stage
        content={shot}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    // Held, and at the identity: a landing must not jump.
    expect(picture(container).style.transform).toBe("none");
    expect(picture(container).hasAttribute("data-living")).toBe(false);

    rerender(
      <Stage content={shot} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    await waitFor(() => expect(picture(container).hasAttribute("data-living")).toBe(true));
    const img = picture(container);
    expect(img.style.transform).toMatch(/^scale\(1\.\d+\)/);
    expect(img.style.transformOrigin).toBe("30.0% 60.0%");
    expect(img.style.transition).toContain(`${DRIFT_MS}ms`);
  });

  it("spends a frame at rest before drifting when it mounts mid-performance", async () => {
    // Built on an advance: the picture mounts while the scene is already
    // being performed. A transition set as the element's first style never
    // runs, so the first frame must be the identity and the drift the next.
    const built = SceneContent.parse({
      elements: [{ ...shot.elements[0], animation: { onAdvance: true } }],
    });
    const { container, rerender } = render(
      <Stage content={built} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    expect(container.querySelector("img")).toBeNull();

    rerender(
      <Stage content={built} theme={theme} aspect="16:9" fixedScale={1} play step={1} arrived />,
    );
    const img = picture(container);
    expect(img.style.transform).toBe("none");
    expect(img.hasAttribute("data-living")).toBe(false);
    await waitFor(() => expect(picture(container).hasAttribute("data-living")).toBe(true));
    expect(picture(container).style.transform).toMatch(/^scale\(1\.\d+\)/);
  });

  it("comes back over the flight away when the camera leaves", async () => {
    const { container, rerender } = render(
      <Stage content={shot} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    await waitFor(() => expect(picture(container).hasAttribute("data-living")).toBe(true));
    rerender(
      <Stage
        content={shot}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    const img = picture(container);
    expect(img.hasAttribute("data-living")).toBe(false);
    expect(img.style.transform).toBe("none");
    expect(img.style.transition).toContain(`${DRIFT_RETURN_MS}ms`);
  });

  it("stays exactly where it was put in the editor and a thumbnail", async () => {
    const { container } = render(
      <Stage content={shot} theme={theme} aspect="16:9" fixedScale={1} />,
    );
    // Long enough for the frame at rest to have passed, so this is not
    // merely the first render.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const img = picture(container);
    expect(img.hasAttribute("data-living")).toBe(false);
    expect(img.style.transform).toBe("none");
  });
});
