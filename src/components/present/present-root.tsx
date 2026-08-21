"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { PresentationRecord, Scene, Section } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { transitionVariants, STAGE_EASE } from "@/lib/present/motion";
import { usePresentSession } from "@/lib/present/session";
import { useFullscreen, useWakeLock } from "@/lib/present/fullscreen";
import { PRESENTER_COLORS, type PresenterTool } from "@/lib/present/protocol";
import { Stage } from "@/components/stage/stage";
import { AnnotationLayer } from "./annotation-layer";
import { PresenterBar } from "./presenter-bar";
import { RecordingController } from "@/components/record/recording-controller";

/**
 * The stage window.
 *
 * This component renders the audience's view and nothing else. It has no access
 * to speaker notes, no navigator, no timers — those exist only in the console,
 * which is a different route. Presenter-only material therefore cannot leak
 * onto a projector through a state bug, because it was never loaded here.
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
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  const session = usePresentSession({
    presentationId: presentation.id,
    scenes,
    role: "stage",
  });

  const fullscreen = useFullscreen(containerRef);
  useWakeLock(true);

  const [tool, setTool] = useState<PresenterTool>("none");
  const [color, setColor] = useState<string>(PRESENTER_COLORS[0].value);
  const [penWidth, setPenWidth] = useState(1);
  const [barVisible, setBarVisible] = useState(!audienceOnly);
  /** Bumped on any presenter activity to restart the auto-hide countdown. */
  const [activity, setActivity] = useState(0);

  /**
   * The presenter bar is the presenter's, not the audience's: it appears on
   * activity and gets out of the way again, so the room looks at content rather
   * than at controls. `activity` restarts the countdown while the bar is up.
   */
  const showBar = () => {
    if (audienceOnly) return;
    setBarVisible(true);
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
        case "c":
        case "C":
          e.preventDefault();
          session.clearScene();
          break;
        case "Escape":
          if (tool !== "none") {
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

  const variants = transitionVariants(
    session.scene?.content.transition ?? { type: "fade", duration: 0.6, direction: "left" },
    Boolean(reduced),
  );

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
      onPointerMove={showBar}
      onClick={advanceOnClick}
    >
      <AnimatePresence mode="sync" initial={false}>
        <motion.div
          key={session.sceneIndex}
          initial={variants.initial}
          animate={variants.animate}
          exit={variants.exit}
          transition={{ duration: variants.duration, ease: STAGE_EASE }}
          className="absolute inset-0"
        >
          {session.scene && (
            <Stage
              content={session.scene.content}
              theme={theme}
              aspect={presentation.aspectRatio}
              play
              step={session.step}
              className="size-full"
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Annotations sit above the scene and below the presenter chrome. */}
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
