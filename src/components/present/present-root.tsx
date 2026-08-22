"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PresentationRecord, Scene, Section } from "@/lib/schema/presentation";
import { getTheme, themeCssVars } from "@/lib/schema/theme";
import { usePresentSession } from "@/lib/present/session";
import { useFullscreen, useWakeLock } from "@/lib/present/fullscreen";
import { resolvePlacements } from "@/lib/present/arrange";
import { stageSize } from "@/lib/present/stage";
import { PRESENTER_COLORS, type PresenterTool } from "@/lib/present/protocol";
import { World, type Focus } from "@/components/stage/world";
import { MovementRail, MovementSignpost, movementsOf, nextMovement } from "./movement-rail";
import { AnnotationLayer } from "./annotation-layer";
import { PresenterBar } from "./presenter-bar";
import { RecordingController } from "@/components/record/recording-controller";
import {
  PresenterCameraFeed,
  loadCameraFeedSettings,
  saveCameraFeedSettings,
  type CameraFeedSettings,
} from "./presenter-camera";

/** How often pointer activity may restart the presenter bar's countdown. */
const ACTIVITY_INTERVAL = 250;

/**
 * The stage window.
 *
 * This component renders the audience's view and nothing else. It has no access
 * to speaker notes, no navigator, no timers — those exist only in the console,
 * which is a different route. Presenter-only material therefore cannot leak
 * onto a projector through a state bug, because it was never loaded here.
 *
 * What the audience sees is a camera over the whole presentation, not a slide.
 * Every scene is on the canvas at once and the camera travels between them, so
 * the room can see where an idea sits in relation to everything around it.
 *
 * When presenting on one screen, a thin auto-hiding bar appears for the
 * presenter's own controls; it is suppressed entirely in audience mode.
 */
export function PresentRoot({
  presentation,
  scenes,
  sections,
  audienceOnly,
}: {
  presentation: PresentationRecord;
  scenes: Scene[];
  sections: Section[];
  audienceOnly: boolean;
}) {
  const theme = getTheme(presentation.themeId);
  const containerRef = useRef<HTMLDivElement>(null);
  const journey = presentation.journey;

  const session = usePresentSession({
    presentationId: presentation.id,
    scenes,
    role: "stage",
    establishSections: journey.establishSections,
  });

  const movements = useMemo(() => movementsOf(scenes, sections), [scenes, sections]);
  const signpost = journey.signpostNext ? nextMovement(movements, session.sceneIndex) : null;
  const signpostIndex = signpost ? movements.indexOf(signpost) : -1;

  // Memoised: `stageSize` returns a fresh object, and this is a dependency of
  // the placements below, which are a prop of `World` — so without it `World`'s
  // memo could never hold and every arrangement was resolved again on every
  // render of this component.
  const stage = useMemo(() => stageSize(presentation.aspectRatio), [presentation.aspectRatio]);
  const placements = useMemo(
    () => resolvePlacements(scenes, journey, stage),
    [scenes, journey, stage],
  );

  const fullscreen = useFullscreen(containerRef);
  useWakeLock(true);

  const [tool, setTool] = useState<PresenterTool>("none");
  const [cameraFeed, setCameraFeed] = useState<CameraFeedSettings>(() =>
    loadCameraFeedSettings(presentation.id),
  );
  const updateCameraFeed = (next: CameraFeedSettings) => {
    setCameraFeed(next);
    saveCameraFeedSettings(presentation.id, next);
  };
  const [color, setColor] = useState<string>(PRESENTER_COLORS[0].value);
  const [penWidth, setPenWidth] = useState(1);
  const [barVisible, setBarVisible] = useState(!audienceOnly);
  /** Bumped on any presenter activity to restart the auto-hide countdown. */
  const [activity, setActivity] = useState(0);
  /** When the countdown was last restarted, so pointer moves stay cheap. */
  const bumpedAt = useRef(0);

  /**
   * Where the camera should be.
   *
   * Pulled back over everything, held on the section the presentation has just
   * entered, or square on the current scene. The session owns which of those is
   * true; this only turns it into a framing.
   */
  const focus: Focus = useMemo(
    () =>
      session.overview
        ? { kind: "world" }
        : session.establishing
          ? { kind: "section", sectionId: session.establishing }
          : { kind: "scene", index: session.sceneIndex },
    [session.overview, session.establishing, session.sceneIndex],
  );

  /**
   * The presenter bar is the presenter's, not the audience's: it appears on
   * activity and gets out of the way again, so the room looks at content rather
   * than at controls. `activity` restarts the countdown while the bar is up.
   */
  const showBar = () => {
    if (audienceOnly) return;
    setBarVisible(true);

    // Throttled, because `setActivity` can never bail out — every call is a
    // new value — and this is bound to `onPointerMove`. A trackpad delivers
    // 120–240 of those a second, and each one re-rendered the whole
    // presentation tree. The countdown only has to restart often enough that
    // the bar feels like it is following the presenter.
    const now = performance.now();
    if (now - bumpedAt.current < ACTIVITY_INTERVAL) return;
    bumpedAt.current = now;
    setActivity((n) => n + 1);
  };

  useEffect(() => {
    if (!barVisible || audienceOnly) return;
    const timer = setTimeout(() => setBarVisible(false), 2600);
    return () => clearTimeout(timer);
  }, [barVisible, activity, audienceOnly]);

  /* Keyboard. Works in both single-screen and dual-screen modes. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(e.target.tagName))
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          session.next();
          break;
        case "ArrowLeft":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          session.prev();
          break;
        case "Home":
          e.preventDefault();
          session.first();
          break;
        case "End":
          e.preventDefault();
          session.last();
          break;
        // Deliberately not Tab. This listener is on `window`, so binding Tab
        // here cancelled it everywhere outside a text field — which is a
        // keyboard trap, and on the console it also meant every timer, tool
        // and note control could never be reached at all.
        case "o":
        case "O":
          e.preventDefault();
          session.toggleOverview();
          break;
        case "f":
        case "F":
          e.preventDefault();
          void fullscreen.toggle();
          break;
        case "b":
        case "B":
        case ".":
          e.preventDefault();
          session.toggleBlank();
          break;
        case "l":
        case "L":
          e.preventDefault();
          setTool((t) => (t === "laser" ? "none" : "laser"));
          break;
        case "h":
        case "H":
          e.preventDefault();
          setTool((t) => (t === "highlight" ? "none" : "highlight"));
          break;
        case "d":
        case "D":
          e.preventDefault();
          setTool((t) => (t === "draw" ? "none" : "draw"));
          break;
        case "e":
        case "E":
          e.preventDefault();
          setTool((t) => (t === "erase" ? "none" : "erase"));
          break;
        case "v":
        case "V":
          if (!audienceOnly) {
            e.preventDefault();
            setCameraFeed((feed) => {
              const next = { ...feed, enabled: !feed.enabled };
              saveCameraFeedSettings(presentation.id, next);
              return next;
            });
          }
          break;
        case "c":
        case "C":
          e.preventDefault();
          session.clearScene();
          break;
        case "Escape":
          if (session.overview) {
            e.preventDefault();
            session.toggleOverview();
          } else if (tool !== "none") {
            e.preventDefault();
            setTool("none");
          }
          break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            const index = e.key === "0" ? 9 : Number(e.key) - 1;
            if (index < scenes.length) session.goto(index);
          }
      }
      if (!audienceOnly) {
        setBarVisible(true);
        setActivity((n) => n + 1);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audienceOnly, fullscreen, scenes.length, session, tool]);

  const advanceOnClick = (e: React.MouseEvent) => {
    if (tool !== "none" || audienceOnly) return;
    // Click on the right two-thirds advances, left third goes back — the same
    // convention as a clicker, so it needs no explanation.
    const rect = e.currentTarget.getBoundingClientRect();
    if ((e.clientX - rect.left) / rect.width < 0.28) session.prev();
    else session.next();
  };

  return (
    <div
      ref={containerRef}
      className="stage-safe relative h-screen w-screen overflow-hidden bg-black"
      // The stage tokens are defined here, not only inside the world, because
      // the movement rail and the signpost are presented *over* the world and
      // would otherwise resolve `--stage-ink` to nothing and inherit whatever
      // the page happened to be using.
      style={themeCssVars(theme)}
      onPointerMove={showBar}
      onClick={advanceOnClick}
    >
      <World
        scenes={scenes}
        placements={placements}
        theme={theme}
        aspect={presentation.aspectRatio}
        focus={focus}
        activeIndex={session.sceneIndex}
        step={session.step}
        play
        travel={journey.travel}
        pace={journey.pace}
        depth={journey.depth}
        showPath={journey.showPath && session.overview}
        className="absolute inset-0"
        onSceneSelect={session.overview && !audienceOnly ? session.goto : undefined}
      />

      {/* The argument's shape, shown to the room. Hidden while the camera is
          pulled back, where the whole world is already the answer. */}
      {journey.showMovements && !session.overview && (
        <MovementRail
          movements={movements}
          sceneIndex={session.sceneIndex}
          totalScenes={scenes.length}
        />
      )}

      {signpost && !session.overview && !session.blanked && (
        <MovementSignpost
          movement={signpost}
          index={signpostIndex}
          sceneTitle={scenes[signpost.start]?.title ?? ""}
        />
      )}

      {/* The presenter, placed over the world. Hidden while blanked so a
          black screen is genuinely black. */}
      {!session.blanked && (
        <PresenterCameraFeed
          presentationId={presentation.id}
          settings={cameraFeed}
          onChange={updateCameraFeed}
          interactive={!audienceOnly}
        />
      )}

      {/* Annotations sit above the world and below the presenter chrome. */}
      <AnnotationLayer
        annotations={session.annotations}
        tool={audienceOnly ? "none" : tool}
        color={color}
        width={penWidth}
        interactive={!audienceOnly}
        onChange={(next) => session.setAnnotations(session.sceneIndex, next)}
        onPointer={(point) => session.broadcastPointer(point, "laser", color)}
        pointer={session.pointer}
        pointerColor={session.pointerColor}
      />

      {/* Blank: takes the room's attention off the screen without stopping. */}
      <AnimatePresence>
        {session.blanked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-20 bg-black"
            aria-hidden
          />
        )}
      </AnimatePresence>

      {!audienceOnly && (
        <>
          <PresenterBar
            visible={barVisible}
            presentationId={presentation.id}
            presentationTitle={presentation.title}
            session={session}
            sections={sections}
            scenes={scenes}
            tool={tool}
            onToolChange={setTool}
            color={color}
            onColorChange={setColor}
            penWidth={penWidth}
            onPenWidthChange={setPenWidth}
            cameraFeed={cameraFeed}
            onCameraFeedChange={updateCameraFeed}
            fullscreen={fullscreen}
          />

          <RecordingController
            presentationId={presentation.id}
            presentationTitle={presentation.title}
            currentSceneIndex={session.sceneIndex}
            currentSceneId={session.scene?.id ?? null}
            channel={session.channel}
          />
        </>
      )}

      {/* Progress: a hairline the audience reads as pacing, not as chrome. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/10"
        aria-hidden
      >
        <div
          className="h-full bg-white/45 transition-[width] duration-500 ease-[var(--ease-out-quint)]"
          style={{
            width: `${scenes.length ? ((session.sceneIndex + 1) / scenes.length) * 100 : 0}%`,
          }}
        />
      </div>

      <p className="sr-only" aria-live="polite">
        Scene {session.sceneIndex + 1} of {scenes.length}
        {session.scene?.title ? `: ${session.scene.title}` : ""}
      </p>
    </div>
  );
}
