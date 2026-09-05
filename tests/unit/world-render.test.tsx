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
    momentId: null,
    speakerNotes: "",
    durationSeconds: null,
    flowRole: "main" as const,
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

describe("the spotlight", () => {
  it("darkens the world beyond the scene once the camera has landed on it", () => {
    const { container } = renderWorld(3, { play: true, travel: "cut" });
    const spotlight = container.querySelector("[data-spotlight]") as HTMLElement | null;
    expect(spotlight).not.toBeNull();
    // A cut lands at once, so the light is already down around the region.
    expect(spotlight?.dataset.spotlight).toBe("lit");
    expect(Number(spotlight?.style.opacity)).toBeGreaterThan(0);
    // Four feathered bands, none of them a box: each is a gradient that
    // starts transparent at the frame's own padding.
    const bands = Array.from(spotlight?.children ?? []) as HTMLElement[];
    expect(bands).toHaveLength(4);
    for (const band of bands)
      expect(band.style.background).toMatch(
        /linear-gradient\(to (top|bottom|left|right), transparent 0px/,
      );
    // It is presentation furniture, never read out.
    expect(spotlight?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not exist over the whole world, where every scene is the subject", () => {
    const { container } = renderWorld(3, { play: true, travel: "cut", focus: { kind: "world" } });
    expect(container.querySelector("[data-spotlight]")).toBeNull();
  });

  it("is absent from the editor canvas, which is not a performance", () => {
    const { container } = renderWorld(3, { travel: "cut" });
    expect(container.querySelector("[data-spotlight]")).toBeNull();
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

describe("stage tokens", () => {
  it("defines the theme tokens on the world container", () => {
    // Anything drawn over the world — the movement rail, the signpost —
    // resolves these. When they were only set inside the world, everything
    // layered on top silently fell back to whatever the page was using.
    renderWorld(3);
    const container = document.querySelector<HTMLElement>("[data-world]")!
      .parentElement as HTMLElement;
    expect(container.style.getPropertyValue("--stage-ink")).toBeTruthy();
    expect(container.style.getPropertyValue("--stage-accent")).toBeTruthy();
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

describe("the movement rail's strip", () => {
  /**
   * The rail overlays 132px on the left of the present viewport, and the
   * camera framed scenes into the full window — so a wide scene ran under
   * it. With `safeInsetLeft` the camera centres and fits within the clear
   * area instead: the frame's origin shifts right by the inset and its
   * centre sits at inset + (width − inset) / 2.
   */
  it("frames the scene into the clear area, not under the rail", () => {
    const { container } = renderWorld(4, { safeInsetLeft: 132 });
    const world = container.querySelector<HTMLElement>("[data-world]") ?? findWorld(container);
    expect(world!.style.transform.startsWith("translate(132px, 0px)")).toBe(true);
    // (1600 − 132) / 2 = 734: the centre of what the rail leaves clear.
    expect(world!.style.transform).toContain("translate(734px, 450px)");
  });

  it("reserves nothing when no rail is shown", () => {
    const { container } = renderWorld(4);
    const world = findWorld(container);
    expect(world!.style.transform.startsWith("translate(800px, 450px)")).toBe(true);
  });

  it("reserves nothing below the rail's own breakpoint, where it hides itself", () => {
    const wide = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 600,
        bottom: 900,
        width: 600,
        height: 900,
        toJSON: () => ({}),
      } as DOMRect;
    };
    try {
      const { container } = renderWorld(4, { safeInsetLeft: 132 });
      const world = findWorld(container);
      // Centre of the full 600px window — the hidden rail must cost nothing.
      expect(world!.style.transform.startsWith("translate(300px, 450px)")).toBe(true);
    } finally {
      Element.prototype.getBoundingClientRect = wide;
    }
  });
});

/** The transformed element: the one carrying a style.transform translate. */
function findWorld(container: HTMLElement): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>("div")].find((el) =>
      el.style.transform.includes("translate"),
    ) ?? null
  );
}

describe("the backdrop", () => {
  it("is absent until the author sets a picture", () => {
    const { container } = renderWorld(3);
    expect(container.querySelector("[data-backdrop]")).toBeNull();
  });

  it("paints the picture on its own layer behind the world, dimmed toward the canvas", () => {
    const { container } = renderWorld(3, {
      backdrop: {
        url: "/api/assets/abc/content",
        assetId: "abc",
        alt: "a hall",
        distance: 0.5,
        dim: 0.4,
      },
    });
    const layer = container.querySelector("[data-backdrop]");
    expect(layer).not.toBeNull();
    expect(layer!.querySelector("img")?.getAttribute("src")).toBe("/api/assets/abc/content");
    // Decorative: the alt is the author's note, not something read to the room.
    expect(layer!.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(layer!.getAttribute("aria-hidden")).toBe("true");
    // Below the content in document order, so the scenes paint over it.
    const world = container.querySelector("[data-world]")!;
    expect(layer!.compareDocumentPosition(world) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("paints nothing when the picture was removed", () => {
    const { container } = renderWorld(3, {
      backdrop: { url: "", assetId: null, alt: "", distance: 0.5, dim: 0.35 },
    });
    expect(container.querySelector("[data-backdrop]")).toBeNull();
  });
});

/**
 * The camera lands, and only then does the scene under it perform. The
 * world owns that fact — it is the one thing that knows a flight is still
 * in progress — and hands it to the stage as `arrived`.
 */
describe("performing on arrival", () => {
  it("holds the destination's performance while the camera is on its way", () => {
    const scenes = makeScenes(50);
    const placements = arrange("reel", scenes, STAGE);
    const props = {
      scenes,
      placements,
      theme,
      aspect: "16:9" as const,
      step: 0,
      travel: "fly" as const,
      pace: 1,
      depth: 0,
      play: true,
    };
    const { rerender } = render(
      <World {...props} focus={{ kind: "scene", index: 0 }} activeIndex={0} />,
    );
    // First paint arrives at once: the opening scene performs immediately.
    expect(document.querySelectorAll('[data-scene-index="0"] [data-held]')).toHaveLength(0);

    // A flight to a scene far enough away that it was not on screen. It
    // mounts held; nothing on it performs until the camera lands.
    rerender(<World {...props} focus={{ kind: "scene", index: 40 }} activeIndex={40} />);
    const held = document.querySelectorAll('[data-scene-index="40"] [data-held]');
    expect(held.length).toBeGreaterThan(0);
  });

  it("does not count an establishing shot over a section as arriving", () => {
    // Crossing into a movement, the camera first lands pulled back over the
    // whole section, then dives. The first scene of the section is held
    // through that beat; it performs when the camera lands on *it*.
    const scenes = makeScenes(6).map((scene, i) => ({
      ...scene,
      sectionId: i < 3 ? "sec-a" : "sec-b",
    }));
    const placements = arrange("reel", scenes, STAGE);
    const props = {
      scenes,
      placements,
      theme,
      aspect: "16:9" as const,
      step: 0,
      travel: "cut" as const,
      pace: 1,
      depth: 0,
      play: true,
    };
    const { rerender } = render(
      <World {...props} focus={{ kind: "scene", index: 0 }} activeIndex={0} />,
    );
    rerender(<World {...props} focus={{ kind: "section", sectionId: "sec-b" }} activeIndex={3} />);
    // The cut landed on the section framing at once — and the scene is still held.
    expect(document.querySelectorAll('[data-scene-index="3"] [data-held]').length).toBeGreaterThan(
      0,
    );

    rerender(<World {...props} focus={{ kind: "scene", index: 3 }} activeIndex={3} />);
    expect(document.querySelectorAll('[data-scene-index="3"] [data-held]')).toHaveLength(0);
  });

  it("lets a cut arrive at once, so the new scene performs immediately", () => {
    const scenes = makeScenes(50);
    const placements = arrange("reel", scenes, STAGE);
    const props = {
      scenes,
      placements,
      theme,
      aspect: "16:9" as const,
      step: 0,
      travel: "cut" as const,
      pace: 1,
      depth: 0,
      play: true,
    };
    const { rerender } = render(
      <World {...props} focus={{ kind: "scene", index: 0 }} activeIndex={0} />,
    );
    rerender(<World {...props} focus={{ kind: "scene", index: 40 }} activeIndex={40} />);
    expect(document.querySelectorAll('[data-scene-index="40"] [data-held]')).toHaveLength(0);
  });

  it("lets the scenes beside the current one recede while presenting", () => {
    renderWorld(4, { play: true });
    const active = document.querySelector<HTMLElement>('[data-scene-index="0"]');
    expect(active!.style.opacity).toBe("1");
    const neighbours = [...document.querySelectorAll<HTMLElement>("[data-scene-index]")].filter(
      (region) => region.dataset.sceneIndex !== "0" && region.querySelector("[data-stage]"),
    );
    expect(neighbours.length).toBeGreaterThan(0);
    for (const region of neighbours) expect(region.style.opacity).toBe("0.6");
  });

  it("lights every scene in a section's establishing shot", () => {
    const scenes = makeScenes(4).map((scene) => ({ ...scene, sectionId: "sec-a" }));
    render(
      <World
        scenes={scenes}
        placements={arrange("reel", scenes, STAGE)}
        theme={theme}
        aspect="16:9"
        focus={{ kind: "section", sectionId: "sec-a" }}
        activeIndex={0}
        step={0}
        travel="cut"
        pace={1}
        depth={0}
        play
      />,
    );
    for (const region of document.querySelectorAll<HTMLElement>("[data-scene-index]")) {
      expect(region.style.opacity).toBe("1");
    }
  });

  it("treats every scene as the subject in the overview, and in the editor", () => {
    const overview = renderWorld(4, { play: true, focus: { kind: "world" } });
    for (const region of document.querySelectorAll<HTMLElement>("[data-scene-index]")) {
      expect(region.style.opacity).toBe("1");
    }
    overview.unmount();

    renderWorld(4);
    for (const region of document.querySelectorAll<HTMLElement>("[data-scene-index]")) {
      expect(region.style.opacity).toBe("1");
    }
  });
});
