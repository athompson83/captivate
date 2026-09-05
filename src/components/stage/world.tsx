"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import type {
  AspectRatio,
  JourneyBackdrop,
  Scene,
  ScenePlacement,
} from "@/lib/schema/presentation";
import { stageBackgroundCss, themeCssVars, type PresentationTheme } from "@/lib/schema/theme";
import { stageSize } from "@/lib/present/stage";
import {
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
import { backdropPlane, backdropTransform } from "@/lib/present/backdrop";
import { measureDrawnPath } from "./drawn-picture";
import { ambientAt, paletteOf, scenePalettes } from "@/lib/present/ambient";
import { oklabCss } from "@/lib/utils/color";
import { Stage } from "./stage";
import type { AtmosphereHandle } from "./atmosphere";
import { cn } from "@/lib/utils/cn";

/**
 * The atmosphere arrives a beat late, on purpose.
 *
 * It is a WebGL layer behind everything, so it carries a renderer's worth of
 * bytes for something nobody reads. Loading it after the first paint keeps it
 * out of the critical path, and the CSS wash underneath is a complete
 * background on its own until it lands — and if it never lands, that wash is
 * still what the page shows.
 */
const Atmosphere = dynamic(() => import("./atmosphere").then((m) => m.Atmosphere), {
  ssr: false,
});

/**
 * The world.
 *
 * One page. Every scene exists at once as a *region* of a single continuous
 * surface — not a card sitting on it — and presenting is a camera moving
 * between those regions. This component draws that surface and flies the
 * camera; `Stage` draws the contents of one region.
 *
 * Nothing here has an edge. Scenes render bare, the background is one field
 * that spans the whole canvas, and the atmosphere at any point is blended from
 * the regions nearest to it, so flying between two parts of a presentation
 * changes the colour of the room on the way.
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
  /**
   * A picture behind the whole show, on a plane some scene-widths back so it
   * moves with parallax under a flight and stands still on a scene. Absent
   * or with an empty url, the atmosphere is the ground.
   */
  backdrop?: JourneyBackdrop;
  showPath?: boolean;
  /**
   * Viewport pixels on the left the camera must treat as occupied — the
   * movement rail overlays the world there, and without this the camera
   * framed scenes into space the rail was standing in. Applied only at
   * widths where the rail actually renders (its own `sm:` breakpoint);
   * below that it hides itself and the whole viewport is clear.
   */
  safeInsetLeft?: number;
  className?: string;
  /** Rendered above the world, unscaled (annotations, presenter chrome). */
  chrome?: React.ReactNode;
  onSceneSelect?: (index: number) => void;
  /**
   * Dives to a detail scene when a hotspot is activated.
   *
   * Live only on the scene the camera is actually on, and never while the
   * overview is open — there, a click means "take me to this scene", and a
   * hotspot competing for the same click would send the presenter somewhere
   * they did not ask to go.
   */
  onHotspot?: (targetSceneId: string) => void;
  /** Accessible name for a hotspot whose author left the label empty. */
  hotspotName?: (targetSceneId: string) => string;
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
  backdrop,
  showPath = false,
  safeInsetLeft = 0,
  className,
  chrome,
  onSceneSelect,
  onHotspot,
  hotspotName,
  onArrive,
}: WorldProps) {
  // Memoised because it is a dependency of four other memos — the flight
  // target, the culling pass, the world bounds and the region gradients — and
  // `stageSize` returns a fresh object. Without this every one of them
  // recomputed on every render, including a full culling sweep and a
  // per-scene gradient string, at pointer-event rate while the presenter
  // moved the mouse or waved the laser.
  const stage = useMemo(() => stageSize(aspect), [aspect]);
  const reduced = useReducedMotion();

  const basePalette = useMemo(() => paletteOf(theme), [theme]);
  const palettes = useMemo(() => scenePalettes(scenes, theme), [scenes, theme]);

  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  /** The picture behind the show, moved from the same loop as the world. */
  const backdropRef = useRef<HTMLDivElement>(null);
  /** The full-viewport wash whose colour tracks where the camera is. */
  const ambientRef = useRef<HTMLDivElement>(null);
  /** The per-pixel field drawn over that wash, where WebGL is available. */
  const atmosphereRef = useRef<AtmosphereHandle | null>(null);
  /**
   * Whether the field has actually painted a frame.
   *
   * Registering a handle is not the same as drawing: a handle exists even
   * where WebGL does not. The wash below is only redundant once something has
   * genuinely been rendered over it, and treating registration as proof left a
   * presentation with neither layer.
   */
  const atmospherePaintedRef = useRef(false);
  const registerAtmosphere = useCallback((handle: AtmosphereHandle | null) => {
    atmosphereRef.current = handle;
    if (!handle) {
      atmospherePaintedRef.current = false;
      return;
    }
    // The lazy chunk usually arrives after the flight effect has settled on a
    // destination, and that effect will not run again for an unchanged one —
    // so the first paint has to be asked for here.
    const camera = cameraRef.current;
    if (camera && handle.draw(camera)) atmospherePaintedRef.current = true;
  }, []);

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

  // 640 is the rail's own `sm:` breakpoint. The coupling is deliberate and
  // named at the prop; a rail that hides itself must also stop reserving room.
  const inset = safeInsetLeft > 0 && viewport.width >= 640 ? safeInsetLeft : 0;
  const effective = useMemo(
    () => ({ width: Math.max(1, viewport.width - inset), height: viewport.height }),
    [viewport.width, viewport.height, inset],
  );
  const aspectRatio =
    viewport.height > 0 ? effective.width / viewport.height : stage.width / stage.height;

  const target = useMemo(
    () => cameraFor(focus, scenes, placements, stage, aspectRatio),
    [focus, scenes, placements, stage, aspectRatio],
  );

  const hasBackdrop = Boolean(backdrop?.url);
  const backdropDistance = backdrop?.distance ?? 0.5;
  const worldBounds = useMemo(() => boundsOf(placements, stage), [placements, stage]);
  // The viewport's own aspect, not the inset one: the picture covers the
  // whole screen, rail included.
  const plane = useMemo(
    () =>
      backdropPlane(
        worldBounds,
        stage,
        viewport.height > 0 ? viewport.width / viewport.height : stage.width / stage.height,
        backdropDistance,
      ),
    [worldBounds, stage, viewport.width, viewport.height, backdropDistance],
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

    const apply = (camera: Camera) => {
      cameraRef.current = camera;
      // Prepending the inset shifts the frame's centre into the clear area;
      // `worldTransform` then fits and centres within what remains.
      node.style.transform =
        (inset > 0 ? `translate(${inset}px, 0px) ` : "") + worldTransform(camera, effective);

      // The picture behind the show, at its distance. Same loop, same frame,
      // so the parallax is never a frame behind the content.
      if (backdropRef.current) {
        backdropRef.current.style.transform = backdropTransform(
          camera,
          viewport,
          plane,
          stage,
          backdropDistance,
        );
      }

      // The room's colour follows the camera. Written as custom properties on
      // one element rather than through React: this runs sixty times a second.
      //
      // Skipped entirely while the WebGL field is live, because the field is
      // opaque and sits over it: recomputing a blend and restarting a
      // full-viewport gradient transition every frame, for something nobody
      // can see, is the most expensive way to do nothing.
      const wash = atmospherePaintedRef.current ? null : ambientRef.current;
      if (wash) {
        const ambient = ambientAt(camera, placements, palettes, stage, basePalette);
        wash.style.setProperty("--world-canvas", ambient.canvas);
        wash.style.setProperty("--world-surface", ambient.surface);
        wash.style.setProperty("--world-glow", ambient.glow);
      }

      // The same colour, per pixel, where the GPU can draw it. Deliberately
      // after the wash rather than instead of it: the wash is what shows if
      // this never initialises.
      if (atmosphereRef.current?.draw(camera)) atmospherePaintedRef.current = true;
    };

    // Re-rendering with an equal destination must not restart a flight, and
    // the memo above cannot promise referential stability across every parent.
    if (targetRef.current && camerasEqual(targetRef.current, target)) {
      // The destination has not moved, but the viewport may have.
      // `worldTransform` is a function of both and nothing else writes it, so
      // a resize that preserved the aspect ratio left the world positioned and
      // scaled for the old size — while the atmosphere, whose size effect
      // keys off the viewport directly, had already redrawn for the new one.
      // The air and the content then disagreed about where the regions were.
      if (frameRef.current === 0 && !timerRef.current && cameraRef.current) {
        apply(cameraRef.current);
      }
      return;
    }
    targetRef.current = target;
    halt();
    // Only the dissolve branch writes opacity back. A dissolve interrupted
    // before its midpoint by a target that then takes the cut or fly path left
    // the world invisible with nothing to restore it.
    node.style.opacity = "1";

    /**
     * Landed.
     *
     * Collapsing `origin` onto the destination is what ends the flight as far
     * as culling and detail are concerned. Left set, the union of both
     * endpoints stayed in force for the rest of the presentation, so one move
     * to overview kept the whole deck mounted at full detail from then on.
     */
    const arrive = () => {
      setOrigin(target);
      arriveRef.current?.();
    };

    const from = cameraRef.current;
    // First paint, an explicit cut, or a reduced-motion preference: arrive.
    if (!from || travel === "cut" || reduced) {
      apply(target);
      arrive();
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
        arrive();
      }, half);
      return;
    }

    const path = flight(from, target);
    const duration = flightDuration(path.length, pace) * 1000;
    if (duration < 32) {
      apply(target);
      arrive();
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
      arrive();
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [
    target,
    viewport,
    inset,
    effective,
    travel,
    pace,
    depth,
    reduced,
    halt,
    placements,
    palettes,
    stage,
    basePalette,
    plane,
    backdropDistance,
  ]);

  /* ---------------------------------------------------------------------- */
  /* What to render                                                          */
  /* ---------------------------------------------------------------------- */

  const accentFor = useCallback(
    (index: number) => oklabCss((palettes[index] ?? basePalette).accent, 0.22),
    [palettes, basePalette],
  );

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
        const seenFrom = cameras.filter((_, i) => rectsIntersect(regions[i], rect));
        if (!seenFrom.length && index !== activeIndex) return null;

        // Detail is the best any endpoint that can actually see it asks for: a
        // scene legible at the destination stays legible for the whole flight.
        //
        // Judged per camera rather than across all of them, because a scene
        // off-screen at the origin still had the origin's zoom applied to it —
        // so pulling back to overview from a close-in scene promoted every
        // scene in the deck to a full Stage, which is the exact cost the
        // landmark path exists to avoid.
        const judged = seenFrom.length ? seenFrom : [target];
        const widest = Math.max(
          ...judged.map((camera) => stage.width * placement.scale * cameraScale(camera, effective)),
        );

        return { index, placement, detailed: widest >= DETAIL_THRESHOLD };
      })
      .filter((entry): entry is { index: number; placement: ScenePlacement; detailed: boolean } =>
        Boolean(entry),
      );
  }, [placements, origin, target, viewport, effective, aspectRatio, stage, activeIndex]);

  /**
   * Pools of colour, one per region, painted into the surface itself.
   *
   * Positioned as percentages of the world box so the whole thing is a single
   * static background image — the camera transform above moves it, which costs
   * nothing, where re-rendering a gradient per frame would cost everything.
   */
  const regionField = useMemo(() => {
    if (placements.length === 0) return "transparent";
    const width = worldBounds.width + stage.width * 2;
    const height = worldBounds.height + stage.height * 2;
    const originX = worldBounds.x - stage.width;
    const originY = worldBounds.y - stage.height;

    return placements
      .map((placement, index) => {
        const palette = palettes[index] ?? basePalette;
        const x = ((placement.x - originX) / width) * 100;
        const y = ((placement.y - originY) / height) * 100;
        // Sized to the region it belongs to, so a nested detail tints a small
        // pocket rather than washing over its parent.
        const spread = ((stage.width * placement.scale * 1.6) / width) * 100;
        return `radial-gradient(${spread}% ${spread * (width / height)}% at ${x}% ${y}%, ${oklabCss(
          palette.accent,
          0.1,
        )} 0%, transparent 70%)`;
      })
      .join(", ");
  }, [placements, palettes, basePalette, worldBounds, stage]);
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
      {/*
        The room. One wash across the whole viewport whose colour is blended
        from whichever regions the camera is nearest, so arriving somewhere new
        changes the light before the content has finished settling.
      */}
      <div
        ref={ambientRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 12%, var(--world-surface, var(--stage-surface)) 0%, var(--world-canvas, var(--stage-canvas)) 68%)",
          transition: "background 420ms linear",
        }}
      />

      {/*
        Depth, and the air itself.

        A dot grid used to live here, taking a damped share of the camera's
        movement so that travelling had something to travel *through*. It did
        that job and told the wrong story: a grid of dots is the visual
        language of a design tool, and the moment a presentation looks like a
        canvas with a grid on it, it is a canvas with a grid on it.

        The field that replaced it is light. Every pixel is turned back into a
        world position and coloured by the regions around it, so the air is
        genuinely different on one side of the screen from the other — which is
        the whole claim the world makes and the one thing a single CSS gradient
        cannot say.
      */}
      {viewport.width > 0 && (
        <Atmosphere
          onReady={registerAtmosphere}
          placements={placements}
          palettes={palettes}
          base={basePalette}
          stage={stage}
          viewport={viewport}
          depth={depth}
          still={Boolean(reduced)}
        />
      )}

      {/*
        The picture behind the show. Above the air, below the content, on a
        plane some scene-widths back — so a flight slides it slower than the
        scenes and a zoom grows it less, and on a scene it is perfectly still.
        Dimmed toward the theme's canvas so the scenes' text stays legible.
      */}
      {hasBackdrop && backdrop && (
        <div
          ref={backdropRef}
          aria-hidden
          data-backdrop
          className="pointer-events-none absolute top-0 left-0 origin-top-left"
          style={{ width: plane.width, height: plane.height, willChange: "transform" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed private asset in a transformed layer; see element-view */}
          <img
            src={backdrop.url}
            alt=""
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {backdrop.dim > 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: theme.tokens.canvas,
                opacity: backdrop.dim,
              }}
            />
          )}
        </div>
      )}

      <div
        ref={worldRef}
        data-world
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: 0, height: 0, willChange: "transform" }}
      >
        {/*
          The canvas itself. Each region breathes its own colour into the
          surface around it, in world space, so the colour arrives before the
          content does and the space between regions belongs to both of them.
        */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: worldBounds.x - stage.width,
            top: worldBounds.y - stage.height,
            width: worldBounds.width + stage.width * 2,
            height: worldBounds.height + stage.height * 2,
            background: regionField,
            pointerEvents: "none",
          }}
        />

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
            {/* Two strokes: a wide soft one that reads as a trodden path,
                and a fine dotted one over it that reads as direction. The
                wide one draws itself in when the overview opens — the same
                sketch mechanism as a drawing element, measured once and
                animated by the browser — and the dots fade up behind it. A
                dotted stroke cannot be dash-animated (the dashes *are* the
                dots), which is why the draw-in belongs to the solid one. */}
            <path
              ref={measureDrawnPath}
              d={route}
              className="dp-path dp-drawn"
              stroke="var(--stage-accent)"
              strokeWidth={stage.width * 0.05}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.06}
              style={{ "--dp-dur": "1.4s" } as React.CSSProperties}
            />
            <path
              d={route}
              className="dp-fade"
              fill="none"
              stroke="var(--stage-accent)"
              strokeWidth={stage.width * 0.006}
              strokeLinecap="round"
              strokeDasharray={`${stage.width * 0.002} ${stage.width * 0.028}`}
              opacity={0.45}
              style={{ animationDelay: "0.9s" }}
            />
          </svg>
        )}

        {rendered.map(({ index, placement, detailed }) => {
          const scene = scenes[index];
          if (!scene) return null;
          const isActive = index === activeIndex;
          // Only the scene the camera is on, and only when nothing else owns
          // the click. A hotspot on a region the presenter is flying past is
          // not something anyone is aiming at.
          const hotspotsLive = Boolean(onHotspot) && isActive && !onSceneSelect;

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
                // The scene layer is inert unless something on it can be
                // clicked: selecting the scene in the overview, or a hotspot on
                // the scene the camera is on. Left "auto" everywhere, a stray
                // click on a neighbouring region would land on the wrong scene.
                pointerEvents: onSceneSelect || hotspotsLive ? "auto" : "none",
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
                  // A region of the world, not an object on it: no background,
                  // no edge, no box. The surface underneath belongs to the
                  // world, and this paints its content straight onto it.
                  surface="bare"
                  play={play && isActive}
                  // Scenes the presenter is not on show every build step, so a
                  // scene the camera is flying towards is not half-empty when
                  // it arrives.
                  step={isActive ? step : Number.MAX_SAFE_INTEGER}
                  onHotspot={hotspotsLive ? onHotspot : undefined}
                  hotspotName={hotspotName}
                />
              ) : (
                <SceneLandmark title={scene.title} stage={stage} accent={accentFor(index)} />
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
 * A region too small to read.
 *
 * A place on a map, not a thumbnail of a slide: a soft pool of its own colour
 * with its name over it, and no border, because a border at this size is the
 * single strongest cue that the thing is a card. Every size is a fraction of
 * the region's own box, so it scales with the camera without being told
 * anything about it.
 */
function SceneLandmark({ title, stage, accent }: { title: string; stage: Size; accent: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${stage.width * 0.06}px`,
        background: `radial-gradient(closest-side, ${accent} 0%, transparent 78%)`,
      }}
    >
      <span
        style={{
          color: "var(--stage-ink)",
          fontFamily: "var(--stage-font-display)",
          fontSize: stage.height * 0.17,
          lineHeight: 1.15,
          textAlign: "center",
          opacity: 0.82,
          textWrap: "balance",
        }}
      >
        {title}
      </span>
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
