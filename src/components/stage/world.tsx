"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { AspectRatio, Scene, ScenePlacement } from "@/lib/schema/presentation";
import { stageBackgroundCss, themeCssVars, type PresentationTheme } from "@/lib/schema/theme";
import { stageSize } from "@/lib/present/stage";
import {
  backdropTransform,
  boundsOf,
  camerasEqual,
  cameraScale,
  easeFlight,
  flight,
  flightDuration,
  frameRect,
  frameScene,
  rectsIntersect,
  sceneWorldRect,
  visibleRect,
  worldTransform,
  type Camera,
  type Size,
} from "@/lib/present/camera";
import { smoothPath } from "@/lib/present/path";
import { Stage } from "./stage";
import { cn } from "@/lib/utils/cn";

/**
 * The world.
 *
 * Every scene in a presentation exists at once, on one canvas, and presenting
 * is a camera moving between them. This component draws that canvas and flies
 * the camera; it is the counterpart to `Stage`, which draws a single scene.
 *
 * Two constraints shape the implementation:
 *
 *  1. **A flight is sixty transform writes a second.** None of them may pass
 *     through React. The camera lives in a ref and the animation loop writes
 *     `style.transform` directly on one promoted layer, so a move costs the
 *     compositor a matrix and costs React nothing.
 *  2. **React still has to decide what exists.** Culling and level of detail
 *     therefore key off the *endpoints* of a flight rather than the live
 *     camera: one render when the destination changes, none while travelling.
 *     Detail is taken as the maximum across both endpoints, so nothing pops
 *     into or out of simplification mid-flight.
 */

/** Where the camera should be, expressed as intent rather than as geometry. */
export type Focus =
  { kind: "scene"; index: number } | { kind: "world" } | { kind: "section"; sectionId: string };

/** On-screen width, in px, below which a scene is drawn as a marker. */
const DETAIL_THRESHOLD = 132;

/** Length of a `dissolve` swap, in ms. */
const DISSOLVE_MS = 260;

/** Extra viewport-widths of world kept rendered around the visible region. */
const CULL_MARGIN = 0.35;

export interface WorldProps {
  scenes: Scene[];
  placements: ScenePlacement[];
  theme: PresentationTheme;
  aspect: AspectRatio;
  focus: Focus;
  /** Index whose builds are live; other scenes render fully composed. */
  activeIndex: number;
  step: number;
  play?: boolean;
  travel: "fly" | "cut" | "dissolve";
  pace: number;
  depth: number;
  showPath?: boolean;
  className?: string;
  /** Rendered above the world, unscaled (annotations, presenter chrome). */
  chrome?: React.ReactNode;
  onSceneSelect?: (index: number) => void;
  /** Fired when a camera flight settles, so callers can re-enable input. */
  onArrive?: () => void;
}

export const World = memo(function World({
  scenes,
  placements,
  theme,
  aspect,
  focus,
  activeIndex,
  step,
  play = false,
  travel,
  pace,
  depth,
  showPath = false,
  className,
  chrome,
  onSceneSelect,
  onArrive,
}: WorldProps) {
  const stage = stageSize(aspect);
  const reduced = useReducedMotion();

  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  /** Live camera. Written every frame; never read during render. */
  const cameraRef = useRef<Camera | null>(null);
  /** Destination of the flight in progress, to ignore equal re-targets. */
  const targetRef = useRef<Camera | null>(null);
  /**
   * The animation in progress.
   *
   * Held in refs rather than torn down by the flight effect's cleanup. The
   * effect re-runs on every render — `target` is a fresh object each time — and
   * a cleanup that cancelled the frame would kill a flight the moment anything
   * else re-rendered the tree. Something always does: the session clock ticks
   * once a second. The result was a camera that set off and froze halfway.
   */
  const frameRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arriveRef = useRef(onArrive);
  // Kept current in an effect, not during render: the flight loop below must
  // not restart when only the callback identity changes.
  useEffect(() => {
    arriveRef.current = onArrive;
  }, [onArrive]);

  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  /** Where the current flight began; used only to decide what to render. */
  const [origin, setOrigin] = useState<Camera | null>(null);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const read = () => {
      const rect = node.getBoundingClientRect();
      setViewport((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const aspectRatio =
    viewport.height > 0 ? viewport.width / viewport.height : stage.width / stage.height;

  const target = useMemo(
    () => cameraFor(focus, scenes, placements, stage, aspectRatio),
    [focus, scenes, placements, stage, aspectRatio],
  );

  /* ---------------------------------------------------------------------- */
  /* The flight                                                              */
  /* ---------------------------------------------------------------------- */

  /** Stops whatever the camera was doing. Called before starting anything. */
  const halt = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  // Unmount only. Deliberately not the flight effect's cleanup — see the refs.
  useEffect(() => halt, [halt]);

  useEffect(() => {
    const node = worldRef.current;
    if (!node || viewport.width === 0) return;

    // Re-rendering with an equal destination must not restart a flight, and
    // the memo above cannot promise referential stability across every parent.
    if (targetRef.current && camerasEqual(targetRef.current, target)) return;
    targetRef.current = target;
    halt();

    const apply = (camera: Camera) => {
      cameraRef.current = camera;
      node.style.transform = worldTransform(camera, viewport);
      const backdrop = backdropRef.current;
      if (backdrop) backdrop.style.transform = backdropTransform(camera, viewport, depth);
    };

    const from = cameraRef.current;
    // First paint, an explicit cut, or a reduced-motion preference: arrive.
    if (!from || travel === "cut" || reduced) {
      setOrigin(target);
      apply(target);
      arriveRef.current?.();
      return;
    }

    setOrigin(from);

    // Dissolve: no travel at all, the world simply changes underneath. Both
    // endpoints stay rendered across the swap, so nothing disappears while it
    // is still partly visible.
    if (travel === "dissolve") {
      const half = DISSOLVE_MS / 2;
      node.style.transition = `opacity ${half}ms linear`;
      node.style.opacity = "0";
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        apply(target);
        node.style.opacity = "1";
        arriveRef.current?.();
      }, half);
      return;
    }

    const path = flight(from, target);
    const duration = flightDuration(path.length, pace) * 1000;
    if (duration < 32) {
      apply(target);
      arriveRef.current?.();
      return;
    }

    let startedAt = 0;
    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const t = Math.min(1, (now - startedAt) / duration);
      if (t < 1) {
        apply(path.at(easeFlight(t)));
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      // Land on exactly the camera that was asked for. Evaluating the path at
      // t=1 is analytically the same point but lands a fraction off it, and
      // that error would otherwise accumulate across a presentation.
      apply(target);
      frameRef.current = 0;
      arriveRef.current?.();
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [target, viewport, travel, pace, depth, reduced, halt]);

  /* ---------------------------------------------------------------------- */
  /* What to render                                                          */
  /* ---------------------------------------------------------------------- */

  const rendered = useMemo(() => {
    if (viewport.width === 0) return [];

    const cameras = origin && !camerasEqual(origin, target) ? [origin, target] : [target];
    const regions = cameras.map((camera) => {
      const rect = visibleRect(camera, aspectRatio);
      const padX = rect.width * CULL_MARGIN;
      const padY = rect.height * CULL_MARGIN;
      return {
        x: rect.x - padX,
        y: rect.y - padY,
        width: rect.width + padX * 2,
        height: rect.height + padY * 2,
      };
    });

    return placements
      .map((placement, index) => {
        const rect = sceneWorldRect(placement, stage);
        const visible =
          index === activeIndex || regions.some((region) => rectsIntersect(region, rect));
        if (!visible) return null;

        // Detail is the best either endpoint asks for: a scene that is legible
        // at the destination stays legible for the whole flight.
        const widest = Math.max(
          ...cameras.map((camera) => stage.width * placement.scale * cameraScale(camera, viewport)),
        );

        return { index, placement, detailed: widest >= DETAIL_THRESHOLD };
      })
      .filter((entry): entry is { index: number; placement: ScenePlacement; detailed: boolean } =>
        Boolean(entry),
      );
  }, [placements, origin, target, viewport, aspectRatio, stage, activeIndex]);

  const worldBounds = useMemo(() => boundsOf(placements, stage), [placements, stage]);
  const route = useMemo(
    () => (showPath ? smoothPath(placements.map((p) => ({ x: p.x, y: p.y }))) : ""),
    [showPath, placements],
  );

  return (
    <div
      ref={mergeRefs(containerRef, measureRef)}
      className={cn("relative overflow-hidden", className)}
      style={{ ...themeCssVars(theme), background: stageBackgroundCss(theme) }}
    >
      {depth > 0 && (
        <div
          ref={backdropRef}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 origin-top-left"
          style={{
            width: 1,
            height: 1,
            // A field of faint marks with nothing to read: it exists to give
            // the eye something to measure the camera's motion against.
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklch, var(--stage-ink) 22%, transparent) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            backgroundPosition: "center",
            boxShadow: "0 0 0 100000px transparent",
            opacity: 0.5,
          }}
        />
      )}

      <div
        ref={worldRef}
        data-world
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: 0, height: 0, willChange: "transform" }}
      >
        {showPath && route && (
          <svg
            aria-hidden
            style={{
              position: "absolute",
              left: worldBounds.x,
              top: worldBounds.y,
              width: worldBounds.width,
              height: worldBounds.height,
              overflow: "visible",
              pointerEvents: "none",
            }}
            viewBox={`${worldBounds.x} ${worldBounds.y} ${worldBounds.width} ${worldBounds.height}`}
          >
            <path
              d={route}
              fill="none"
              stroke="var(--stage-accent)"
              strokeWidth={stage.width * 0.012}
              strokeLinecap="round"
              strokeDasharray={`${stage.width * 0.05} ${stage.width * 0.04}`}
              opacity={0.5}
            />
          </svg>
        )}

        {rendered.map(({ index, placement, detailed }) => {
          const scene = scenes[index];
          if (!scene) return null;
          const isActive = index === activeIndex;

          return (
            <div
              key={scene.id}
              data-scene-index={index}
              onClick={onSceneSelect ? () => onSceneSelect(index) : undefined}
              style={{
                position: "absolute",
                left: placement.x - stage.width / 2,
                top: placement.y - stage.height / 2,
                width: stage.width,
                height: stage.height,
                transform: `rotate(${placement.rotation}deg) scale(${placement.scale})`,
                transformOrigin: "center center",
                pointerEvents: onSceneSelect ? "auto" : "none",
                cursor: onSceneSelect ? "pointer" : undefined,
              }}
            >
              {detailed ? (
                <Stage
                  content={scene.content}
                  theme={theme}
                  aspect={aspect}
                  fixedScale={1}
                  className="size-full"
                  play={play && isActive}
                  // Scenes the presenter is not on show every build step, so a
                  // scene the camera is flying towards is not half-empty when
                  // it arrives.
                  step={isActive ? step : Number.MAX_SAFE_INTEGER}
                />
              ) : (
                <SceneMarker index={index} title={scene.title} stage={stage} active={isActive} />
              )}
            </div>
          );
        })}
      </div>

      {chrome}
    </div>
  );
});

/**
 * A scene too small to read.
 *
 * Drawn as a card with its number rather than as unreadable body text. Every
 * size here is a fraction of the stage box, so it scales with the camera
 * without needing to know anything about it.
 */
function SceneMarker({
  index,
  title,
  stage,
  active,
}: {
  index: number;
  title: string;
  stage: Size;
  active: boolean;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: stage.width * 0.022,
        background: "var(--stage-surface)",
        border: `${stage.width * 0.004}px solid ${
          active ? "var(--stage-accent)" : "color-mix(in oklch, var(--stage-ink) 18%, transparent)"
        }`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "color-mix(in oklch, var(--stage-ink) 55%, transparent)",
        fontSize: stage.height * 0.34,
        fontWeight: 600,
        letterSpacing: "-0.02em",
      }}
      title={title}
    >
      {index + 1}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Camera resolution                                                           */
/* -------------------------------------------------------------------------- */

function cameraFor(
  focus: Focus,
  scenes: Scene[],
  placements: ScenePlacement[],
  stage: Size,
  aspectRatio: number,
): Camera {
  if (focus.kind === "world") {
    return frameRect(boundsOf(placements, stage), aspectRatio, 0.12);
  }

  if (focus.kind === "section") {
    const inSection = placements.filter((_, i) => scenes[i]?.sectionId === focus.sectionId);
    if (inSection.length > 0) return frameRect(boundsOf(inSection, stage), aspectRatio, 0.14);
    return frameRect(boundsOf(placements, stage), aspectRatio, 0.12);
  }

  const placement = placements[focus.index];
  if (!placement) return frameRect(boundsOf(placements, stage), aspectRatio, 0.12);
  return frameScene(placement, stage, aspectRatio);
}

/** Callback refs compose by calling both; object refs by assignment. */
function mergeRefs<T>(
  object: React.RefObject<T | null>,
  callback: (node: T | null) => void | (() => void),
) {
  return (node: T | null) => {
    object.current = node;
    return callback(node);
  };
}
