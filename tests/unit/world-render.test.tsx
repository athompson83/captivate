import { describe, expect, it, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileText } from "lucide-react";
import { World } from "@/components/stage/world";
import { EmptyState } from "@/components/ui/misc";
import { getTheme } from "@/lib/schema/theme";
import { arrange } from "@/lib/present/arrange";
import { composeScene } from "@/lib/editor/layouts";
import { JOURNEY_DEFAULTS, type Scene } from "@/lib/schema/presentation";

const STAGE = { width: 1600, height: 900 };
const theme = getTheme("midnight");

/**
 * jsdom gives every element a zero bounding box, so the world never measures a
 * viewport and never renders anything. One stub, applied once, is the whole
 * difference between testing this component and not being able to.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    // Only the measured container matters; children are positioned absolutely.
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

function makeScenes(count: number): Scene[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    presentationId: "00000000-0000-4000-8000-000000000fff",
    sectionId: null,
    position: i,
    title: `Scene ${i + 1}`,
    content: composeScene("statement", { heading: `Heading number ${i + 1}` }),
    placement: null,
    speakerNotes: "",
    durationSeconds: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }));
}

function renderWorld(count: number, extra: Partial<React.ComponentProps<typeof World>> = {}) {
  const scenes = makeScenes(count);
  const placements = arrange("reel", scenes, STAGE);
  return {
    scenes,
    placements,
    ...render(
      <World
        scenes={scenes}
        placements={placements}
        theme={theme}
        aspect="16:9"
        focus={{ kind: "scene", index: 0 }}
        activeIndex={0}
        step={0}
        travel="cut"
        pace={JOURNEY_DEFAULTS.pace}
        depth={JOURNEY_DEFAULTS.depth}
        {...extra}
      />,
    ),
  };
}

describe("the world", () => {
  it("puts the focused scene under the camera", () => {
    renderWorld(4);
    const world = document.querySelector<HTMLElement>("[data-world]");
    expect(world).not.toBeNull();
    // Scene 0 sits at the world origin, so the camera translates to nothing.
    expect(world!.style.transform).toContain("translate(0px, 0px)");
    expect(world!.style.transform).toContain("translate(800px, 450px)");
  });

  it("frames a different scene when the focus moves", () => {
    const scenes = makeScenes(4);
    const placements = arrange("reel", scenes, STAGE);
    const { rerender } = render(
      <World
        scenes={scenes}
        placements={placements}
        theme={theme}
        aspect="16:9"
        focus={{ kind: "scene", index: 0 }}
        activeIndex={0}
        step={0}
        travel="cut"
        pace={1}
        depth={0}
      />,
    );

    rerender(
      <World
        scenes={scenes}
        placements={placements}
        theme={theme}
        aspect="16:9"
        focus={{ kind: "scene", index: 2 }}
        activeIndex={2}
        step={0}
        travel="cut"
        pace={1}
        depth={0}
      />,
    );

    const world = document.querySelector<HTMLElement>("[data-world]");
    expect(world!.style.transform).toContain(`translate(-${placements[2].x}px, 0px)`);
  });

  it("does not render scenes far outside the camera's view", () => {
    // Fifty scenes in a reel is a very wide world; only the near ones exist.
    renderWorld(50);
    const drawn = document.querySelectorAll("[data-scene-index]");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(50);
  });

  it("always renders the active scene, however the camera is framed", () => {
    renderWorld(50, { focus: { kind: "world" }, activeIndex: 40 });
    expect(document.querySelector('[data-scene-index="40"]')).not.toBeNull();
  });

  it("draws distant regions as named landmarks rather than unreadable text", () => {
    // Pulled back over fifty scenes, none is more than a few pixels wide. A
    // region shows its name and nothing else — no number, no border, no card.
    renderWorld(50, { focus: { kind: "world" } });
    expect(screen.queryByText("Heading number 1")).toBeNull();
    expect(screen.getByText("Scene 1")).toBeInTheDocument();
  });

  it("does not paint a scene's own colour as a rectangle on the world", () => {
    // A colour is atmosphere, an image is content. A scene that sets a solid
    // or gradient background gets its palette blended into the surrounding air
    // by the ambient field; painting it again as a filled box just draws the
    // slide edge back on.
    const scenes = makeScenes(2).map((scene) => ({
      ...scene,
      content: {
        ...scene.content,
        background: { kind: "solid" as const, color: { kind: "hex" as const, hex: "#B02A2A" } },
      },
    }));
    render(
      <World
        scenes={scenes}
        placements={arrange("reel", scenes, STAGE)}
        theme={theme}
        aspect="16:9"
        focus={{ kind: "scene", index: 0 }}
        activeIndex={0}
        step={0}
        travel="cut"
        pace={1}
        depth={0}
      />,
    );
    const region = document.querySelector<HTMLElement>('[data-scene-index="0"] [data-stage]');
    expect(region!.style.background).toBe("");
  });

  it("gives a region no edge of its own", () => {
    // The whole point of the world: scenes are regions of one surface, not
    // cards on it. A border or a filled box here is what made the first
    // version read as slides on a wall.
    renderWorld(4, { focus: { kind: "scene", index: 0 } });
    const region = document.querySelector<HTMLElement>('[data-scene-index="0"] [data-stage]');
    expect(region).not.toBeNull();
    expect(region!.style.background).toBe("");
    expect(region!.style.border).toBe("");
    expect(region!.style.overflow).toBe("visible");
  });

  it("renders scene content when the camera is close enough to read it", () => {
    renderWorld(4, { focus: { kind: "scene", index: 0 } });
    expect(screen.getByText("Heading number 1")).toBeInTheDocument();
  });

  it("shows the route only when asked", () => {
    const { unmount } = renderWorld(4, { focus: { kind: "world" }, showPath: true });
    expect(document.querySelector("svg path")).not.toBeNull();
    unmount();

    renderWorld(4, { focus: { kind: "world" }, showPath: false });
    expect(document.querySelector("svg path")).toBeNull();
  });

  it("announces nothing to the audience that belongs to the presenter", () => {
    // The stage renders scenes and nothing else. Speaker notes are not loaded
    // into this component at all, and this asserts they are not reachable.
    const scenes = makeScenes(3).map((s) => ({ ...s, speakerNotes: "Do not read this aloud" }));
    render(
      <World
        scenes={scenes}
        placements={arrange("reel", scenes, STAGE)}
        theme={theme}
        aspect="16:9"
        focus={{ kind: "scene", index: 0 }}
        activeIndex={0}
        step={0}
        travel="cut"
        pace={1}
        depth={0}
      />,
    );
    expect(screen.queryByText(/Do not read this aloud/)).toBeNull();
  });
});

describe("a flight in progress", () => {
  /**
   * Drives requestAnimationFrame by hand so a flight can be stepped.
   *
   * `cancelAnimationFrame` really has to drop the callback: a mock that only
   * pretends to cancel makes this whole file unable to see the bug below, and
   * a regression test that cannot fail is worse than no test at all.
   */
  function controllableFrames() {
    const pending = new Map<number, FrameRequestCallback>();
    let id = 0;
    const original = {
      raf: globalThis.requestAnimationFrame,
      caf: globalThis.cancelAnimationFrame,
    };

    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      id += 1;
      pending.set(id, cb);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((handle: number) => {
      pending.delete(handle);
    }) as typeof cancelAnimationFrame;

    return {
      step(now: number) {
        const due = [...pending.entries()];
        pending.clear();
        for (const [, cb] of due) cb(now);
      },
      get scheduled() {
        return pending.size;
      },
      restore() {
        globalThis.requestAnimationFrame = original.raf;
        globalThis.cancelAnimationFrame = original.caf;
      },
    };
  }

  it("keeps flying when something else re-renders the tree", () => {
    // The bug this exists for: the flight effect re-runs on every render,
    // because its `target` is a fresh object each time. When the animation
    // frame was cancelled by that effect's cleanup, the early-return path for
    // an unchanged destination never restarted it — so the camera set off and
    // froze. The session clock ticks once a second, so in practice every
    // single flight died halfway across.
    const frames = controllableFrames();
    try {
      const scenes = makeScenes(4);
      const placements = arrange("reel", scenes, STAGE);
      const props = (index: number, spare: number) => ({
        scenes,
        placements,
        theme,
        aspect: "16:9" as const,
        focus: { kind: "scene" as const, index },
        activeIndex: index,
        step: spare,
        travel: "fly" as const,
        pace: 1,
        depth: 0,
      });

      const { rerender } = render(<World {...props(0, 0)} />);
      rerender(<World {...props(2, 0)} />);

      frames.step(0);
      frames.step(120);
      const world = document.querySelector<HTMLElement>("[data-world]");
      const partway = world!.style.transform;

      // Something unrelated re-renders — a clock tick, an annotation, a bar.
      rerender(<World {...props(2, 1)} />);

      expect(frames.scheduled).toBeGreaterThan(0);
      frames.step(400);
      expect(world!.style.transform).not.toBe(partway);
    } finally {
      frames.restore();
    }
  });

  it("arrives at the destination it was last given", () => {
    const frames = controllableFrames();
    try {
      const scenes = makeScenes(4);
      const placements = arrange("reel", scenes, STAGE);
      const props = (index: number) => ({
        scenes,
        placements,
        theme,
        aspect: "16:9" as const,
        focus: { kind: "scene" as const, index },
        activeIndex: index,
        step: 0,
        travel: "fly" as const,
        pace: 1,
        depth: 0,
      });

      const { rerender } = render(<World {...props(0)} />);
      rerender(<World {...props(3)} />);
      for (let t = 0; t <= 6000; t += 100) frames.step(t);

      const world = document.querySelector<HTMLElement>("[data-world]");
      expect(world!.style.transform).toContain(`translate(-${placements[3].x}px, 0px)`);
    } finally {
      frames.restore();
    }
  });
});

describe("empty state", () => {
  it("takes a rendered icon rather than a component", () => {
    // Regression: passing `icon={FileText}` from a server component throws at
    // request time, because a function cannot cross the client boundary. The
    // dashboard's empty state — the first screen a new account sees — was
    // blank because of it. Passing an element is what makes it serialisable.
    render(
      <EmptyState icon={<FileText />} title="No presentations yet" description="Create one." />,
    );
    expect(screen.getByText("No presentations yet")).toBeInTheDocument();
    expect(document.querySelector("svg")).not.toBeNull();
  });
});
