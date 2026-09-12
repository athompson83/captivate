import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stage } from "@/components/stage/stage";
import { getTheme } from "@/lib/schema/theme";
import { composeScene } from "@/lib/editor/layouts";
import { SceneContent } from "@/lib/schema/presentation";

const theme = getTheme("midnight");

function renderStage(content: SceneContent) {
  return render(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} />);
}

describe("stage rendering", () => {
  it("renders headings and bullets as real text", () => {
    const content = composeScene("bullets", {
      heading: "Recognising shock",
      bullets: ["Tachycardia first", "Pressure falls late"],
    });

    renderStage(content);

    expect(screen.getByText("Recognising shock")).toBeInTheDocument();
    expect(screen.getByText("Tachycardia first")).toBeInTheDocument();
    expect(screen.getByText("Pressure falls late")).toBeInTheDocument();
  });

  it("renders markup in content as literal text, never as HTML", () => {
    // Text is rendered from typed runs, so there is no innerHTML path at all.
    const content = SceneContent.parse({
      elements: [
        {
          id: "t",
          type: "text",
          frame: { x: 10, y: 10, w: 60, h: 20 },
          content: [{ text: "<img src=x onerror=alert(1)>" }],
        },
      ],
    });

    const { container } = renderStage(content);

    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("gives images their alt text", () => {
    const content = composeScene("media-full", {
      heading: "A photo",
      media: { url: "https://example.com/x.jpg", alt: "A paramedic assessing a patient" },
    });

    renderStage(content);
    expect(screen.getByAltText("A paramedic assessing a patient")).toBeInTheDocument();
  });

  it("exposes a chart's summary to assistive technology", () => {
    const content = composeScene("chart", {
      heading: "Growth",
      chart: {
        chart: "column",
        data: [
          { label: "Q1", value: 10 },
          { label: "Q2", value: 20 },
        ],
        summary: "Doubled between Q1 and Q2.",
      },
    });

    renderStage(content);
    expect(screen.getByRole("img", { name: "Doubled between Q1 and Q2." })).toBeInTheDocument();
  });

  it("sandboxes embedded content", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "e",
          type: "embed",
          frame: { x: 10, y: 10, w: 60, h: 40 },
          url: "https://example.com/embed",
          title: "An embed",
        },
      ],
    });

    renderStage(content);
    const frame = screen.getByTitle("An embed");
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups");
    expect(frame).toHaveAttribute("referrerPolicy", "no-referrer");
  });

  it("does not render hidden elements", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "shown",
          type: "text",
          frame: { x: 0, y: 0, w: 20, h: 10 },
          content: [{ text: "visible" }],
        },
        {
          id: "hidden",
          type: "text",
          frame: { x: 0, y: 20, w: 20, h: 10 },
          content: [{ text: "invisible" }],
          hidden: true,
        },
      ],
    });

    renderStage(content);
    expect(screen.getByText("visible")).toBeInTheDocument();
    expect(screen.queryByText("invisible")).toBeNull();
  });

  it("holds back build-on-advance elements until their step", () => {
    const content = SceneContent.parse({
      elements: [
        {
          id: "always",
          type: "text",
          frame: { x: 0, y: 0, w: 20, h: 10 },
          content: [{ text: "always" }],
        },
        {
          id: "later",
          type: "text",
          frame: { x: 0, y: 20, w: 20, h: 10 },
          content: [{ text: "later" }],
          animation: { onAdvance: true },
        },
      ],
    });

    const { rerender } = render(
      <Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={0} />,
    );
    expect(screen.getByText("always")).toBeInTheDocument();
    expect(screen.queryByText("later")).toBeNull();

    rerender(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={1} />);
    expect(screen.getByText("later")).toBeInTheDocument();
  });

  it("reveals a staggered list one item at a time while presenting", () => {
    const content = composeScene("bullets", {
      heading: "Points",
      bullets: ["first", "second", "third"],
    });

    const { rerender } = render(
      <Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={0} />,
    );
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("second")).toBeNull();

    rerender(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={1} />);
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("third")).toBeNull();
  });

  it("shows the whole list when the scene is not being presented", () => {
    // In the editor the author needs to see everything, not a build state.
    const content = composeScene("bullets", { heading: "H", bullets: ["a", "b", "c"] });
    renderStage(content);
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("renders an empty scene without crashing", () => {
    const { container } = renderStage(SceneContent.parse({ elements: [] }));
    expect(container.querySelector("[data-stage]")).not.toBeNull();
  });
});

describe("text auto-fit", () => {
  /** Reads back the font size the stage actually applied to an element. */
  function fontSizeOf(el: Element | null): number {
    return Number.parseFloat((el as HTMLElement).style.fontSize || "0");
  }

  it("keeps a short heading at its authored size", () => {
    const content = composeScene("title", { heading: "Shock" });
    const { container } = renderStage(content);
    // 5.4rem at a 16px stage rem, unmodified.
    expect(fontSizeOf(container.querySelector("h1"))).toBeCloseTo(5.4 * 16, 1);
  });

  it("shrinks a heading that would overflow its box", () => {
    const long = composeScene("title", {
      heading:
        "Recognising and managing compensated shock for second-year paramedic students in the field",
    });
    const { container } = renderStage(long);

    const size = fontSizeOf(container.querySelector("h1"));
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(5.4 * 16);
  });

  it("shrinks a list that genuinely overflows its box", () => {
    const short = composeScene("bullets", { heading: "H", bullets: ["One", "Two"] });
    const long = composeScene("bullets", {
      heading: "H",
      bullets: Array.from(
        { length: 12 },
        (_, i) => `Point ${i + 1}: a considerably longer line that runs on for a good while`,
      ),
    });

    const shortSize = fontSizeOf(
      render(
        <Stage content={short} theme={theme} aspect="16:9" fixedScale={1} />,
      ).container.querySelector("ul"),
    );
    const longSize = fontSizeOf(
      render(
        <Stage content={long} theme={theme} aspect="16:9" fixedScale={1} />,
      ).container.querySelector("ul"),
    );

    expect(longSize).toBeLessThan(shortSize);
  });

  it("leaves a list that fits at its authored size", () => {
    // Auto-fit must not quietly shrink content that was already fine.
    const content = composeScene("bullets", {
      heading: "H",
      bullets: ["Tachycardia first", "Narrow pulse pressure", "Delayed capillary refill"],
    });
    const { container } = renderStage(content);

    // Derived from what the composer actually chose rather than restating the
    // constant: the property under test is that auto-fit left it alone, and a
    // hardcoded size makes this fail whenever the type scale is tuned, which
    // says nothing about fitting.
    const list = content.elements.find((element) => element.type === "list");
    const authored = list && "style" in list ? list.style.size : 0;
    expect(fontSizeOf(container.querySelector("ul"))).toBeCloseTo(3.4 * 16 * authored, 2);
  });

  it("applies the same fit in a thumbnail as on the stage", () => {
    // A thumbnail renders the stage at fixedScale 1 inside a CSS transform, so
    // the computed font size must be identical — otherwise a card preview would
    // not match what gets projected.
    const content = composeScene("title", {
      heading: "Recognising and managing compensated shock for paramedic students",
    });

    const a = render(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} />);
    const b = render(<Stage content={content} theme={theme} aspect="16:9" fixedScale={0.2} />);

    expect(fontSizeOf(a.container.querySelector("h1"))).toBeCloseTo(
      fontSizeOf(b.container.querySelector("h1")),
      5,
    );
  });
});

describe("an image with no image", () => {
  it("does not darken the space where a photograph is not", () => {
    // A scrim exists to keep a caption legible over a photograph. Rendered
    // over an empty placeholder it is a dark rectangle over nothing, and on
    // the world canvas that reads as a slide sitting on the page.
    const content = composeScene("media-full", { caption: "A caption" });
    const withScrim = {
      ...content,
      elements: content.elements.map((element) =>
        element.type === "image" ? { ...element, url: "", scrim: 0.6 } : element,
      ),
    };

    render(<Stage content={withScrim} theme={getTheme("midnight")} aspect="16:9" fixedScale={1} />);

    const scrims = [...document.querySelectorAll<HTMLElement>("div[aria-hidden]")].filter((el) =>
      el.style.background.includes("linear-gradient(to top"),
    );
    expect(scrims).toHaveLength(0);
  });
});

/**
 * A scene performs when the camera lands, not when the flight begins.
 *
 * `arrived` is the world's word for whether the camera is on its destination.
 * An element that mounts while it is false is held at the start of its
 * entrance and released when it turns true; one that was already on screen
 * is left alone. Nothing here is about the editor, where `play` is off and
 * the finished composition is what an author needs to see.
 */
describe("performing a scene on arrival", () => {
  const drawn = SceneContent.parse({
    elements: [
      {
        id: "claim",
        type: "text",
        frame: { x: 0, y: 0, w: 40, h: 10 },
        content: [{ text: "The claim" }],
      },
      {
        id: "sketch",
        type: "drawing",
        frame: { x: 0, y: 20, w: 40, h: 40 },
        viewBox: { width: 100, height: 100 },
        paths: [
          { d: "M10 10 L90 10", stage: 0 },
          { d: "M10 50 L90 50", stage: 1 },
        ],
      },
    ],
  });

  it("holds what mounts before the camera lands, then performs it", () => {
    const { container, rerender } = render(
      <Stage
        content={drawn}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    // Both elements are held at their entrance's start, and the drawing has
    // not begun its first stroke: that stroke is for the room to watch.
    expect(container.querySelectorAll("[data-held]")).toHaveLength(2);
    expect(container.querySelectorAll(".dp-drawn")).toHaveLength(0);

    rerender(
      <Stage content={drawn} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(0);
    // Stage 0 sketches on landing; stage 1 still waits for the presenter.
    expect(container.querySelectorAll("path.dp-path.dp-drawn:not(.dp-under)")).toHaveLength(1);
  });

  it("leaves alone an element that was on screen when the flight began", () => {
    // A neighbour visible at the edge of the previous scene must not vanish
    // when the camera sets off towards it. An entrance is for what the
    // audience has not seen.
    const { container, rerender } = render(
      <Stage content={drawn} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(0);

    rerender(
      <Stage
        content={drawn}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(0);
    expect(container.querySelectorAll("path.dp-path.dp-drawn:not(.dp-under)")).toHaveLength(1);
  });

  it("never holds anything in the editor", () => {
    const { container } = render(
      <Stage content={drawn} theme={theme} aspect="16:9" fixedScale={1} arrived={false} />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(0);
    expect(screen.getByText("The claim")).toBeInTheDocument();
  });

  it("counts a figure up only while it is performed", () => {
    const content = composeScene("figure", {
      heading: "Most calls are not emergencies",
      figure: { value: "7.6%", label: "of calls" },
    });

    // The editor and a thumbnail show the number as written.
    const still = render(<Stage content={content} theme={theme} aspect="16:9" fixedScale={1} />);
    expect(still.container.textContent).toContain("7.6%");
    still.unmount();

    // Performed, the climb starts from nothing — written to the text node,
    // so the number React rendered (and auto-fit measured) is the real one.
    const live = render(
      <Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    const digits = live.container.querySelector<HTMLElement>('span[style*="tabular-nums"]');
    expect(digits).not.toBeNull();
    expect(digits!.textContent).toBe("0.0");
    expect(live.container.textContent).toContain("%");
    live.unmount();
  });

  it("builds a chart in only while it is performed", () => {
    const column = composeScene("chart", {
      heading: "Growth",
      chart: {
        chart: "column",
        data: [
          { label: "Q1", value: 10 },
          { label: "Q2", value: 20 },
        ],
        summary: "Doubled.",
      },
    });

    // A chart is a drawing by the same hand: a baseline and two columns,
    // sketched complete in the editor, on arrival while presenting, and
    // held for the camera like a drawing.
    // The washes are counted — one per amount — whatever the baseline and
    // the shade add in strokes.
    const washes = (root: HTMLElement) => root.querySelectorAll("path.dp-fill");
    const drawn = (root: HTMLElement) => root.querySelectorAll("path.dp-fill.dp-drawn");
    const still = renderStage(column);
    expect(washes(still.container)).toHaveLength(2);
    expect(drawn(still.container)).toHaveLength(2);
    expect(still.container.querySelectorAll("path.dp-path:not(.dp-under)").length).toBeGreaterThan(
      3,
    );
    still.unmount();

    const live = render(
      <Stage content={column} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    expect(drawn(live.container)).toHaveLength(2);
    live.unmount();

    const held = render(
      <Stage
        content={column}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    expect(washes(held.container)).toHaveLength(2);
    expect(drawn(held.container)).toHaveLength(0);
    held.unmount();

    const line = composeScene("chart", {
      heading: "Trend",
      chart: {
        chart: "line",
        data: [
          { label: "Q1", value: 10 },
          { label: "Q2", value: 20 },
        ],
        summary: "Up.",
      },
    });
    const drawnLine = render(
      <Stage content={line} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    // The area under the line and a filled mark at each of two points,
    // drawn on arrival.
    expect(drawn(drawnLine.container)).toHaveLength(3);
    expect(drawnLine.container.querySelector("svg[aria-label='Up.']")).not.toBeNull();
    drawnLine.unmount();
  });

  it("keeps a performed scene on screen when the camera pulls back", () => {
    // A scene that mounted mid-flight performed on landing. Pressing O then
    // makes the world the target and `arrived` false again — and the scene
    // must not blank out in the overview or replay itself on return.
    const { container, rerender } = render(
      <Stage
        content={drawn}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    rerender(
      <Stage content={drawn} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    rerender(
      <Stage
        content={drawn}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(0);
    expect(container.querySelectorAll("path.dp-path.dp-drawn:not(.dp-under)")).toHaveLength(1);
  });

  it("builds nothing in the distance, even on a scene that was on screen before the flight", () => {
    // A neighbour visible at the edge is mounted quietly (not playing). When
    // it becomes the destination it is never held — but its chart must still
    // wait for the landing rather than build while the camera is on its way.
    const column = composeScene("chart", {
      heading: "Growth",
      chart: {
        chart: "column",
        data: [
          { label: "Q1", value: 10 },
          { label: "Q2", value: 20 },
        ],
        summary: "Doubled.",
      },
    });
    const { container, rerender } = render(
      <Stage content={column} theme={theme} aspect="16:9" fixedScale={1} />,
    );
    rerender(
      <Stage
        content={column}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    expect(container.querySelectorAll("[data-held]")).toHaveLength(0);
    // Never held, so its strokes are down before the camera lands, and they
    // stay down when it pulls back: nothing blanks, nothing replays.
    expect(container.querySelectorAll("path.dp-fill.dp-drawn")).toHaveLength(2);
    rerender(
      <Stage content={column} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    expect(container.querySelectorAll("path.dp-fill.dp-drawn")).toHaveLength(2);
  });
});

/**
 * A heading performed a word at a time. Only while performed — the editor
 * and a thumbnail show the sentence whole — and only for plain headings a
 * room can take in as a rhythm rather than a paragraph.
 */
describe("kinetic headings", () => {
  const claim = composeScene("statement", { heading: "Ninety seconds without oxygen" });

  it("arrives word by word while performed, and whole everywhere else", () => {
    const live = render(
      <Stage content={claim} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    const words = live.container.querySelectorAll(".kt-word");
    expect(words).toHaveLength(4);
    expect([...words].map((w) => w.textContent)).toEqual([
      "Ninety",
      "seconds",
      "without",
      "oxygen",
    ]);
    // Each word waits its turn; the stagger is the point.
    expect((words[3] as HTMLElement).style.getPropertyValue("--kt-i")).toBe("3");
    expect(live.container.querySelector("h1, h2, h3")?.textContent).toBe(
      "Ninety seconds without oxygen",
    );
    live.unmount();

    const still = renderStage(claim);
    expect(still.container.querySelectorAll(".kt-word")).toHaveLength(0);
    expect(screen.getByText("Ninety seconds without oxygen")).toBeInTheDocument();
    still.unmount();

    const held = render(
      <Stage
        content={claim}
        theme={theme}
        aspect="16:9"
        fixedScale={1}
        play
        step={0}
        arrived={false}
      />,
    );
    expect(held.container.querySelectorAll(".kt-word")).toHaveLength(0);
    held.unmount();
  });

  it("leaves a long heading whole", () => {
    const essay = composeScene("statement", {
      heading:
        "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen",
    });
    const { container } = render(
      <Stage content={essay} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    expect(container.querySelectorAll(".kt-word")).toHaveLength(0);
  });
});

/**
 * Each element's depth layer, present only while presenting: in the editor
 * an element sits exactly where it was put.
 */
describe("depth layers", () => {
  const content = composeScene("split-left", {
    heading: "A claim",
    bullets: ["one"],
    media: { url: "https://example.com/x.jpg", alt: "A picture" },
  });

  it("gives words and pictures their depth while presenting, and none in the editor", () => {
    const live = render(
      <Stage content={content} theme={theme} aspect="16:9" fixedScale={1} play step={0} arrived />,
    );
    const layers = [...live.container.querySelectorAll<HTMLElement>(".pxl-depth")];
    expect(layers.length).toBeGreaterThan(1);
    const depths = layers.map((layer) => Number(layer.style.getPropertyValue("--depth")));
    expect(depths.some((d) => d < 0)).toBe(true);
    expect(depths.some((d) => d > 0)).toBe(true);
    live.unmount();

    // The parallax is the presenting half and is gone here; an element in the
    // editor sits exactly where it was put.
    const still = renderStage(content);
    expect(still.container.querySelectorAll(".pxl-depth")).toHaveLength(0);
    for (const layer of still.container.querySelectorAll<HTMLElement>(".pxl")) {
      expect(layer.style.getPropertyValue("--depth")).toBe("");
    }
  });

  it("gives the wrapper its height on every surface, not only while presenting", () => {
    // The wrapper sits between an element's frame and the element, so an
    // element sized `height: 100%` — a drawing, a picture — measures against
    // it. Left unstyled in the editor and in thumbnails, it is an auto-height
    // box and every one of them collapsed to its content: a drawing rendered
    // short inside a frame that was the right size all along.
    for (const surface of [
      renderStage(content),
      render(
        <Stage
          content={content}
          theme={theme}
          aspect="16:9"
          fixedScale={1}
          play
          step={0}
          arrived
        />,
      ),
    ]) {
      const layers = surface.container.querySelectorAll(".pxl");
      expect(layers.length).toBeGreaterThan(1);
      surface.unmount();
    }
  });
});

describe("icons by the same hand", () => {
  const washOf = (root: HTMLElement, name: string) =>
    root.querySelector<SVGPathElement>(`[data-hand-icon="${name}"] [data-icon-wash]`);

  it("sets every card's icon on a wash in its own colour at the drawings' tint", () => {
    const { container } = renderStage(
      composeScene("three-up", {
        heading: "Three things the room keeps",
        cards: [
          { title: "Place", body: "Where it happened.", icon: "target" },
          { title: "Order", body: "The route.", icon: "arrow_right" },
          { title: "Pace", body: "The rhythm.", icon: "clock" },
        ],
      }),
    );
    const washes = [...container.querySelectorAll("[data-icon-wash]")];
    expect(washes).toHaveLength(3);
    for (const wash of washes) {
      expect(wash.getAttribute("fill")).toBe("currentColor");
      expect(wash.getAttribute("fill-opacity")).toBe("0.14");
      // Bent by a hand of its own, defined beside it.
      const filter = wash.getAttribute("filter")!;
      expect(filter).toMatch(/^url\(#iconwash-/);
      const id = filter.slice("url(#".length, -1);
      expect(
        wash.closest("svg")!.querySelector(`filter[id="${id}"] feDisplacementMap`),
      ).not.toBeNull();
    }
  });

  it("gives the same icon the same shape everywhere, and different icons different ones", () => {
    const heart = composeScene("takeaway", {
      eyebrow: "Keep this",
      heading: "The heart is a pump.",
      icon: "heart",
      body: "Everything else follows.",
    });
    const a = renderStage(heart);
    const b = renderStage(heart);
    expect(washOf(a.container, "heart")!.getAttribute("d")).toBe(
      washOf(b.container, "heart")!.getAttribute("d"),
    );
    const brain = renderStage({ ...heart, elements: heart.elements });
    expect(washOf(brain.container, "heart")).not.toBeNull();
    const other = renderStage(composeScene("takeaway", { heading: "x", icon: "brain", body: "y" }));
    expect(washOf(other.container, "brain")!.getAttribute("d")).not.toBe(
      washOf(a.container, "heart")!.getAttribute("d"),
    );
  });

  it("never bends the glyph itself: the wash is behind a plain icon", () => {
    const { container } = renderStage(
      composeScene("takeaway", { heading: "x", icon: "heart", body: "y" }),
    );
    const icon = container.querySelector('[data-hand-icon="heart"]')!;
    const glyph = icon.querySelector("svg.lucide, svg:not([aria-hidden])");
    expect(glyph).not.toBeNull();
    expect(glyph!.getAttribute("filter")).toBeNull();
    expect((glyph as SVGElement).style.filter).toBe("");
  });
});

describe("the phrase that matters, marked by hand", () => {
  const marked = composeScene("split-left", {
    heading: "Care is a loop, not a line.",
    body: "Reassess, or you never hear the answer.",
    bodyAccent: "Reassess",
    media: { url: "", alt: "" },
  });

  it("marks the accent run and hosts its strokes in the text, and nothing else", () => {
    const { container } = renderStage(marked);
    const marks = container.querySelectorAll("[data-hand-mark]");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("Reassess");
    const svg = container.querySelector("svg.hm")!;
    expect(svg).not.toBeNull();
    expect(svg.parentElement!.contains(marks[0])).toBe(true);
    expect(svg.querySelector("feDisplacementMap")).not.toBeNull();
    // A body with nothing marked carries no mark.
    const plain = composeScene("split-left", {
      heading: "Care is a loop, not a line.",
      body: "Reassess, or you never hear the answer.",
      media: { url: "", alt: "" },
    });
    expect(renderStage(plain).container.querySelector("svg.hm")).toBeNull();
  });
});
