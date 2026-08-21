"use client";

import { memo, useCallback } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { AspectRatio, SceneContent, SceneElement } from "@/lib/schema/presentation";
import {
  resolveColor,
  stageBackgroundCss,
  themeCssVars,
  type PresentationTheme,
} from "@/lib/schema/theme";
import { STAGE_BASE_WIDTH, fitScale, stageSize } from "@/lib/present/stage";
import { STAGE_EASE, entranceFrom, entranceTo } from "@/lib/present/motion";
import { ElementView } from "./element-view";

/**
 * The stage.
 *
 * Renders a scene at a fixed internal size and scales it to fill its container.
 * `play` controls whether entrance animations run — the editor renders scenes
 * statically so authoring never fights motion, while present mode plays them.
 */

export interface StageProps {
  content: SceneContent;
  theme: PresentationTheme;
  aspect: AspectRatio;
  play?: boolean;
  /** How many advance steps have been taken within this scene. */
  step?: number;
  className?: string;
  /** Rendered above the scene, inside the scaled stage (annotations, overlays). */
  overlay?: React.ReactNode;
  /** Rendered above the scene but *not* scaled (selection chrome). */
  chrome?: React.ReactNode;
  onPointerDownCapture?: (e: React.PointerEvent) => void;
  /** Disables the scaling observer for measured-size-free contexts. */
  fixedScale?: number;
}

export const Stage = memo(function Stage({
  content,
  theme,
  aspect,
  play = false,
  step = 0,
  className,
  overlay,
  chrome,
  onPointerDownCapture,
  fixedScale,
}: StageProps) {
  const size = stageSize(aspect);
  const reduced = useReducedMotion();

  /**
   * Fit-to-container scaling is written straight to a CSS custom property from
   * a ResizeObserver rather than held in React state. Resizing a window then
   * costs one style write instead of re-rendering every element on the stage,
   * and there is no measurement round-trip through the render cycle.
   */
  const measureRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      if (fixedScale !== undefined) {
        node.style.setProperty("--stage-scale", String(fixedScale));
        return;
      }

      const apply = () => {
        const rect = node.getBoundingClientRect();
        node.style.setProperty(
          "--stage-scale",
          String(fitScale({ width: rect.width, height: rect.height }, size)),
        );
      };
      apply();

      const observer = new ResizeObserver(apply);
      observer.observe(node);
      return () => observer.disconnect();
    },
    [fixedScale, size],
  );

  const background = resolveSceneBackground(content, theme);

  return (
    <div
      ref={measureRef}
      className={className}
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        // Zero until measured, so the stage is never briefly visible at 1:1.
        ["--stage-scale" as string]: fixedScale ?? 0,
      }}
      onPointerDownCapture={onPointerDownCapture}
    >
      <div
        data-stage
        style={{
          ...themeCssVars(theme),
          width: size.width,
          height: size.height,
          transform: "scale(var(--stage-scale, 0))",
          transformOrigin: "center center",
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
          ...background,
        }}
      >
        {content.background.kind === "image" && content.background.url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- see element-view */}
            <img
              src={content.background.url}
              alt={content.background.alt}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: `${content.background.focalX * 100}% ${content.background.focalY * 100}%`,
              }}
            />
            {content.background.scrim > 0 && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `rgba(0,0,0,${content.background.scrim})`,
                }}
              />
            )}
          </>
        )}

        {content.elements.map((element, index) => (
          <ElementLayer
            key={element.id}
            element={element}
            theme={theme}
            stageWidth={size.width}
            stageHeight={size.height}
            play={play && !reduced}
            step={step}
            index={index}
            elements={content.elements}
          />
        ))}

        {overlay}
      </div>

      {chrome}
    </div>
  );
});

function resolveSceneBackground(
  content: SceneContent,
  theme: PresentationTheme,
): React.CSSProperties {
  const bg = content.background;
  switch (bg.kind) {
    case "solid":
      return { background: resolveColor(bg.color, theme, "canvas") };
    case "gradient":
      return {
        background: `linear-gradient(${bg.angle}deg, ${resolveColor(bg.from, theme, "canvas")}, ${resolveColor(bg.to, theme, "surface")})`,
      };
    case "image":
      return { background: theme.tokens.canvas };
    default:
      return { background: stageBackgroundCss(theme) };
  }
}

/**
 * Decides whether a given element is visible at the current advance step, and
 * animates it in when it becomes visible.
 */
function ElementLayer({
  element,
  theme,
  stageWidth,
  stageHeight,
  play,
  step,
  index,
  elements,
}: {
  element: SceneElement;
  theme: PresentationTheme;
  stageWidth: number;
  stageHeight: number;
  play: boolean;
  step: number;
  index: number;
  elements: SceneElement[];
}) {
  if (element.hidden) return null;

  // Elements marked `onAdvance` appear in document order as the presenter
  // advances; everything else is visible from the start of the scene.
  const advanceIndex = elements
    .slice(0, index + 1)
    .filter((e) => e.animation.onAdvance && !e.hidden).length;
  const gated = element.animation.onAdvance && advanceIndex > step;
  if (gated) return null;

  const from = entranceFrom(element.animation.entrance);
  const to = entranceTo(element.animation.entrance);

  const style: React.CSSProperties = {
    position: "absolute",
    left: `${(element.frame.x / 100) * stageWidth}px`,
    top: `${(element.frame.y / 100) * stageHeight}px`,
    width: `${(element.frame.w / 100) * stageWidth}px`,
    height: `${(element.frame.h / 100) * stageHeight}px`,
    opacity: element.opacity,
    transform: element.frame.rotation ? `rotate(${element.frame.rotation}deg)` : undefined,
    transformOrigin: "center center",
  };

  const emphasis =
    play && element.animation.emphasis !== "none"
      ? {
          pulse: { scale: [1, 1.03, 1], transition: { duration: 2.2, repeat: Infinity, delay: 1 } },
          lift: { y: [0, -6, 0], transition: { duration: 3, repeat: Infinity, delay: 1 } },
          glow: {
            filter: ["brightness(1)", "brightness(1.15)", "brightness(1)"],
            transition: { duration: 2.6, repeat: Infinity, delay: 1 },
          },
        }[element.animation.emphasis]
      : undefined;

  return (
    <motion.div
      style={style}
      initial={play ? { ...from, opacity: (from.opacity ?? 1) * element.opacity } : false}
      animate={
        play
          ? { ...to, opacity: element.opacity, ...(emphasis ?? {}) }
          : { opacity: element.opacity }
      }
      transition={{
        duration: element.animation.duration,
        delay: element.animation.onAdvance ? 0 : element.animation.delay,
        ease: STAGE_EASE,
      }}
    >
      <StaggeredElement
        element={element}
        theme={theme}
        stageWidth={stageWidth}
        step={step}
        play={play}
      />
    </motion.div>
  );
}

/** Lists with `staggered` reveal one item per advance step. */
function StaggeredElement({
  element,
  theme,
  stageWidth,
  step,
  play,
}: {
  element: SceneElement;
  theme: PresentationTheme;
  stageWidth: number;
  step: number;
  play: boolean;
}) {
  if (element.type === "list" && element.staggered && play) {
    const visible = Math.max(1, Math.min(element.items.length, step + 1));
    return (
      <ElementView
        element={{ ...element, items: element.items.slice(0, visible) }}
        theme={theme}
        stageWidth={stageWidth}
      />
    );
  }
  return <ElementView element={element} theme={theme} stageWidth={stageWidth} />;
}

/**
 * A non-interactive miniature of a scene — dashboard cards, the scene
 * navigator and the presenter's next-scene preview all use this.
 */
export const StageThumbnail = memo(function StageThumbnail({
  content,
  theme,
  aspect,
  width,
  className,
}: {
  content: SceneContent;
  theme: PresentationTheme;
  aspect: AspectRatio;
  width: number;
  className?: string;
}) {
  const size = stageSize(aspect);
  const scale = width / STAGE_BASE_WIDTH;

  return (
    <div
      className={className}
      aria-hidden
      style={{
        width,
        height: size.height * scale,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: size.width,
          height: size.height,
        }}
      >
        <Stage content={content} theme={theme} aspect={aspect} fixedScale={1} />
      </div>
    </div>
  );
});
