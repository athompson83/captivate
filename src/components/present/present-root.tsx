"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PresentationRecord, Scene, Section } from "@/lib/schema/presentation";
import { getTheme, themeCssVars } from "@/lib/schema/theme";
import { usePresentSession } from "@/lib/present/session";
import { useFullscreen, useWakeLock } from "@/lib/present/fullscreen";
import { resolvePlacements } from "@/lib/present/arrange";
import { stageSize } from "@/lib/present/stage";
import { useSwipe } from "@/lib/present/swipe";
import { PRESENTER_COLORS, type PresenterTool } from "@/lib/present/protocol";
import { World, type Focus } from "@/components/stage/world";
import { setCaptureSurface } from "@/lib/record/capture-surface";
import {
  MovementRail,
  MovementSignpost,
  movementAt,
  movementsOf,
  nextMovement,
  MOVEMENT_RAIL_WIDTH,
  movementRailVisible,
} from "./movement-rail";
import { AnnotationLayer } from "./annotation-layer";
import { PresenterBar } from "./presenter-bar";
import { ConnectPhone } from "./connect-phone";
import { useRemoteBridge } from "@/lib/present/use-remote-bridge";
import type { RemoteSession } from "@/lib/data/remote-sessions";
import { RecordingController } from "@/components/record/recording-controller";
import {
  PresenterCameraFeed,
  loadCameraFeedSettings,
  saveCameraFeedSettings,
  type CameraFeedSettings,
} from "./presenter-camera";
import { ordinalAt } from "@/lib/present/running-order";

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

  // Decided once, here, because two things depend on it agreeing: whether the

  // rail renders, and whether the camera reserves the strip it stands in.

  const railShown =
    journey.showMovements &&
    !session.overview &&
    movementRailVisible(movements, session.totalScenes);
  const signpost = journey.signpostNext ? nextMovement(movements, session.sceneIndex) : null;
  const signpostIndex = signpost ? movements.indexOf(signpost) : -1;

  /**
   * Names an unlabelled hotspot after the scene it leads to.
   *
   * Only this component has the rest of the deck, so the fallback is derived
   * here rather than in the renderer. "Expand: The rhythm strip" tells a
   * screen-reader user where the control goes; "button" does not.
   */
  const hotspotName = useMemo(() => {
    const titles = new Map(scenes.map((scene) => [scene.id, scene.title.trim()]));
    return (targetSceneId: string) => {
      const title = titles.get(targetSceneId);
      return title ? `Expand: ${title}` : "Expand this point";
    };
  }, [scenes]);

  // Where the current scene sits in the running order, ignoring asides — the
  // rail's progress spine measures the argument, not the array.
  const mainOrdinal = useMemo(
    () => ordinalAt(scenes, session.sceneIndex),
    [scenes, session.sceneIndex],
  );

  // Located by scene, not by section id: a section the argument returns to
  // produces two movements sharing one id, and looking up by id would name the
  // first stretch while the room is standing in the second.
  const establishingMovement = session.establishing
    ? movementAt(movements, session.sceneIndex)
    : null;
  const establishingIndex = establishingMovement ? movements.indexOf(establishingMovement) : -1;

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
  /**
   * The phone remote, when one has been paired.
   *
   * Lives here rather than on the stage: a command from a phone is applied
   * through the same session API a keypress uses, and reaches the stage over
   * the channel that already carries one. The projector gains no network
   * listener, and no presenter-only material has anywhere new to leak to.
   */
  const [remoteSession, setRemoteSession] = useState<RemoteSession | null>(null);
  const remoteConnected = useRemoteBridge(audienceOnly ? null : remoteSession, session);

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
        // BUTTON as well as the text fields: Space and Enter advance the
        // presentation, and they are also how a focused control is activated.
        // Without this, activating a hotspot from the keyboard dived into the
        // detail scene and advanced straight back out of it in one keystroke.
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName))
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
  }, [audienceOnly, fullscreen, presentation.id, scenes.length, session, tool]);

  // Presenting from a phone or a tablet on one screen: a swipe moves the
  // deck the way a tap on the right two-thirds does. Suppressed while a
  // drawing tool is live, because then a finger on the stage is ink.
  const swipe = useSwipe((direction) => {
    if (tool !== "none" || audienceOnly) return;
    if (direction === "forward") session.next();
    else session.prev();
  });

  const advanceOnClick = (e: React.MouseEvent) => {
    if (swipe.consumeSwipe()) return;
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
      onPointerDown={swipe.onPointerDown}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClick={advanceOnClick}
    >
      {/* The show: everything the room sees, and exactly what a recording
          restricted by Element Capture contains. Presenter chrome stays
          outside — a wrapper with no z-index and no transform creates no
          stacking context, so the layers inside stack against the chrome
          exactly as they did unwrapped. */}
      <div ref={setCaptureSurface} className="absolute inset-0">
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
          backdrop={journey.backdrop}
          showPath={journey.showPath && session.overview}
          safeInsetLeft={railShown ? MOVEMENT_RAIL_WIDTH : 0}
          className="absolute inset-0"
          onSceneSelect={session.overview && !audienceOnly ? session.goto : undefined}
          // The audience window is a projector, not a control surface: a hotspot
          // there would let anyone who reaches the machine drive the talk.
          onHotspot={audienceOnly ? undefined : session.dive}
          hotspotName={hotspotName}
        />

        {/* The argument's shape, shown to the room. Hidden while the camera is
          pulled back, where the whole world is already the answer. */}
        {railShown && (
          <MovementRail
            movements={movements}
            sceneIndex={session.sceneIndex}
            // The running order, not the array: the spine measures progress
            // through the argument, and detail scenes would stop it ever
            // reaching the end.
            totalScenes={session.totalScenes}
            mainOrdinal={mainOrdinal}
          />
        )}

        {signpost && !session.overview && !session.blanked && !session.establishing && (
          <MovementSignpost
            movement={signpost}
            index={signpostIndex}
            sceneTitle={scenes[signpost.start]?.title ?? ""}
          />
        )}

        {establishingMovement && !session.overview && !session.blanked && (
          <MovementSignpost
            movement={establishingMovement}
            index={establishingIndex}
            sceneTitle=""
            kind="entering"
          />
        )}

        {/* The presenter, placed over the world. Hidden while blanked so a
          black screen is genuinely black. */}
        {!session.blanked && (
          <PresenterCameraFeed
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
      </div>

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
            remote={
              <ConnectPhone
                presentationId={presentation.id}
                session={remoteSession}
                connected={remoteConnected}
                onSession={setRemoteSession}
              />
            }
          />

          <RecordingController
            presentationId={presentation.id}
            presentationTitle={presentation.title}
            currentSceneIndex={session.sceneIndex}
            currentSceneOrdinal={mainOrdinal}
            currentSceneId={session.scene?.id ?? null}
            channel={session.channel}
            cameraFeed={cameraFeed}
            onCameraFeedChange={updateCameraFeed}
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
            // The argument, not the array — the same measure the rail eight
            // lines above already uses. Counting asides here meant the two
            // read differently on the same screen, and the hairline could not
            // reach its end on a deck with any.
            width: `${session.totalScenes ? (mainOrdinal / session.totalScenes) * 100 : 0}%`,
          }}
        />
      </div>

      <p className="sr-only" aria-live="polite">
        {session.scene?.flowRole === "detail"
          ? `Detail${session.scene.title ? `: ${session.scene.title}` : ""}`
          : `Scene ${mainOrdinal} of ${session.totalScenes}${
              session.scene?.title ? `: ${session.scene.title}` : ""
            }`}
      </p>
    </div>
  );
}
