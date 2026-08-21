"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenePlacement } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { stageSize } from "@/lib/present/stage";
import {
  boundsOf,
  cameraScale,
  frameRect,
  worldTransform,
  type Camera,
  type Size,
} from "@/lib/present/camera";
import { resolvePlacements } from "@/lib/present/arrange";
import { smoothPath } from "@/lib/present/path";
import { useEditor, updateSceneMeta } from "@/lib/editor/store";
import { Stage } from "@/components/stage/stage";
import { cn } from "@/lib/utils/cn";

/**
 * The journey map.
 *
 * Where the canvas edits one scene, this edits the *world*: where each scene
 * sits relative to every other, how big it is, and therefore what the camera
 * does when it travels between them. Dragging a scene into another scene makes
 * it a detail of that scene, and the camera will dive into it — the spatial
 * relationship is the authoring, there is no separate "make this a sub-slide"
 * command to learn.
 *
 * Pan and zoom are written straight to the DOM, like the presenting camera, so
 * dragging across a sixty-scene world costs one transform per frame.
 */

/** Zoom limits for the map view itself, as multiples of the fitted view. */
const MIN_ZOOM_OUT = 6;
const MAX_ZOOM_IN = 0.05;

type Drag =
  | { kind: "pan"; startX: number; startY: number; camera: Camera }
  | {
      kind: "move";
      sceneId: string;
      startX: number;
      startY: number;
      origin: ScenePlacement;
    }
  | {
      kind: "scale";
      sceneId: string;
      startX: number;
      startY: number;
      origin: ScenePlacement;
      grabDistance: number;
    };

export function JourneyMap({ className }: { className?: string }) {
  const scenes = useEditor((s) => s.document.scenes);
  const presentation = useEditor((s) => s.document.presentation);
  const selectedSceneId = useEditor((s) => s.selection.sceneId);
  const select = useEditor((s) => s.select);

  const theme = getTheme(presentation.themeId);
  const stage = stageSize(presentation.aspectRatio);

  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<Camera | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  /**
   * Where the user has panned or zoomed to, or null for "framing everything".
   *
   * Holding the *deviation* rather than the camera means the fitted view is
   * derived from the world, so applying an arrangement re-frames the map for
   * free instead of leaving it looking at where the scenes used to be.
   */
  const [userView, setUserView] = useState<Camera | null>(null);

  const placements = useMemo(
    () => resolvePlacements(scenes, presentation.journey, stage),
    [scenes, presentation.journey, stage],
  );

  const bounds = useMemo(() => boundsOf(placements, stage), [placements, stage]);

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

  const fitted = useMemo(() => frameRect(bounds, aspectRatio, 0.16), [bounds, aspectRatio]);
  const camera = userView ?? fitted;

  // Applying an arrangement moves every scene, so whatever the user was
  // looking at no longer exists. Dropping their view re-frames the new world.
  // Adjusting state during render is the supported way to react to a changed
  // input without a second render pass.
  const [lastArrangement, setLastArrangement] = useState(presentation.journey.arrangement);
  if (lastArrangement !== presentation.journey.arrangement) {
    setLastArrangement(presentation.journey.arrangement);
    setUserView(null);
  }

  const applyCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = next;
      const node = worldRef.current;
      if (node && viewport.width > 0) {
        node.style.transform = worldTransform(next, viewport);
      }
    },
    [viewport],
  );

  /**
   * Push the camera to the DOM.
   *
   * Skipped mid-gesture: a drag writes the transform directly for smoothness,
   * and a re-render landing in the middle of one must not yank the view back
   * to the last committed camera.
   */
  useEffect(() => {
    if (viewport.width === 0 || dragRef.current) return;
    applyCamera(camera);
  }, [camera, viewport, applyCamera]);

  /* ---------------------------------------------------------------------- */
  /* Gestures                                                                */
  /* ---------------------------------------------------------------------- */

  /** Screen point to world point under the current camera. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const camera = cameraRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!camera || !rect) return { x: 0, y: 0 };
      const scale = cameraScale(camera, viewport);
      return {
        x: camera.x + (clientX - rect.left - viewport.width / 2) / scale,
        y: camera.y + (clientY - rect.top - viewport.height / 2) / scale,
      };
    },
    [viewport],
  );

  const onWheel = (e: React.WheelEvent) => {
    const live = cameraRef.current;
    if (!live) return;
    e.preventDefault();

    // Zoom about the pointer, so the thing under the cursor stays under it.
    const anchor = toWorld(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015);
    const width = Math.min(
      fitted.width * MIN_ZOOM_OUT,
      Math.max(fitted.width * MAX_ZOOM_IN, live.width * factor),
    );
    const ratio = width / live.width;

    setUserView({
      ...live,
      width,
      x: anchor.x + (live.x - anchor.x) * ratio,
      y: anchor.y + (live.y - anchor.y) * ratio,
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const live = cameraRef.current;
    if (!live || e.button !== 0) return;

    const target = e.target as HTMLElement;
    const sceneEl = target.closest<HTMLElement>("[data-map-scene]");
    const handle = target.closest<HTMLElement>("[data-map-handle]");
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (sceneEl) {
      const sceneId = sceneEl.dataset.mapScene ?? "";
      const index = scenes.findIndex((s) => s.id === sceneId);
      const origin = placements[index];
      if (!origin) return;

      select({ sceneId, elementIds: [] });

      if (handle) {
        const point = toWorld(e.clientX, e.clientY);
        dragRef.current = {
          kind: "scale",
          sceneId,
          startX: e.clientX,
          startY: e.clientY,
          origin,
          grabDistance: Math.max(1, Math.hypot(point.x - origin.x, point.y - origin.y)),
        };
        return;
      }

      dragRef.current = { kind: "move", sceneId, startX: e.clientX, startY: e.clientY, origin };
      return;
    }

    dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, camera: live };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const live = cameraRef.current;
    if (!drag || !live) return;

    if (drag.kind === "pan") {
      const scale = cameraScale(drag.camera, viewport);
      applyCamera({
        ...drag.camera,
        x: drag.camera.x - (e.clientX - drag.startX) / scale,
        y: drag.camera.y - (e.clientY - drag.startY) / scale,
      });
      return;
    }

    if (drag.kind === "move") {
      const scale = cameraScale(live, viewport);
      commitPlacement(drag.sceneId, {
        ...drag.origin,
        x: drag.origin.x + (e.clientX - drag.startX) / scale,
        y: drag.origin.y + (e.clientY - drag.startY) / scale,
      });
      return;
    }

    const point = toWorld(e.clientX, e.clientY);
    const distance = Math.max(1, Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y));
    commitPlacement(drag.sceneId, {
      ...drag.origin,
      scale: clampScale((drag.origin.scale * distance) / drag.grabDistance),
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    // A pan led the DOM; commit it so the derived camera agrees again.
    if (drag.kind === "pan" && cameraRef.current) setUserView(cameraRef.current);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const mapScale = viewport.width > 0 ? cameraScale(camera, viewport) : 0;
  const route = useMemo(
    () => smoothPath(placements.map((p) => ({ x: p.x, y: p.y }))),
    [placements],
  );

  return (
    <div
      ref={mergeRefs(containerRef, measureRef)}
      className={cn(
        "relative touch-none overflow-hidden bg-[var(--surface-inset)] select-none",
        className,
      )}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ cursor: "grab" }}
    >
      <div
        ref={worldRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: 0, height: 0, willChange: "transform" }}
      >
        <svg
          aria-hidden
          style={{
            position: "absolute",
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            overflow: "visible",
            pointerEvents: "none",
          }}
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        >
          <path
            d={route}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stage.width * 0.008}
            strokeLinecap="round"
            strokeDasharray={`${stage.width * 0.04} ${stage.width * 0.03}`}
            opacity={0.55}
          />
        </svg>

        {scenes.map((scene, index) => {
          const placement = placements[index];
          if (!placement) return null;
          const selected = scene.id === selectedSceneId;
          const onScreen = stage.width * placement.scale * mapScale;

          return (
            <div
              key={scene.id}
              data-map-scene={scene.id}
              style={{
                position: "absolute",
                left: placement.x - stage.width / 2,
                top: placement.y - stage.height / 2,
                width: stage.width,
                height: stage.height,
                transform: `rotate(${placement.rotation}deg) scale(${placement.scale})`,
                transformOrigin: "center center",
                cursor: "move",
                outline: selected
                  ? `${stage.width * 0.006}px solid var(--accent)`
                  : `${stage.width * 0.002}px solid color-mix(in oklch, var(--ink) 14%, transparent)`,
                outlineOffset: stage.width * 0.008,
                borderRadius: stage.width * 0.008,
                background: "var(--surface)",
              }}
            >
              {onScreen > 90 ? (
                <Stage
                  content={scene.content}
                  theme={theme}
                  aspect={presentation.aspectRatio}
                  fixedScale={1}
                  className="pointer-events-none size-full"
                />
              ) : (
                <div
                  className="pointer-events-none flex size-full items-center justify-center"
                  style={{
                    color: "color-mix(in oklch, var(--ink) 45%, transparent)",
                    fontSize: stage.height * 0.4,
                    fontWeight: 600,
                  }}
                >
                  {index + 1}
                </div>
              )}

              {/* Waypoint number: the reading order, independent of position. */}
              <div
                className="pointer-events-none absolute flex items-center justify-center rounded-full"
                style={{
                  left: -stage.width * 0.028,
                  top: -stage.width * 0.028,
                  width: stage.width * 0.075,
                  height: stage.width * 0.075,
                  background: selected ? "var(--accent)" : "var(--surface-raised, var(--surface))",
                  color: selected ? "var(--on-accent)" : "var(--ink)",
                  border: `${stage.width * 0.003}px solid var(--line)`,
                  fontSize: stage.width * 0.04,
                  fontWeight: 600,
                }}
              >
                {index + 1}
              </div>

              {selected && (
                <div
                  data-map-handle="scale"
                  style={{
                    position: "absolute",
                    right: -stage.width * 0.02,
                    bottom: -stage.width * 0.02,
                    width: stage.width * 0.045,
                    height: stage.width * 0.045,
                    borderRadius: stage.width * 0.012,
                    background: "var(--accent)",
                    border: `${stage.width * 0.004}px solid var(--surface)`,
                    cursor: "nwse-resize",
                  }}
                  title="Drag to resize this scene in the world"
                />
              )}
            </div>
          );
        })}
      </div>

      <MapLegend onFit={() => setUserView(null)} />
    </div>
  );
}

function clampScale(value: number): number {
  return Math.min(40, Math.max(0.004, value));
}

/**
 * Placement changes go through the same mutate/undo path as any other edit, and
 * coalesce per scene so a drag is one undo step rather than two hundred.
 */
function commitPlacement(sceneId: string, placement: ScenePlacement) {
  updateSceneMeta(
    sceneId,
    { placement },
    { label: "Move scene", coalesceKey: `placement-${sceneId}` },
  );
}

function MapLegend({ onFit }: { onFit: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3">
      <p className="text-ink-3 max-w-[46ch] text-[11.5px] leading-relaxed">
        Drag to move a scene, drag the corner to resize it. A scene placed inside another becomes a
        detail of it, and the camera dives in.
      </p>
      <button
        onClick={onFit}
        className="border-line text-ink-2 hover:border-line-strong hover:text-ink pointer-events-auto rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 py-1.5 text-[12px] transition-colors"
      >
        Fit all
      </button>
    </div>
  );
}

function mergeRefs<T>(
  object: React.RefObject<T | null>,
  callback: (node: T | null) => void | (() => void),
) {
  return (node: T | null) => {
    object.current = node;
    return callback(node);
  };
}
