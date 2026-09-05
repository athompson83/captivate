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
      animation: {
        entrance: "fade",
        delay: 0,
        duration: 0.5,
        emphasis: "none",
        onAdvance: false,
        exit: "none",
      },
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
            exit: "none",
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
    const api = createSession({ presentationId: "pause", scenes, role: "stage", openWide: false });
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
    const api = createSession({
      presentationId: "paused-cmd",
      scenes,
      role: "stage",
      openWide: false,
    });
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

  it("does not stamp navigation with the wall clock during a pause", () => {
    // The origins are shifted forward by the pause on resume. A scene entered
    // *during* the break that stamped the wall clock would be shifted a second
    // time and start life minutes in the future — so the scene timer would
    // count backwards from a negative elapsed.
    const api = createSession({
      presentationId: "paused-nav",
      scenes,
      role: "stage",
      openWide: false,
    });
    api.send("next");

    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    api.send("toggle-pause");

    vi.spyOn(Date, "now").mockReturnValue(start + 600_000);
    api.send("next");
    expect(api.store.getState().sceneEnteredAt).toBe(start);

    api.send("toggle-pause");

    const after = api.store.getState();
    expect(after.nowMs - after.sceneEnteredAt).toBeGreaterThanOrEqual(0);
    expect(after.nowMs - after.sceneEnteredAt).toBeLessThan(2000);
  });

  it("tells a console opened mid-pause where the clock was frozen", async () => {
    // The console runs its own ticker. Joining during a break it stamped its
    // own wall clock, so the two windows showed elapsed times a whole break
    // apart — the stage frozen at the pause, the console minutes ahead.
    const stage = createSession({
      presentationId: "paused-broadcast",
      scenes,
      role: "stage",
      openWide: false,
    });
    const detachStage = stage.attach();
    stage.send("next");

    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    stage.send("toggle-pause");
    expect(stage.store.getState().pausedAt).toBe(start);

    // Ten minutes of break, then the presenter opens the console.
    vi.spyOn(Date, "now").mockReturnValue(start + 600_000);
    const desk = createSession({
      presentationId: "paused-broadcast",
      scenes,
      role: "console",
      openWide: false,
    });
    const detachDesk = desk.attach();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const joined = desk.store.getState();
    detachStage();
    detachDesk();

    expect(joined.paused).toBe(true);
    expect(joined.nowMs).toBe(stage.store.getState().nowMs);
    expect(joined.pausedAt).toBe(start);
  });

  it("hands the console a live clock again the moment the stage resumes", async () => {
    // The console holds its clock at the pause instant and its own ticker is
    // idle while paused. Resuming pushes the origins forward by the break, so
    // for the up-to-a-second before the next tick the console was measuring a
    // frozen `now` against origins in its future — and showed the break back
    // as a negative elapsed.
    const stage = createSession({
      presentationId: "resume-broadcast",
      scenes,
      role: "stage",
      openWide: false,
    });
    const desk = createSession({
      presentationId: "resume-broadcast",
      scenes,
      role: "console",
      openWide: false,
    });
    const detachStage = stage.attach();
    const detachDesk = desk.attach();
    stage.send("next");

    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    stage.send("toggle-pause");
    await new Promise((resolve) => setTimeout(resolve, 20));

    vi.spyOn(Date, "now").mockReturnValue(start + 600_000);
    stage.send("toggle-pause");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const resumed = desk.store.getState();
    detachStage();
    detachDesk();

    expect(resumed.paused).toBe(false);
    expect(resumed.nowMs - resumed.sceneEnteredAt).toBeGreaterThanOrEqual(0);
  });

  it("advances the stage locally", () => {
    const api = createSession({ presentationId: "p", scenes, role: "stage", openWide: false });
    expect(api.store.getState().sceneIndex).toBe(0);

    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(1);

    api.send("prev");
    expect(api.store.getState().sceneIndex).toBe(0);

    api.send("last");
    expect(api.store.getState().sceneIndex).toBe(2);
  });

  it("lets a console with no stage connected rehearse on its own", () => {
    const api = createSession({ presentationId: "p2", scenes, role: "console", openWide: false });
    expect(api.store.getState().peerConnected).toBe(false);

    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(1);
  });

  it("defers to the stage once one is connected", () => {
    const api = createSession({ presentationId: "p3", scenes, role: "console", openWide: false });
    api.store.setState({ peerConnected: true });

    // The command goes over the channel; the console must not also move itself,
    // or the two windows would drift apart by one scene per press.
    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(0);
  });

  it("clamps navigation to the deck", () => {
    const api = createSession({ presentationId: "p4", scenes, role: "stage", openWide: false });
    api.send("prev");
    expect(api.store.getState().sceneIndex).toBe(0);

    api.send("goto", 99);
    expect(api.store.getState().sceneIndex).toBe(scenes.length - 1);

    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(scenes.length - 1);
  });

  it("pulls the camera back over the whole world at the end", () => {
    const api = createSession({ presentationId: "p-end", scenes, role: "stage", openWide: false });
    api.send("last");
    // Walk the final scene's builds; the press after the last one pulls back.
    for (let i = 0; i < 10 && !api.store.getState().overview; i += 1) api.send("next");

    const ended = api.store.getState();
    expect(ended.sceneIndex).toBe(scenes.length - 1);
    expect(ended.overview).toBe(true);

    // Any advance from the pulled-back view resumes the final scene — it
    // must never advance a scene behind the map's back or go dead.
    api.send("next");
    expect(api.store.getState().overview).toBe(false);
    expect(api.store.getState().sceneIndex).toBe(scenes.length - 1);

    // And "back" from the closing image behaves the same way.
    api.send("next");
    expect(api.store.getState().overview).toBe(true);
    api.send("prev");
    expect(api.store.getState().overview).toBe(false);
    expect(api.store.getState().sceneIndex).toBe(scenes.length - 1);
  });

  it("starts the clock on the first advance, not on load", () => {
    const api = createSession({ presentationId: "p5", scenes, role: "stage", openWide: false });
    expect(api.store.getState().startedAt).toBeNull();

    api.send("next");
    expect(api.store.getState().startedAt).not.toBeNull();
  });

  it("blanks and restores the audience view", () => {
    const api = createSession({ presentationId: "p6", scenes, role: "stage", openWide: false });
    api.send("blank");
    expect(api.store.getState().blanked).toBe(true);

    // Advancing always restores the screen; a blanked deck must never be
    // left dark because the presenter moved on and forgot.
    api.send("next");
    expect(api.store.getState().blanked).toBe(false);
  });

  it("clears annotations for a scene without touching the others", () => {
    const api = createSession({ presentationId: "p7", scenes, role: "stage", openWide: false });
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

/**
 * Detail scenes sit in the same array as the argument but are not part of it.
 *
 * They keep their real index — the stage, the console and the camera all
 * address scenes by index, and a second "main-only" index space would be one
 * more thing to get out of step. So navigation skips them in place rather than
 * walking a filtered copy.
 */
describe("flowRole-aware navigation", () => {
  const PRESENTATION = "00000000-0000-4000-8000-000000000fff";

  function scene(i: number, flowRole: "main" | "detail" = "main"): Scene {
    return {
      id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
      presentationId: PRESENTATION,
      sectionId: null,
      position: i,
      title: `Scene ${i}`,
      content: composeScene("statement", { heading: `Heading ${i}` }),
      placement: null,
      momentId: null,
      speakerNotes: "",
      durationSeconds: null,
      flowRole,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
  }

  // 0 main, 1 detail, 2 main, 3 detail, 4 main
  const mixed = () => [scene(0), scene(1, "detail"), scene(2), scene(3, "detail"), scene(4)];

  // The opening beat is under test in `opening.test.ts`; here every first
  // press has to be a real move.
  const session = (scenes: Scene[]) =>
    createSession({
      presentationId: PRESENTATION,
      scenes,
      role: "stage",
      establishSections: false,
      openWide: false,
    });

  const at = (s: ReturnType<typeof session>) => s.store.getState().sceneIndex;

  it("jumping does not turn the running-order count back into the array length", () => {
    // `goTo` used to write `scenes.length`, undoing what the initial state had
    // filtered. The first jump — the scene jumper, a number key, a click in the
    // overview, the phone's first/last — silently changed what the movement
    // rail's spine was measuring against, so it could no longer reach its own
    // end and the phone's counter changed denominator mid-talk.
    const api = session(mixed());
    expect(api.store.getState().totalScenes).toBe(3);

    api.send("goto", 2);
    expect(api.store.getState().totalScenes).toBe(3);

    api.send("last");
    expect(api.store.getState().totalScenes).toBe(3);

    api.send("first");
    expect(api.store.getState().totalScenes).toBe(3);
  });

  it("jumping abandons an aside rather than leaving a way back into it", () => {
    // Otherwise the return path points at a scene the presenter has left, and
    // the next end-of-scene advance teleports backwards instead of going on.
    const api = session(mixed());
    api.dive("00000000-0000-4000-8000-000000000001");
    expect(at(api)).toBe(1);
    expect(api.store.getState().divePath).toEqual([0]);

    api.send("goto", 4);
    expect(at(api)).toBe(4);
    expect(api.store.getState().divePath).toEqual([]);

    // From the last scene of the running order, "next" pulls the camera back
    // rather than jumping to where the abandoned aside had been launched from.
    api.send("next");
    expect(api.store.getState().overview).toBe(true);
  });

  it("next skips detail scenes, keeping real indices", () => {
    const s = session(mixed());
    expect(at(s)).toBe(0);
    s.send("next");
    expect(at(s)).toBe(2); // not 1
    s.send("next");
    expect(at(s)).toBe(4); // not 3
  });

  it("next stops at the last main scene rather than walking into a trailing detail", () => {
    const s = session([scene(0), scene(1), scene(2, "detail")]);
    s.send("next");
    expect(at(s)).toBe(1);
    s.send("next");
    expect(at(s)).toBe(1);
  });

  it("prev skips detail scenes", () => {
    const s = session(mixed());
    s.send("goto", 4);
    expect(at(s)).toBe(4);
    s.send("prev");
    expect(at(s)).toBe(2);
    s.send("prev");
    expect(at(s)).toBe(0);
  });

  it("first and last land on main scenes", () => {
    const s = session([scene(0, "detail"), scene(1), scene(2), scene(3, "detail")]);
    s.send("last");
    expect(at(s)).toBe(2);
    s.send("first");
    expect(at(s)).toBe(1);
  });

  it("totalScenes counts only the running order", () => {
    const s = session(mixed());
    expect(s.store.getState().totalScenes).toBe(3);
  });

  it("dive enters a detail scene and records where it came from", () => {
    const s = session(mixed());
    s.send("next"); // at 2
    s.dive(mixed()[3].id);
    expect(at(s)).toBe(3);
    expect(s.store.getState().divePath).toEqual([2]);
  });

  it("prev returns from a dive to the scene that launched it", () => {
    const s = session(mixed());
    s.send("next"); // at 2
    s.dive(mixed()[3].id);
    expect(at(s)).toBe(3);
    s.send("prev");
    expect(at(s)).toBe(2);
    expect(s.store.getState().divePath).toEqual([]);
  });

  it("next from inside a detail scene also returns, rather than walking on", () => {
    const s = session(mixed());
    s.send("next"); // at 2
    s.dive(mixed()[3].id);
    s.send("next");
    expect(at(s)).toBe(2);
    expect(s.store.getState().divePath).toEqual([]);
  });

  it("ignores a dive to an unknown scene", () => {
    const s = session(mixed());
    s.dive("00000000-0000-4000-8000-0000000000zz");
    expect(at(s)).toBe(0);
    expect(s.store.getState().divePath).toEqual([]);
  });

  it("a deck of only main scenes is unaffected", () => {
    const s = session([scene(0), scene(1), scene(2)]);
    s.send("next");
    expect(at(s)).toBe(1);
    s.send("next");
    expect(at(s)).toBe(2);
    expect(s.store.getState().totalScenes).toBe(3);
  });
});
