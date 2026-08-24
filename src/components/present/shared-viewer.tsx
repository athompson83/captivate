"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";
import type { SharedDeck } from "@/lib/data/shared-payload";
import { getTheme, themeCssVars } from "@/lib/schema/theme";
import { buildStepCount } from "@/lib/present/motion";
import { useFullscreen } from "@/lib/present/fullscreen";
import { resolvePlacements } from "@/lib/present/arrange";
import { stageSize } from "@/lib/present/stage";
import { World, type Focus } from "@/components/stage/world";
import { MovementRail, movementsOf } from "./movement-rail";

/**
 * A shared deck, self-driven.
 *
 * This is what a share link opens: the same world the room saw, walked at the
 * reader's own pace. It deliberately reuses the audience machinery — `World`,
 * the movement rail, the progress hairline — and none of the presenter's:
 * there is no console, no notes, no tools, and the payload this page received
 * never contained any of them.
 *
 * Navigation mirrors the stage so the link needs no manual: arrows and clicks
 * advance through the same build steps, O pulls the camera back over the whole
 * argument, and advancing past the final scene lands there too — the shape of
 * the whole thing is the closing image.
 */
export function SharedViewer({ deck }: { deck: SharedDeck }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = getTheme(deck.themeId);
  const { scenes, sections, journey } = deck;

  const stepCounts = useMemo(
    () => scenes.map((scene) => buildStepCount(scene.content.elements)),
    [scenes],
  );
  const movements = useMemo(() => movementsOf(scenes, sections), [scenes, sections]);
  const stage = useMemo(() => stageSize(deck.aspectRatio), [deck.aspectRatio]);
  const placements = useMemo(
    () => resolvePlacements(scenes, journey, stage),
    [scenes, journey, stage],
  );

  const [sceneIndex, setSceneIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [overview, setOverview] = useState(false);
  const [started, setStarted] = useState(false);
  const fullscreen = useFullscreen(containerRef);

  const next = () => {
    setStarted(true);
    if (overview) {
      setOverview(false);
      return;
    }
    const steps = stepCounts[sceneIndex] ?? 1;
    if (step < steps - 1) {
      setStep(step + 1);
    } else if (sceneIndex < scenes.length - 1) {
      setSceneIndex(sceneIndex + 1);
      setStep(0);
    } else {
      // Past the end, the camera pulls back: the whole argument at once is
      // the last thing a reader sees.
      setOverview(true);
    }
  };

  const prev = () => {
    setStarted(true);
    if (overview) {
      setOverview(false);
      return;
    }
    if (step > 0) {
      setStep(step - 1);
    } else if (sceneIndex > 0) {
      const prevIndex = sceneIndex - 1;
      setSceneIndex(prevIndex);
      // Returning to a scene shows it fully built, not rewound.
      setStep((stepCounts[prevIndex] ?? 1) - 1);
    }
  };

  const goto = (index: number) => {
    setStarted(true);
    setOverview(false);
    setSceneIndex(Math.max(0, Math.min(scenes.length - 1, index)));
    setStep(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          goto(0);
          break;
        case "End":
          e.preventDefault();
          goto(scenes.length - 1);
          break;
        case "o":
        case "O":
          e.preventDefault();
          setStarted(true);
          setOverview((value) => !value);
          break;
        case "f":
        case "F":
          e.preventDefault();
          void fullscreen.toggle();
          break;
        case "Escape":
          if (overview) {
            e.preventDefault();
            setOverview(false);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const advanceOnClick = (e: React.MouseEvent) => {
    // The same clicker convention as the stage: right side forward, left back.
    const rect = e.currentTarget.getBoundingClientRect();
    if ((e.clientX - rect.left) / rect.width < 0.28) prev();
    else next();
  };

  const focus: Focus = overview ? { kind: "world" } : { kind: "scene", index: sceneIndex };

  if (scenes.length === 0) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-black">
        <p className="text-[14px] text-white/60">This presentation has no scenes yet.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-view={overview ? "world" : "scene"}
      className="stage-safe relative h-screen w-screen overflow-hidden bg-black"
      style={themeCssVars(theme)}
      onClick={advanceOnClick}
    >
      <World
        scenes={scenes}
        placements={placements}
        theme={theme}
        aspect={deck.aspectRatio}
        focus={focus}
        activeIndex={sceneIndex}
        step={step}
        play
        travel={journey.travel}
        pace={journey.pace}
        depth={journey.depth}
        showPath={journey.showPath && overview}
        className="absolute inset-0"
        onSceneSelect={overview ? goto : undefined}
      />

      {journey.showMovements && !overview && (
        <MovementRail movements={movements} sceneIndex={sceneIndex} totalScenes={scenes.length} />
      )}

      {/* The invitation. One card, gone on the first advance. */}
      <AnimatePresence>
        {!started && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center px-6"
          >
            <div className="rounded-full border border-white/12 bg-black/55 px-5 py-2.5 text-center backdrop-blur-md">
              <p className="text-[13px] font-medium text-white/90">{deck.title}</p>
              <p className="mt-0.5 text-[11.5px] text-white/55">
                Click or press → to move through · O sees the whole map
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress: the same hairline the room reads as pacing. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/10" aria-hidden>
        <div
          className="h-full bg-white/45 transition-[width] duration-500 ease-[var(--ease-out-quint)]"
          style={{ width: `${((sceneIndex + 1) / scenes.length) * 100}%` }}
        />
      </div>

      {/* Quiet attribution; also the way out for a reader who wants their own. */}
      <Link
        href="/"
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 right-4 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-medium text-white/55 backdrop-blur-md transition-colors hover:text-white/90"
      >
        <Sparkles className="size-3" aria-hidden />
        Made with Captivate
      </Link>

      <p className="sr-only" aria-live="polite">
        Scene {sceneIndex + 1} of {scenes.length}
        {scenes[sceneIndex]?.title ? `: ${scenes[sceneIndex].title}` : ""}
      </p>
    </div>
  );
}
