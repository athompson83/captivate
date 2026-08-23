"use client";

import { useEffect, useMemo, useState } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { Scene } from "@/lib/schema/presentation";
import { buildStepCount } from "./motion";
import {
  PresentChannel,
  emptyAnnotations,
  type PresentMessage,
  type PresenterTool,
  type SceneAnnotations,
} from "./protocol";

/**
 * Presentation session.
 *
 * The session lives in a store *outside* React, created once per presentation
 * window. That matters for two reasons:
 *
 *  1. The BroadcastChannel and the running clock are long-lived side effects
 *     that must not be torn down and rebuilt on re-render — losing a message
 *     mid-presentation is not an acceptable failure mode.
 *  2. Commands arriving from the other window are applied by plain functions,
 *     not by React callbacks, so there is no dependency graph to get wrong.
 *
 * React subscribes to the store and renders. It never owns session state.
 *
 * Roles: `stage` is authoritative for position and broadcasts it; `console`
 * mirrors that state and sends commands.
 */

export type SessionRole = "stage" | "console";

export interface SessionState {
  sceneIndex: number;
  step: number;
  stepsInScene: number;
  totalScenes: number;
  startedAt: number | null;
  sceneEnteredAt: number;
  paused: boolean;
  /**
   * When the current pause began, so resuming can give the time back.
   *
   * The timers are `now - origin`, and pausing only stops `now` advancing.
   * Without recording this, resuming stamped `now` with the wall clock while
   * both origins sat where they were, and the room watched the elapsed time
   * jump forward by the length of the break.
   */
  pausedAt: number | null;
  /** Audience sees black; used to take attention off the screen. */
  blanked: boolean;
  /**
   * The camera is pulled back over the whole world.
   *
   * This is a camera position, not a different mode: the presentation is still
   * live, the current scene is still current, and advancing from here flies
   * back down to it.
   */
  overview: boolean;
  /**
   * The section the camera is holding on before diving into its first scene.
   *
   * Crossing into a new part of the argument, the camera pulls back far enough
   * to show the whole section and waits a beat. That pause is the difference
   * between "here is the next slide" and "here is where we are going next".
   */
  establishing: string | null;

  annotationsByScene: Record<number, SceneAnnotations>;
  pointer: { x: number; y: number } | null;
  pointerColor: string;
  peerConnected: boolean;
  /**
   * Wall clock, refreshed once a second and on every command. Held in the
   * store rather than read during render so elapsed times stay a pure
   * function of state.
   */
  nowMs: number;
}

export type SessionCommand =
  | "next"
  | "prev"
  | "goto"
  | "first"
  | "last"
  | "toggle-pause"
  | "reset-timer"
  | "blank"
  | "overview";

function initialState(scenes: Scene[], stepCounts: number[]): SessionState {
  return {
    sceneIndex: 0,
    step: 0,
    stepsInScene: stepCounts[0] ?? 1,
    totalScenes: scenes.length,
    startedAt: null,
    sceneEnteredAt: Date.now(),
    paused: false,
    pausedAt: null,
    blanked: false,
    overview: false,
    establishing: null,
    annotationsByScene: {},
    pointer: null,
    pointerColor: "#F0B858",
    peerConnected: false,
    nowMs: Date.now(),
  };
}

export interface SessionApi {
  store: StoreApi<SessionState>;
  channel: PresentChannel;
  /** Starts the channel and the clock; returns a teardown function. */
  attach: () => () => void;
  send: (command: SessionCommand, index?: number) => void;
  setAnnotations: (sceneIndex: number, annotations: SceneAnnotations) => void;
  clearScene: () => void;
  clearAll: () => void;
  broadcastPointer: (
    point: { x: number; y: number } | null,
    tool: PresenterTool,
    color: string,
  ) => void;
}

/** How long the camera holds on a section before diving into it. */
const ESTABLISH_MS = 1400;

export function createSession({
  presentationId,
  scenes,
  role,
  establishSections = true,
}: {
  presentationId: string;
  scenes: Scene[];
  role: SessionRole;
  establishSections?: boolean;
}): SessionApi {
  const stepCounts = scenes.map((s) => buildStepCount(s.content.elements));
  const store = createStore<SessionState>(() => initialState(scenes, stepCounts));
  const channel = new PresentChannel(presentationId);

  const isFullscreen = () => typeof document !== "undefined" && Boolean(document.fullscreenElement);

  const broadcastState = (state: SessionState) => {
    if (role !== "stage") return;
    channel.post({
      type: "state",
      sceneIndex: state.sceneIndex,
      step: state.step,
      stepsInScene: state.stepsInScene,
      totalScenes: state.totalScenes,
      startedAt: state.startedAt,
      sceneEnteredAt: state.sceneEnteredAt,
      paused: state.paused,
      // Broadcast so the console can hold its own clock at the same instant.
      // Without it a console opened during a pause froze at its own wall clock
      // and showed an elapsed time minutes apart from the stage's.
      pausedAt: state.pausedAt,
      fullscreen: isFullscreen(),
      overview: state.overview,
      establishing: state.establishing,
    });
  };

  /**
   * The clock a command's timestamps are measured against.
   *
   * While paused the session's clock is held at `pausedAt`, and resuming shifts
   * both origins forward by the length of the break. A scene entered *during*
   * the break that stamped the wall clock would therefore be shifted a second
   * time on resume and start life minutes in the future — so navigation reads
   * the frozen clock, exactly as the elapsed timers do.
   */
  const clock = (current: SessionState) =>
    current.paused && current.pausedAt !== null ? current.pausedAt : Date.now();

  const update = (updater: (current: SessionState) => Partial<SessionState>) => {
    store.setState((current) => {
      const changes = updater(current);
      const merged = { ...current, ...changes };

      // The clock is held where the pause began. The 1Hz tick already stops
      // while paused, but every command refreshed `nowMs` regardless — and
      // blanking the screen, opening the overview or moving to the next scene
      // are all things a presenter does during a break. Each one jumped the
      // elapsed time forward by however long they had been away, and resuming
      // then jumped it back.
      const nowMs = merged.paused && merged.pausedAt !== null ? merged.pausedAt : Date.now();
      const patch = { ...changes, nowMs };

      broadcastState({ ...current, ...patch });
      return patch;
    });
  };

  const goTo = (sceneIndex: number, step = 0) =>
    update((current) => {
      const clamped = Math.max(0, Math.min(scenes.length - 1, sceneIndex));
      return {
        sceneIndex: clamped,
        step: Math.max(0, Math.min((stepCounts[clamped] ?? 1) - 1, step)),
        stepsInScene: stepCounts[clamped] ?? 1,
        totalScenes: scenes.length,
        startedAt: current.startedAt ?? clock(current),
        sceneEnteredAt: clamped === current.sceneIndex ? current.sceneEnteredAt : clock(current),
        blanked: false,
        overview: false,
      };
    });

  const next = () =>
    update((current) => {
      const steps = stepCounts[current.sceneIndex] ?? 1;
      // Walk the builds within a scene before moving on to the next scene.
      if (current.step < steps - 1) {
        return {
          step: current.step + 1,
          startedAt: current.startedAt ?? clock(current),
          blanked: false,
          overview: false,
        };
      }
      // Past the final step of the final scene, the camera pulls back: the
      // whole argument at once is the closing image, and one more press is
      // the natural way to ask for it. `prev` returns to the last scene.
      if (current.sceneIndex >= scenes.length - 1) return { blanked: false, overview: true };

      const nextIndex = current.sceneIndex + 1;
      return {
        sceneIndex: nextIndex,
        step: 0,
        stepsInScene: stepCounts[nextIndex] ?? 1,
        sceneEnteredAt: clock(current),
        startedAt: current.startedAt ?? clock(current),
        blanked: false,
        overview: false,
      };
    });

  const prev = () =>
    update((current) => {
      // From the pulled-back view, "back" means return to where you were —
      // not skip a scene behind the map's back.
      if (current.overview) return { blanked: false, overview: false };
      if (current.step > 0) return { step: current.step - 1, blanked: false, overview: false };
      if (current.sceneIndex === 0) return { blanked: false, overview: false };

      const prevIndex = current.sceneIndex - 1;
      const steps = stepCounts[prevIndex] ?? 1;
      return {
        sceneIndex: prevIndex,
        // Returning to a scene shows it fully built, not rewound.
        step: steps - 1,
        stepsInScene: steps,
        sceneEnteredAt: clock(current),
        blanked: false,
        overview: false,
      };
    });

  let establishTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hold on a section when the presentation crosses into it.
   *
   * Lives here rather than in a component because it is a timed transition of
   * session state, and because the console needs to know about it too — it is
   * broadcast with everything else rather than recomputed on the other side.
   */
  const maybeEstablish = (before: number, after: number) => {
    if (!establishSections || before === after) return;
    const section = scenes[after]?.sectionId ?? null;
    if (!section || section === (scenes[before]?.sectionId ?? null)) return;

    if (establishTimer) clearTimeout(establishTimer);
    update(() => ({ establishing: section }));
    establishTimer = setTimeout(() => {
      establishTimer = null;
      update(() => ({ establishing: null }));
    }, ESTABLISH_MS);
  };

  /** Runs a move, then decides whether it crossed into new territory. */
  const navigate = (run: () => void) => {
    const before = store.getState().sceneIndex;
    run();
    maybeEstablish(before, store.getState().sceneIndex);
  };

  const apply = (command: SessionCommand, index?: number) => {
    switch (command) {
      case "next":
        navigate(next);
        break;
      case "prev":
        navigate(prev);
        break;
      case "goto":
        if (typeof index === "number") navigate(() => goTo(index));
        break;
      case "first":
        navigate(() => goTo(0));
        break;
      case "last":
        navigate(() => goTo(scenes.length - 1));
        break;
      case "toggle-pause":
        update((c) => {
          if (!c.paused) return { paused: true, pausedAt: Date.now() };

          // Resuming. Push both origins forward by however long the pause
          // lasted, so the timers measure time spent presenting rather than
          // wall clock — a five-minute break is not five minutes of talking.
          const away = c.pausedAt === null ? 0 : Math.max(0, Date.now() - c.pausedAt);
          return {
            paused: false,
            pausedAt: null,
            startedAt: c.startedAt === null ? null : c.startedAt + away,
            sceneEnteredAt: c.sceneEnteredAt + away,
          };
        });
        break;
      case "reset-timer":
        update((c) => ({
          startedAt: Date.now(),
          sceneEnteredAt: Date.now(),
          // Reset while paused starts the clock from here, not from whenever
          // the pause began — otherwise resuming would immediately undo it.
          pausedAt: c.paused ? Date.now() : null,
        }));
        break;
      case "blank":
        update((c) => ({ blanked: !c.blanked }));
        break;
      case "overview":
        if (establishTimer) {
          clearTimeout(establishTimer);
          establishTimer = null;
        }
        update((c) => ({ overview: !c.overview, establishing: null }));
        break;
      default:
        break;
    }
  };

  /**
   * The stage acts locally; the console asks the stage to act.
   *
   * With no stage connected the console also acts on itself, so a presenter can
   * rehearse — notes, timers and pacing — from the console alone. As soon as a
   * stage window appears it announces itself and broadcasts its position, and
   * the console snaps to it, so there is never a moment where the two disagree
   * about what the audience is seeing.
   */
  const send = (command: SessionCommand, index?: number) => {
    if (role === "stage") {
      apply(command, index);
      return;
    }
    channel.post({ type: "command", action: command, index });
    if (!store.getState().peerConnected) apply(command, index);
  };

  const setAnnotations = (sceneIndex: number, annotations: SceneAnnotations) => {
    store.setState((current) => ({
      annotationsByScene: { ...current.annotationsByScene, [sceneIndex]: annotations },
    }));
    channel.post({ type: "annotations", sceneIndex, annotations });
  };

  const clearScene = () => setAnnotations(store.getState().sceneIndex, emptyAnnotations());

  const clearAll = () => {
    store.setState({ annotationsByScene: {} });
    for (let i = 0; i < scenes.length; i += 1) {
      channel.post({ type: "annotations", sceneIndex: i, annotations: emptyAnnotations() });
    }
  };

  const broadcastPointer = (
    point: { x: number; y: number } | null,
    tool: PresenterTool,
    color: string,
  ) => {
    store.setState({ pointer: point, pointerColor: color });
    channel.post({ type: "pointer", point, tool, color });
  };

  const onMessage = (message: PresentMessage) => {
    switch (message.type) {
      case "hello":
        if (message.role === role) return;
        store.setState({ peerConnected: true });
        // A peer that has just opened needs the current position immediately.
        if (role === "stage") broadcastState(store.getState());
        else channel.post({ type: "hello", role });
        break;

      case "bye":
        if (message.role !== role) store.setState({ peerConnected: false });
        break;

      case "state":
        if (role !== "console") return;
        store.setState({
          peerConnected: true,
          sceneIndex: message.sceneIndex,
          step: message.step,
          stepsInScene: message.stepsInScene,
          totalScenes: message.totalScenes,
          startedAt: message.startedAt,
          sceneEnteredAt: message.sceneEnteredAt,
          paused: message.paused,
          pausedAt: message.pausedAt,
          // The stage's clock, not this window's: while paused they must agree
          // to the millisecond, and the console's own ticker has stopped. On
          // resume the clock has to restart here rather than at the next tick,
          // because the origins have just jumped forward by the whole break —
          // a held `now` measured against them reads the break back as a
          // negative elapsed for up to a second.
          nowMs: message.paused && message.pausedAt !== null ? message.pausedAt : Date.now(),
          overview: message.overview,
          establishing: message.establishing,
        });
        break;

      case "command":
        if (role === "stage") apply(message.action, message.index);
        break;

      case "pointer":
        if (role === "stage")
          store.setState({ pointer: message.point, pointerColor: message.color });
        break;

      case "annotations":
        store.setState((current) => ({
          annotationsByScene: {
            ...current.annotationsByScene,
            [message.sceneIndex]: message.annotations,
          },
        }));
        break;

      default:
        break;
    }
  };

  const attach = () => {
    // Re-attaching after a teardown has to work: React mounts, unmounts and
    // mounts again, and a session that could only be attached once left the
    // stage broadcasting into a closed channel.
    channel.open();
    const unsubscribe = channel.on(onMessage);
    channel.post({ type: "hello", role });

    const sayGoodbye = () => channel.post({ type: "bye", role });
    window.addEventListener("pagehide", sayGoodbye);

    // One second is enough resolution for a presenter clock and costs nothing.
    const interval = setInterval(() => {
      if (!store.getState().paused) store.setState({ nowMs: Date.now() });
    }, 1000);

    return () => {
      sayGoodbye();
      window.removeEventListener("pagehide", sayGoodbye);
      clearInterval(interval);
      if (establishTimer) clearTimeout(establishTimer);
      unsubscribe();
      channel.close();
    };
  };

  return { store, channel, attach, send, setAnnotations, clearScene, clearAll, broadcastPointer };
}

/* -------------------------------------------------------------------------- */
/* React binding                                                               */
/* -------------------------------------------------------------------------- */

export interface PresentSession extends Omit<SessionState, "annotationsByScene" | "nowMs"> {
  scene: Scene | null;
  nextScene: Scene | null;
  channelAvailable: boolean;

  next: () => void;
  prev: () => void;
  goto: (index: number) => void;
  first: () => void;
  last: () => void;
  togglePause: () => void;
  resetTimer: () => void;
  toggleBlank: () => void;
  /** Pull the camera back over the whole world, or return to the scene. */
  toggleOverview: () => void;

  totalElapsedMs: number;
  sceneElapsedMs: number;

  annotations: SceneAnnotations;
  setAnnotations: (sceneIndex: number, annotations: SceneAnnotations) => void;
  clearScene: () => void;
  clearAll: () => void;

  broadcastPointer: (
    point: { x: number; y: number } | null,
    tool: PresenterTool,
    color: string,
  ) => void;

  channel: PresentChannel;
}

export function usePresentSession({
  presentationId,
  scenes,
  role,
  establishSections = true,
}: {
  presentationId: string;
  scenes: Scene[];
  role: SessionRole;
  establishSections?: boolean;
}): PresentSession {
  // Created once. The scene list is fixed for the life of a presentation.
  const [api] = useState(() => createSession({ presentationId, scenes, role, establishSections }));
  const state = useStore(api.store);

  useEffect(() => api.attach(), [api]);

  return useMemo(() => {
    const now = state.nowMs;
    return {
      sceneIndex: state.sceneIndex,
      step: state.step,
      stepsInScene: state.stepsInScene,
      totalScenes: state.totalScenes,
      startedAt: state.startedAt,
      sceneEnteredAt: state.sceneEnteredAt,
      paused: state.paused,
      pausedAt: state.pausedAt,
      blanked: state.blanked,
      overview: state.overview,
      establishing: state.establishing,
      pointer: state.pointer,
      pointerColor: state.pointerColor,
      peerConnected: state.peerConnected,

      scene: scenes[state.sceneIndex] ?? null,
      nextScene: scenes[state.sceneIndex + 1] ?? null,
      channelAvailable: api.channel.available,

      next: () => api.send("next"),
      prev: () => api.send("prev"),
      goto: (index: number) => api.send("goto", index),
      first: () => api.send("first"),
      last: () => api.send("last"),
      togglePause: () => api.send("toggle-pause"),
      resetTimer: () => api.send("reset-timer"),
      toggleBlank: () => api.send("blank"),
      toggleOverview: () => api.send("overview"),

      totalElapsedMs: state.startedAt ? Math.max(0, now - state.startedAt) : 0,
      sceneElapsedMs: Math.max(0, now - state.sceneEnteredAt),

      annotations: state.annotationsByScene[state.sceneIndex] ?? emptyAnnotations(),
      setAnnotations: api.setAnnotations,
      clearScene: api.clearScene,
      clearAll: api.clearAll,
      broadcastPointer: api.broadcastPointer,

      channel: api.channel,
    };
  }, [api, scenes, state]);
}

/** Total rehearsal target across the deck, in seconds, if any scene sets one. */
export function plannedDuration(scenes: Scene[]): number | null {
  const total = scenes.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  return total > 0 ? total : null;
}
