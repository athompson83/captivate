import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stage } from "@/components/stage/stage";
import { getTheme } from "@/lib/schema/theme";
import { SceneContent } from "@/lib/schema/presentation";

/**
 * A hotspot is a control, so it has to be one: a real button, reachable by
 * keyboard, with a name a screen reader can announce. Rendering a clickable
 * div would make the whole feature invisible to anyone not using a mouse.
 */
const theme = getTheme("midnight");

const contentWith = (hotspot: { targetSceneId: string; label?: string } | null) =>
  SceneContent.parse({
    elements: [
      {
        id: "el-1",
        type: "heading",
        level: 2,
        frame: { x: 10, y: 10, w: 40, h: 15, rotation: 0 },
        content: [{ text: "The ECG" }],
        ...(hotspot ? { hotspot } : {}),
      },
    ],
  });

const TARGET = "00000000-0000-4000-8000-0000000000bb";

describe("hotspot rendering on the stage", () => {
  it("renders a real button when a hotspot is present and diving is possible", () => {
    render(
      <Stage
        content={contentWith({ targetSceneId: TARGET, label: "See the rhythm strip" })}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        onHotspot={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "See the rhythm strip" })).toBeInTheDocument();
  });

  it("falls back to a name derived from the element when no label is authored", () => {
    render(
      <Stage
        content={contentWith({ targetSceneId: TARGET })}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        onHotspot={vi.fn()}
        hotspotName={() => "Expand: Rhythm strip"}
      />,
    );
    expect(screen.getByRole("button", { name: "Expand: Rhythm strip" })).toBeInTheDocument();
  });

  it("activates on click with the target scene id", () => {
    const onHotspot = vi.fn();
    render(
      <Stage
        content={contentWith({ targetSceneId: TARGET, label: "Go" })}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        onHotspot={onHotspot}
      />,
    );
    screen.getByRole("button", { name: "Go" }).click();
    expect(onHotspot).toHaveBeenCalledWith(TARGET);
  });

  it("renders no button where there is no hotspot", () => {
    render(
      <Stage
        content={contentWith(null)}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        onHotspot={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders no button when the surface cannot dive — the editor and thumbnails", () => {
    render(
      <Stage
        content={contentWith({ targetSceneId: TARGET, label: "Go" })}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
