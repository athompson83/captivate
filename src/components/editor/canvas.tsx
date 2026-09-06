"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  SAFE_MARGIN,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Frame,
  type SceneElement,
} from "@/lib/schema/presentation";
import type { PresentationTheme } from "@/lib/schema/theme";
import { stageSize, fitScale } from "@/lib/present/stage";
import {
  applyResize,
  clampFrame,
  collectSnapTargets,
  intersects,
  snapMove,
  type Guide,
  type ResizeHandle,
} from "@/lib/editor/geometry";
import { useCurrentScene, useEditor } from "@/lib/editor/store";
import { Stage } from "@/components/stage/stage";
import { ElementFrame } from "./element-frame";
import { SelectionToolbar } from "./selection-toolbar";
import { InsertBar } from "./insert-bar";
import { EmptySceneHint } from "./empty-scene-hint";

/**
 * The editing canvas.
 *
 * Interaction model:
 *  - Pointer down on an element selects it; shift extends the selection.
 *  - Dragging moves the selection, snapping to the safe area, the stage centre
 *    and other elements' edges. Holding Alt suspends snapping.
 *  - Eight handles resize; shift preserves aspect ratio.
 *  - Dragging on empty canvas draws a marquee.
 *  - Frames are written back to the store only on pointer *up*, so a drag is
 *    one history entry and one autosave, not one per frame.
 */
const EMPTY_ELEMENTS: SceneElement[] = [];

export function Canvas({
  theme,
  onAskAi,
}: {
  theme: PresentationTheme;
  /** Opens the AI dock, for an empty scene's third step. */
  onAskAi?: () => void;
}) {
  const scene = useCurrentScene();
  const aspect = useEditor((s) => s.document.presentation.aspectRatio);
  const selectedIds = useEditor((s) => s.selection.elementIds);
  const select = useEditor((s) => s.select);
  const mutate = useEditor((s) => s.mutate);

  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [liveFrames, setLiveFrames] = useState<Map<string, Frame> | null>(null);

  const size = stageSize(aspect);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // Leave breathing room so the stage never touches the panel edges.
      setScale(fitScale({ width: rect.width - 96, height: rect.height - 96 }, size));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width, size.height, size]);

  // Memoised so the drag and resize callbacks below keep a stable identity —
  // otherwise every render rebuilds them mid-drag.
  const elements = useMemo(() => scene?.content.elements ?? EMPTY_ELEMENTS, [scene]);
  const selected = useMemo(
    () => elements.filter((e) => selectedIds.includes(e.id)),
    [elements, selectedIds],
  );

  /** Convert a client point to stage units. */
  const toStage = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * STAGE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * STAGE_HEIGHT,
    };
  }, []);

  /** Commit dragged/resized frames into the store as one history entry. */
  const commitFrames = useCallback(
    (frames: Map<string, Frame>, label: string) => {
      if (!scene) return;
      mutate(
        (draft) => {
          const target = draft.scenes.find((s) => s.id === scene.id);
          if (!target) return;
          target.content = {
            ...target.content,
            // Any manual geometry change makes the scene free-form so the
            // layout engine stops overwriting the user's positioning.
            layout: "custom",
            elements: target.content.elements.map((el) =>
              frames.has(el.id) ? { ...el, frame: clampFrame(frames.get(el.id)!) } : el,
            ),
          };
        },
        { label, dirty: [scene.id] },
      );
    },
    [mutate, scene],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent, element: SceneElement) => {
      if (element.locked || editingId) return;
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let ids = selectedIds;
      if (additive) {
        ids = selectedIds.includes(element.id)
          ? selectedIds.filter((id) => id !== element.id)
          : [...selectedIds, element.id];
        select({ elementIds: ids });
        return; // Shift-click toggles selection; it does not begin a drag.
      }
      if (!selectedIds.includes(element.id)) {
        ids = [element.id];
        select({ elementIds: ids });
      }

      const dragging = elements.filter((el) => ids.includes(el.id) && !el.locked);
      if (!dragging.length) return;

      const startPoint = toStage(e.clientX, e.clientY);
      const startFrames = new Map(dragging.map((el) => [el.id, { ...el.frame }]));
      const others = elements.filter((el) => !ids.includes(el.id));
      const targets = collectSnapTargets(others);
      let moved = false;
      let latest = new Map(startFrames);

      const onMove = (ev: PointerEvent) => {
        const point = toStage(ev.clientX, ev.clientY);
        const dx = point.x - startPoint.x;
        const dy = point.y - startPoint.y;
        if (!moved && Math.hypot(dx, dy) < 0.35) return; // ignore jitter
        moved = true;

        const next = new Map<string, Frame>();
        // Snap using the primary element, then apply the same delta to the rest
        // so a multi-selection keeps its internal spacing.
        const primary = dragging[0];
        const primaryStart = startFrames.get(primary.id)!;
        const proposed = { ...primaryStart, x: primaryStart.x + dx, y: primaryStart.y + dy };
        const snapped = snapMove(proposed, targets, !ev.altKey);
        setGuides(snapped.guides);

        const appliedDx = snapped.frame.x - primaryStart.x;
        const appliedDy = snapped.frame.y - primaryStart.y;

        for (const [id, frame] of startFrames) {
          next.set(id, { ...frame, x: frame.x + appliedDx, y: frame.y + appliedDy });
        }
        latest = next;
        setLiveFrames(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setGuides([]);
        setLiveFrames(null);
        if (moved) commitFrames(latest, dragging.length > 1 ? "Move elements" : "Move element");
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // pointercancel too: a touch or pen interrupted by a system gesture
      // never sends pointerup, and the drag then never ended — guides stayed
      // on screen and the move handler kept running against a dead gesture.
      window.addEventListener("pointercancel", onUp);
    },
    [commitFrames, editingId, elements, select, selectedIds, toStage],
  );

  const startResize = useCallback(
    (e: React.PointerEvent, element: SceneElement, handle: ResizeHandle) => {
      e.stopPropagation();
      e.preventDefault();
      const startPoint = toStage(e.clientX, e.clientY);
      const startFrame = { ...element.frame };
      const others = elements.filter((el) => el.id !== element.id);
      const targets = collectSnapTargets(others);
      const lockAspect = element.type === "image" || element.type === "video";
      let latest = new Map<string, Frame>([[element.id, startFrame]]);
      let moved = false;

      const onMove = (ev: PointerEvent) => {
        const point = toStage(ev.clientX, ev.clientY);
        const resized = applyResize(
          startFrame,
          handle,
          point.x - startPoint.x,
          point.y - startPoint.y,
          {
            preserveAspect: ev.shiftKey || lockAspect,
          },
        );
        const snapped = snapMove(resized, targets, !ev.altKey);
        // Snapping a resize must not move the anchored edge, so only the
        // guides are taken from the snap — the frame keeps its computed size.
        setGuides(snapped.guides);
        moved = true;
        latest = new Map([[element.id, resized]]);
        setLiveFrames(latest);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setGuides([]);
        setLiveFrames(null);
        if (moved) commitFrames(latest, "Resize element");
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // pointercancel too: a touch or pen interrupted by a system gesture
      // never sends pointerup, and the drag then never ended — guides stayed
      // on screen and the move handler kept running against a dead gesture.
      window.addEventListener("pointercancel", onUp);
    },
    [commitFrames, elements, toStage],
  );

  const startMarquee = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      setEditingId(null);
      const start = toStage(e.clientX, e.clientY);
      let dragged = false;

      const onMove = (ev: PointerEvent) => {
        const point = toStage(ev.clientX, ev.clientY);
        const rect = {
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          w: Math.abs(point.x - start.x),
          h: Math.abs(point.y - start.y),
        };
        if (rect.w > 1 || rect.h > 1) dragged = true;
        setMarquee(rect);
        if (dragged) {
          select({
            elementIds: elements
              .filter((el) => !el.hidden && intersects(el.frame, rect))
              .map((el) => el.id),
          });
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setMarquee(null);
        if (!dragged) select({ elementIds: [] });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // pointercancel too: a touch or pen interrupted by a system gesture
      // never sends pointerup, and the drag then never ended — guides stayed
      // on screen and the move handler kept running against a dead gesture.
      window.addEventListener("pointercancel", onUp);
    },
    [elements, select, toStage],
  );

  if (!scene) {
    return (
      <div className="text-ink-3 flex flex-1 items-center justify-center text-[13px]">
        Select a scene to start editing.
      </div>
    );
  }

  const displayContent = liveFrames
    ? {
        ...scene.content,
        elements: scene.content.elements.map((el) =>
          liveFrames.has(el.id) ? { ...el, frame: liveFrames.get(el.id)! } : el,
        ),
      }
    : scene.content;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center p-12">
        <div
          ref={stageRef}
          className="relative shadow-[var(--shadow-xl)]"
          style={{
            width: size.width * scale,
            height: size.height * scale,
            visibility: scale > 0 ? "visible" : "hidden",
          }}
          onPointerDown={startMarquee}
        >
          <Stage
            content={displayContent}
            theme={theme}
            aspect={aspect}
            fixedScale={scale}
            className="absolute inset-0"
          />

          {/* Interaction layer, in stage-percentage coordinates. */}
          <div className="absolute inset-0">
            {elements.map((element) => (
              <ElementFrame
                key={element.id}
                element={
                  liveFrames?.has(element.id)
                    ? { ...element, frame: liveFrames.get(element.id)! }
                    : element
                }
                selected={selectedIds.includes(element.id)}
                editing={editingId === element.id}
                scale={scale}
                sceneId={scene.id}
                onPointerDown={(e) => startDrag(e, element)}
                onResizeStart={(e, handle) => startResize(e, element, handle)}
                onStartEditing={() => setEditingId(element.id)}
                onStopEditing={() => setEditingId(null)}
              />
            ))}

            <SafeAreaOverlay visible={selectedIds.length > 0 || Boolean(marquee)} />

            {guides.map((g, i) => (
              <div
                key={`${g.axis}-${g.at}-${i}`}
                aria-hidden
                className="pointer-events-none absolute"
                style={
                  g.axis === "x"
                    ? {
                        left: `${g.at}%`,
                        top: 0,
                        bottom: 0,
                        width: 1,
                        background: g.kind === "center" ? "var(--ai)" : "var(--accent)",
                        opacity: 0.9,
                      }
                    : {
                        top: `${g.at}%`,
                        left: 0,
                        right: 0,
                        height: 1,
                        background: g.kind === "center" ? "var(--ai)" : "var(--accent)",
                        opacity: 0.9,
                      }
                }
              />
            ))}

            {marquee && (
              <div
                aria-hidden
                className="border-accent pointer-events-none absolute border bg-[var(--accent)]/10"
                style={{
                  left: `${marquee.x}%`,
                  top: `${marquee.y}%`,
                  width: `${marquee.w}%`,
                  height: `${marquee.h}%`,
                }}
              />
            )}
          </div>

          {elements.length === 0 && <EmptySceneHint sceneId={scene.id} onAskAi={onAskAi} />}
        </div>

        {selected.length > 0 && !editingId && (
          <SelectionToolbar
            sceneId={scene.id}
            selected={selected}
            scale={scale}
            stageRef={stageRef}
          />
        )}
      </div>

      <InsertBar sceneId={scene.id} />
    </div>
  );
}

/** Dashed safe-area guide, shown only while something is being manipulated. */
function SafeAreaOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-[2px] border border-dashed border-[var(--accent)]/35"
      style={{
        left: `${SAFE_MARGIN}%`,
        top: `${SAFE_MARGIN}%`,
        right: `${SAFE_MARGIN}%`,
        bottom: `${SAFE_MARGIN}%`,
      }}
    />
  );
}
