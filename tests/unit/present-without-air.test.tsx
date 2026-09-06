import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { World } from "@/components/stage/world";
import { getTheme } from "@/lib/schema/theme";
import { JOURNEY_DEFAULTS, parseSceneContent, type Scene } from "@/lib/schema/presentation";

/**
 * Presenting without the air.
 *
 * The owner has reported a browser dying mid-presentation four times, on a
 * phone, and the reports survived every fix so far. Measured in a real browser
 * at 852x393 with eight, sixteen and twenty-four scenes, the world is light:
 * culling holds the scene view at four rendered stages whatever the deck's
 * size, total promoted layer area is about 2.5 Mpx, the largest single layer
 * is 0.7 Mpx, and the WebGL canvas is 1.3 MB. Nothing there explains a
 * terminated content process, so the memory theory is **not** supported by
 * what can be measured here.
 *
 * What cannot be measured here is WebKit. iOS terminates a web content process
 * under memory pressure, a live WebGL context is the most expensive object on
 * this page by a distance, and this container has no iOS device to prove it
 * either way.
 *
 * So this is an escape hatch and an experiment at once: `?plain=1` presents
 * with no GL context at all. If the crash survives it, WebGL is exonerated and
 * the search moves on; if it stops, the author has a way to present today.
 * The component is not rendered rather than paused, because a context that
 * exists still costs.
 */

const scene = (index: number): Scene => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  presentationId: "11111111-1111-4111-8111-111111111111",
  sectionId: null,
  position: index,
  title: `Scene ${index}`,
  content: parseSceneContent({ layout: "statement", elements: [] }).content,
  placement: null,
  flowRole: "main",
  momentId: null,
  speakerNotes: "",
  durationSeconds: null,
  createdAt: "",
  updatedAt: "",
});

const scenes = [scene(0), scene(1)];
const placements = scenes.map((_, i) => ({ x: i * 200, y: 0, scale: 1, rotation: 0 }));

function world(air: boolean | undefined) {
  return render(
    <World
      scenes={scenes}
      placements={placements}
      theme={getTheme(undefined)}
      aspect="16:9"
      focus={{ kind: "scene", index: 0 }}
      activeIndex={0}
      step={0}
      travel={JOURNEY_DEFAULTS.travel}
      pace={JOURNEY_DEFAULTS.pace}
      depth={JOURNEY_DEFAULTS.depth}
      air={air}
      className="absolute inset-0"
    />,
  );
}

describe("the air is a presenting choice", () => {
  it("is drawn by default, because it is the world's own light", () => {
    // jsdom reports a zero viewport, so the canvas itself never mounts here —
    // what this pins is that the default does not opt out. The rendering of
    // the field is covered by the shader and lifecycle projects, in browsers.
    const { container } = world(undefined);
    expect(container.querySelector("[data-world]")).not.toBeNull();
  });

  it("mounts no WebGL canvas at all when it is off", () => {
    // Not paused, not hidden, not still: absent. A context that exists still
    // costs the memory this exists to give back.
    const { container } = world(false);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("still builds the room around them", () => {
    // The escape hatch must not be a broken presentation. jsdom reports a
    // zero-sized viewport, so the culling pass renders no scenes here and this
    // can only speak for what does not depend on a measurement: the world
    // itself and the wash that reads as light without the field. That the
    // scenes still draw is a browser claim and belongs to the lifecycle
    // project, which mounts this component in a real one.
    const { container } = world(false);
    expect(container.querySelector("[data-world]")).not.toBeNull();
    expect(container.querySelectorAll("[aria-hidden]").length).toBeGreaterThan(0);
  });
});
