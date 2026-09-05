"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getTheme, themeCssVars } from "@/lib/schema/theme";
import { buildStepCount } from "@/lib/present/motion";
import { resolvePlacements } from "@/lib/present/arrange";
import { stageSize } from "@/lib/present/stage";
import { World, type Focus } from "@/components/stage/world";
import { exampleDeck } from "@/lib/marketing/example-deck";

/**
 * The worked example, live, on the landing page.
 *
 * The hero above shows the idea; this is the product. The same `World` the
 * room sees and the same deck a new account opens first, driven by the
 * visitor: the camera flies, scenes perform on landing, the last press pulls
 * back over the whole argument. Nothing advances on its own — a page that
 * moves while it is being read is a page that is not being read.
 *
 * Deliberately not the share-link viewer. That surface is a whole page: it
 * listens on `window` for every arrow, Space and Backspace, which on a
 * marketing page would hijack scrolling, and it carries chrome (fullscreen,
 * "Made with Captivate") that points back to where the visitor already is.
 * Keys here work while the stage has focus; buttons below it do the same for
 * anyone who would rather click, and say where the reader is.
 */

/**
 * Built once, at module load. The deck is pure and fixed, so everything
 * derived from it — placements, the build count per scene — is a constant,
 * and constants need no memoisation to be stable across renders.
 */
const DECK = exampleDeck();
const THEME = getTheme(DECK.themeId);
const STAGE = stageSize(DECK.aspectRatio);
const PLACEMENTS = resolvePlacements(DECK.scenes, DECK.journey, STAGE);
const STEP_COUNTS = DECK.scenes.map((scene) => buildStepCount(scene.content.elements));

export function LiveDemoStage() {
  const { scenes, journey, aspectRatio, title } = DECK;
  const theme = THEME;
  const placements = PLACEMENTS;
  const stepCounts = STEP_COUNTS;

  const [sceneIndex, setSceneIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [overview, setOverview] = useState(false);
  const [started, setStarted] = useState(false);

  const last = scenes.length - 1;

  const next = () => {
    setStarted(true);
    if (overview) {
      setOverview(false);
      return;
    }
    if (step < (stepCounts[sceneIndex] ?? 1) - 1) {
      setStep(step + 1);
      return;
    }
    // Past the final scene the camera pulls back: the whole argument at once
    // is the last thing a reader sees, here as on the stage.
    if (sceneIndex === last) {
      setOverview(true);
      return;
    }
    setSceneIndex(sceneIndex + 1);
    setStep(0);
  };

  const prev = () => {
    setStarted(true);
    if (overview) {
      setOverview(false);
      return;
    }
    if (step > 0) {
      setStep(step - 1);
      return;
    }
    if (sceneIndex === 0) return;
    // Returning to a scene shows it fully built, not rewound.
    setSceneIndex(sceneIndex - 1);
    setStep((stepCounts[sceneIndex - 1] ?? 1) - 1);
  };

  const goto = (index: number) => {
    setStarted(true);
    setSceneIndex(Math.max(0, Math.min(last, index)));
    setStep(0);
    setOverview(false);
  };

  const toggleOverview = () => {
    setStarted(true);
    setOverview((value) => !value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A hotspot is a real button and Enter activates it; the same guard the
    // stage and the shared viewer use.
    if (e.target instanceof HTMLElement && e.target.tagName === "BUTTON") return;
    switch (e.key) {
      case "ArrowRight":
      case " ":
      case "Enter":
        e.preventDefault();
        next();
        break;
      case "ArrowLeft":
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
        goto(last);
        break;
      case "o":
      case "O":
        e.preventDefault();
        toggleOverview();
        break;
      case "Escape":
        if (overview) {
          e.preventDefault();
          setOverview(false);
        }
        break;
    }
  };

  const advanceOnClick = (e: React.MouseEvent) => {
    // The same clicker convention as the stage: right side forward, left back.
    const rect = e.currentTarget.getBoundingClientRect();
    if ((e.clientX - rect.left) / rect.width < 0.28) prev();
    else next();
  };

  const focus: Focus = overview ? { kind: "world" } : { kind: "scene", index: sceneIndex };
  const where = overview
    ? "The whole argument"
    : `Scene ${sceneIndex + 1} of ${scenes.length}: ${scenes[sceneIndex]?.title ?? ""}`;

  return (
    <div>
      <div
        role="region"
        aria-label={`Live demo: ${title}. Focus the stage and use the arrow keys to move through it.`}
        tabIndex={0}
        data-view={overview ? "world" : "scene"}
        onKeyDown={onKeyDown}
        onClick={advanceOnClick}
        className="relative aspect-[16/9] w-full cursor-pointer overflow-hidden rounded-[var(--radius-xl)] bg-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--sky-action)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sky-deep)]"
        style={themeCssVars(theme)}
      >
        <World
          scenes={scenes}
          placements={placements}
          theme={theme}
          aspect={aspectRatio}
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

        {/* The invitation. Gone on the first move. */}
        <AnimatePresence>
          {!started && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-6"
            >
              <p className="rounded-full border border-white/12 bg-black/55 px-4 py-2 text-center text-[12.5px] font-medium text-white/85 backdrop-blur-md">
                Press → or tap the stage · O sees the whole map
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Progress: the same hairline the room reads as pacing. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/10"
          aria-hidden
        >
          <div
            className="h-full bg-white/45 transition-[width] duration-500 ease-[var(--ease-out-quint)]"
            style={{ width: `${((sceneIndex + 1) / scenes.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--sky-ink-3)]" aria-live="polite">
          {where}
        </p>
        <div className="flex items-center gap-2">
          <DemoButton onClick={prev} disabled={!overview && sceneIndex === 0 && step === 0}>
            Back
          </DemoButton>
          <DemoButton onClick={toggleOverview}>
            {overview ? "Back to the scene" : "Whole map"}
          </DemoButton>
          <DemoButton onClick={next} primary>
            Next
          </DemoButton>
        </div>
      </div>
    </div>
  );
}

function DemoButton({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "rounded-[var(--radius-lg)] bg-[var(--sky-action)] px-4 py-2 text-[13px] font-medium text-[var(--sky-action-ink)] transition-colors hover:bg-[var(--sky-action-hover)] disabled:opacity-50"
          : "rounded-[var(--radius-lg)] border border-[var(--sky-line-strong)] px-4 py-2 text-[13px] font-medium text-[var(--sky-ink-2)] transition-colors hover:text-[var(--sky-ink)] disabled:opacity-40"
      }
    >
      {children}
    </button>
  );
}
