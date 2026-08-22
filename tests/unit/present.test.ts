import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentMessage,
  SceneAnnotations,
  emptyAnnotations,
  channelName,
} from "@/lib/present/protocol";
import { buildStepCount, entranceFrom, entranceTo } from "@/lib/present/motion";
import { fitScale, pointerToStage, stageSize, stageRem } from "@/lib/present/stage";
import { createSession, plannedDuration } from "@/lib/present/session";
import { composeScene } from "@/lib/editor/layouts";
import type { Scene, SceneElement } from "@/lib/schema/presentation";

describe("present message protocol", () => {
  it("accepts a well-formed state message", () => {
    const message = {
      type: "state",
      sceneIndex: 3,
      step: 1,
      stepsInScene: 4,
      totalScenes: 12,
      startedAt: 1_700_000_000_000,
      sceneEnteredAt: 1_700_000_100_000,
      paused: false,
      fullscreen: true,
      overview: false,
      establishing: null,
    };
    expect(PresentMessage.safeParse(message).success).toBe(true);
  });

  it("still accepts a state message from a build that predates the camera", () => {
    // Deploying mid-presentation must not silently desync the two windows, so
    // additive camera fields default instead of rejecting the whole message.
    const parsed = PresentMessage.safeParse({
      type: "state",
      sceneIndex: 0,
      step: 0,
      stepsInScene: 1,
      totalScenes: 3,
      startedAt: null,
      sceneEnteredAt: 1_700_000_000_000,
      paused: false,
      fullscreen: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "state") {
      expect(parsed.data.overview).toBe(false);
      expect(parsed.data.establishing).toBeNull();
    }
  });

  it("rejects a message from an older or unknown protocol", () => {
    // A stale tab running an old build must not be able to drive a live
    // presentation with a half-understood message.
    expect(PresentMessage.safeParse({ type: "teleport", to: 4 }).success).toBe(false);
    expect(PresentMessage.safeParse({ type: "state", sceneIndex: -1 }).success).toBe(false);
    expect(PresentMessage.safeParse(null).success).toBe(false);
    expect(PresentMessage.safeParse("next").success).toBe(false);
  });

  it("rejects an out-of-range scene index", () => {
    expect(
      PresentMessage.safeParse({ type: "command", action: "goto", index: 100000 }).success,
    ).toBe(false);
  });

  it("rejects an unknown command", () => {
    expect(PresentMessage.safeParse({ type: "command", action: "rm -rf" }).success).toBe(false);
  });

  it("clamps pointer coordinates to a sane range", () => {
    expect(
      PresentMessage.safeParse({
        type: "pointer",
        point: { x: 0.5, y: 0.5 },
        tool: "laser",
        color: "#fff",
      }).success,
    ).toBe(true);

    expect(
      PresentMessage.safeParse({
        type: "pointer",
        point: { x: 500, y: 0.5 },
        tool: "laser",
        color: "#fff",
      }).success,
    ).toBe(false);
  });

  it("caps stroke and annotation volume", () => {
    const hugeStroke = {
      id: "s",
      color: "#fff",
      width: 1,
      points: Array.from({ length: 4001 }, () => ({ x: 0.5, y: 0.5 })),
    };
    expect(SceneAnnotations.safeParse({ strokes: [hugeStroke], highlights: [] }).success).toBe(
      false,
    );

    const tooManyStrokes = Array.from({ length: 401 }, (_, i) => ({
      id: `s${i}`,
      color: "#fff",
      width: 1,
      points: [{ x: 0, y: 0 }],
    }));
    expect(SceneAnnotations.safeParse({ strokes: tooManyStrokes, highlights: [] }).success).toBe(
      false,
    );
  });

  it("starts with no annotations", () => {
    expect(emptyAnnotations()).toEqual({ strokes: [], highlights: [] });
  });

  it("scopes the channel name to one presentation", () => {
    expect(channelName("abc")).not.toBe(channelName("def"));
    expect(channelName("abc")).toContain("abc");
  });
});

describe("advance steps", () => {
  const element = (over: Partial<SceneElement> = {}): SceneElement =>
    ({
      id: "e",
      type: "text",
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      content: [{ text: "x" }],
      hidden: false,
      locked: false,
      opacity: 1,
      animation: { entrance: "fade", delay: 0, duration: 0.5, emphasis: "none", onAdvance: false },
      style: {
        size: 1,
        weight: 400,
        align: "left",
        valign: "top",
        italic: false,
        underline: false,
        uppercase: false,
        lineHeight: 1.4,
        letterSpacing: 0,
      },
      ...over,
    }) as SceneElement;

  it("is one step for a plain scene", () => {
    expect(buildStepCount([element(), element()])).toBe(1);
  });

  it("adds a step for each build-on-advance element", () => {
    expect(
      buildStepCount([
        element(),
        element({
          animation: {
            entrance: "fade",
            delay: 0,
            duration: 0.5,
            emphasis: "none",
            onAdvance: true,
          },
        }),
      ]),
    ).toBe(2);
  });

  it("adds a step per extra item in a staggered list", () => {
    const content = composeScene("bullets", { heading: "H", bullets: ["a", "b", "c", "d"] });
    // Four items reveal over four steps: the first is visible immediately.
    expect(buildStepCount(content.elements)).toBe(4);
  });

  it("does not add steps for a list that is not staggered", () => {
    const content = composeScene("bullets", { heading: "H", bullets: ["a", "b"] });
    const list = content.elements.find((e) => e.type === "list");
    if (list?.type === "list") expect(list.staggered).toBe(false);
    expect(buildStepCount(content.elements)).toBe(1);
  });
});

describe("motion presets", () => {
  it("has a from and to state for every entrance", () => {
    const presets = [
      "none",
      "fade",
      "rise",
      "settle",
      "slide-left",
      "slide-right",
      "scale",
      "reveal",
      "blur",
    ] as const;
    for (const preset of presets) {
      expect(entranceFrom(preset), preset).toBeTypeOf("object");
      expect(entranceTo(preset).opacity, preset).toBe(1);
    }
  });
});

describe("the cross-window channel", () => {
  it("can be attached, torn down and attached again", () => {
    // React mounts, unmounts and mounts again — in development for every
    // component, and for real whenever a presenter revisits the route. A
    // channel that could only be opened once left the stage broadcasting into
    // a closed pipe, and the console reported "no stage" for the rest of the
    // presentation.
    const session = createSession({
      presentationId: "00000000-0000-4000-8000-000000000abc",
      scenes: [],
      role: "stage",
    });

    const first = session.attach();
    expect(session.channel.connected).toBe(true);
    first();
    expect(session.channel.connected).toBe(false);

    const second = session.attach();
    expect(session.channel.connected).toBe(true);
    second();
  });

  it("keeps reporting support after being closed", () => {
    const session = createSession({
      presentationId: "00000000-0000-4000-8000-000000000abd",
      scenes: [],
      role: "console",
    });
    const detach = session.attach();
    detach();
    // Support is a property of the browser, not of the current connection.
    expect(session.channel.available).toBe(true);
  });
});

describe("stage geometry", () => {
  it("derives the right pixel size per aspect ratio", () => {
    expect(stageSize("16:9")).toEqual({ width: 1600, height: 900 });
    expect(stageSize("4:3")).toEqual({ width: 1600, height: 1200 });
    expect(stageSize("16:10")).toEqual({ width: 1600, height: 1000 });
  });

  it("scales type with the stage so layouts hold at any size", () => {
    expect(stageRem(1600)).toBe(16);
    expect(stageRem(3200)).toBe(32);
  });

  it("fits by the constraining axis", () => {
    // Wide container, short: height is the limit.
    expect(fitScale({ width: 3200, height: 450 }, { width: 1600, height: 900 })).toBe(0.5);
    // Tall container, narrow: width is the limit.
    expect(fitScale({ width: 800, height: 2000 }, { width: 1600, height: 900 })).toBe(0.5);
  });

  it("never divides by zero", () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });

  it("converts a pointer position into normalised stage coordinates", () => {
    const rect = { left: 100, top: 50, width: 800, height: 450 } as DOMRect;
    expect(pointerToStage({ clientX: 500, clientY: 275 }, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps a pointer outside the stage", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    expect(pointerToStage({ clientX: -50, clientY: 500 }, rect)).toEqual({ x: 0, y: 1 });
  });
});

describe("plannedDuration", () => {
  const scene = (durationSeconds: number | null): Scene =>
    ({
      id: "s",
      presentationId: "p",
      sectionId: null,
      position: 0,
      title: "",
      content: composeScene("title", { heading: "x" }),
      speakerNotes: "",
      durationSeconds,
      createdAt: "",
      updatedAt: "",
    }) as Scene;

  it("sums rehearsal targets", () => {
    expect(plannedDuration([scene(60), scene(120), scene(null)])).toBe(180);
  });

  it("returns null when no scene has a target", () => {
    expect(plannedDuration([scene(null), scene(null)])).toBeNull();
  });
});

describe("session command routing", () => {
  const scene = (id: string, title: string): Scene =>
    ({
      id,
      presentationId: "p",
      sectionId: null,
      position: 0,
      title,
      content: composeScene("bullets", { heading: title, bullets: ["a", "b"] }),
      speakerNotes: "",
      durationSeconds: null,
      createdAt: "",
      updatedAt: "",
    }) as Scene;

  const scenes = [scene("s1", "One"), scene("s2", "Two"), scene("s3", "Three")];

  // In a teardown, not at the end of a test body: a failed assertion would
  // otherwise skip the restore and leave `Date.now` frozen four minutes into
  // the future for every test after it in this file.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives back the paused time when the presenter resumes", () => {
    // Elapsed time is `now - origin`, and pausing only stops `now` moving.
    // Resuming stamped `now` with the wall clock while both origins stayed
    // put, so the room watched the timers jump forward by the whole break.
    const api = createSession({ presentationId: "pause", scenes, role: "stage" });
    api.send("next"); // Starts the clock.

    const before = api.store.getState();
    expect(before.startedAt).not.toBeNull();

    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    api.send("toggle-pause");
    expect(api.store.getState().paused).toBe(true);

    // Four minutes off the clock.
    vi.spyOn(Date, "now").mockReturnValue(start + 240_000);
    api.send("toggle-pause");

    const after = api.store.getState();
    expect(after.paused).toBe(false);
    // The origins moved forward with the pause, so elapsed is unchanged.
    expect(after.nowMs - after.startedAt!).toBeLessThan(2000);
    expect(after.nowMs - after.sceneEnteredAt).toBeLessThan(2000);
  });

  it("holds the clock still when a command is issued during a pause", () => {
    // Blanking the screen, opening the overview or stepping a scene are all
    // things a presenter does mid-break, and every command refreshed `nowMs`.
    // The origins do not move until resume, so the elapsed time jumped forward
    // by the length of the break and then jumped back again.
    const api = createSession({ presentationId: "paused-cmd", scenes, role: "stage" });
    api.send("next");

    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    api.send("toggle-pause");
    const frozen = api.store.getState().nowMs;

    vi.spyOn(Date, "now").mockReturnValue(start + 300_000);
    api.send("blank");

    expect(api.store.getState().nowMs).toBe(frozen);
    expect(api.store.getState().blanked).toBe(true);
  });

  it("advances the stage locally", () => {
    const api = createSession({ presentationId: "p", scenes, role: "stage" });
    expect(api.store.getState().sceneIndex).toBe(0);

    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(1);

    api.send("prev");
    expect(api.store.getState().sceneIndex).toBe(0);

    api.send("last");
    expect(api.store.getState().sceneIndex).toBe(2);
  });

  it("lets a console with no stage connected rehearse on its own", () => {
    const api = createSession({ presentationId: "p2", scenes, role: "console" });
    expect(api.store.getState().peerConnected).toBe(false);

    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(1);
  });

  it("defers to the stage once one is connected", () => {
    const api = createSession({ presentationId: "p3", scenes, role: "console" });
    api.store.setState({ peerConnected: true });

    // The command goes over the channel; the console must not also move itself,
    // or the two windows would drift apart by one scene per press.
    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(0);
  });

  it("clamps navigation to the deck", () => {
    const api = createSession({ presentationId: "p4", scenes, role: "stage" });
    api.send("prev");
    expect(api.store.getState().sceneIndex).toBe(0);

    api.send("goto", 99);
    expect(api.store.getState().sceneIndex).toBe(scenes.length - 1);

    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(scenes.length - 1);
  });

  it("starts the clock on the first advance, not on load", () => {
    const api = createSession({ presentationId: "p5", scenes, role: "stage" });
    expect(api.store.getState().startedAt).toBeNull();

    api.send("next");
    expect(api.store.getState().startedAt).not.toBeNull();
  });

  it("blanks and restores the audience view", () => {
    const api = createSession({ presentationId: "p6", scenes, role: "stage" });
    api.send("blank");
    expect(api.store.getState().blanked).toBe(true);

    // Advancing always restores the screen; a blanked deck must never be
    // left dark because the presenter moved on and forgot.
    api.send("next");
    expect(api.store.getState().blanked).toBe(false);
  });

  it("clears annotations for a scene without touching the others", () => {
    const api = createSession({ presentationId: "p7", scenes, role: "stage" });
    const stroke = { id: "a", color: "#fff", width: 1, points: [{ x: 0.1, y: 0.1 }] };

    api.setAnnotations(0, { strokes: [stroke], highlights: [] });
    api.setAnnotations(1, { strokes: [stroke], highlights: [] });

    api.clearScene();
    expect(api.store.getState().annotationsByScene[0].strokes).toHaveLength(0);
    expect(api.store.getState().annotationsByScene[1].strokes).toHaveLength(1);

    api.clearAll();
    expect(Object.keys(api.store.getState().annotationsByScene)).toHaveLength(0);
  });
});
