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
import { cn } from "@/lib/utils/cn";

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
  /**
   * Whether this scene owns its background.
   *
   * `card` paints the theme background inside the scene's own box — right for a
   * thumbnail, a dashboard preview or the editor canvas, where a scene really
   * is a discrete object being looked at.
   *
   * `bare` paints nothing. On the world canvas a scene is a *region* of one
   * continuous surface, not an object sitting on it, and a filled box with an
   * edge is precisely what makes a presentation read as slides on a wall. The
   * atmosphere behind it belongs to the world.
   */
  surface?: "card" | "bare";
  /**
   * Dives to a scene when a hotspot element is activated.
   *
   * Absent on every surface that cannot dive — the editor canvas, thumbnails,
   * dashboard previews. A hotspot only becomes a control where activating it
   * means something; elsewhere the element renders as the author drew it.
   */
  onHotspot?: (targetSceneId: string) => void;
  /**
   * Accessible name for a hotspot whose author left the label empty.
   *
   * Derived from the target scene's title by the caller, which is the only
   * place that has the rest of the deck. Falling back to something generic
   * would announce "button" to a screen reader and nothing else.
   */
  hotspotName?: (targetSceneId: string) => string;
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
  surface = "card",
  onHotspot,
  hotspotName,
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

  const bare = surface === "bare";
  const background = bare ? {} : resolveSceneBackground(content, theme);

  return (
    <div
      ref={measureRef}
      // Position comes from a class, not an inline style, so a caller passing
      // `absolute inset-0` actually wins — an inline `position` would silently
      // override it and collapse this box to zero height.
      className={cn("relative overflow-hidden", className)}
      style={{
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
          // Centred by translation rather than by grid alignment: the stage is
          // deliberately larger than its container before scaling, and an
          // overflowing grid item is not centred consistently across engines.
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%) scale(var(--stage-scale, 0))",
          transformOrigin: "center center",
          // A bare region must not clip: the whole point is that it has no
          // edge, and clipping reinstates one the moment anything overflows.
          overflow: bare ? "visible" : "hidden",
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
                maskImage: bare ? FEATHER : undefined,
                WebkitMaskImage: bare ? FEATHER : undefined,
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
            onHotspot={onHotspot}
            hotspotName={hotspotName}
          />
        ))}

        {overlay}
      </div>

      {chrome}
    </div>
  );
});

/**
 * A region on the world canvas paints no background of its own. Ever.
 *
 * The line: **a colour is atmosphere, an image is content.** A scene's solid or
 * gradient background is chrome the world already provides — its palette is
 * blended into the surrounding air by the ambient field, so painting it again
 * as a rectangle adds nothing except an edge, and an edge is exactly what makes
 * a presentation read as slides parked on a wall. An image is different: it is
 * something the author put there, so it still renders, feathered at the rim so
 * it pools into the surface instead of ending at a border.
 */
const FEATHER = "radial-gradient(closest-side, #000 58%, transparent 100%)";

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
  onHotspot,
  hotspotName,
}: {
  element: SceneElement;
  theme: PresentationTheme;
  stageWidth: number;
  stageHeight: number;
  play: boolean;
  step: number;
  index: number;
  elements: SceneElement[];
  onHotspot?: (targetSceneId: string) => void;
  hotspotName?: (targetSceneId: string) => string;
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
      <HotspotTarget element={element} onHotspot={onHotspot} hotspotName={hotspotName}>
        <StaggeredElement
          element={element}
          theme={theme}
          stageWidth={stageWidth}
          stageHeight={stageHeight}
          step={step}
          play={play}
        />
      </HotspotTarget>
    </motion.div>
  );
}

/**
 * Wraps a hotspot element in a real control.
 *
 * A button, not a clickable div: activating a hotspot is navigation, and a
 * presenter driving from the keyboard — or anyone using a screen reader — has
 * to be able to reach it. Where nothing can dive (the editor canvas, a
 * thumbnail, a dashboard preview) the element renders exactly as authored,
 * because a control that does nothing is worse than no control.
 */
function HotspotTarget({
  element,
  onHotspot,
  hotspotName,
  children,
}: {
  element: SceneElement;
  onHotspot?: (targetSceneId: string) => void;
  hotspotName?: (targetSceneId: string) => string;
  children: React.ReactNode;
}) {
  const hotspot = element.hotspot;
  if (!hotspot || !onHotspot) return <>{children}</>;

  const target = hotspot.targetSceneId;
  // An unlabelled hotspot still has to announce something. The caller derives
  // a name from the target scene's title; the bare fallback is the last resort
  // when even that is unavailable.
  const name = hotspot.label.trim() || hotspotName?.(target) || "Expand this point";

  return (
    <button
      type="button"
      onClick={() => onHotspot(target)}
      aria-label={name}
      className="block size-full cursor-pointer text-left"
      // The element's own styling is the affordance; the button contributes
      // hit area, focus and semantics without painting a box over the scene.
      style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit" }}
    >
      {children}
    </button>
  );
}

/** Lists with `staggered` reveal one item per advance step. */
function StaggeredElement({
  element,
  theme,
  stageWidth,
  stageHeight,
  step,
  play,
}: {
  element: SceneElement;
  theme: PresentationTheme;
  stageWidth: number;
  stageHeight: number;
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
        stageHeight={stageHeight}
      />
    );
  }
  return (
    <ElementView
      element={element}
      theme={theme}
      stageWidth={stageWidth}
      stageHeight={stageHeight}
    />
  );
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
        <Stage
          content={content}
          theme={theme}
          aspect={aspect}
          fixedScale={1}
          className="size-full"
        />
      </div>
    </div>
  );
});
