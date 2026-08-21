"use client";

import { memo, useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PresenterTool, SceneAnnotations, Stroke } from "@/lib/present/protocol";

/**
 * Presentation annotations.
 *
 * Everything here is an overlay in normalised 0..1 coordinates. Nothing touches
 * the scene document, so a laser sweep or a highlight during a lecture can
 * never modify the saved presentation — the annotations live for the session
 * and are cleared with one key.
 *
 * Normalised coordinates also mean the presenter can draw on a small preview
 * pad in the console and it lands in the right place on a 4K projector.
 */

export interface AnnotationLayerProps {
  annotations: SceneAnnotations;
  tool: PresenterTool;
  color: string;
  width: number;
  /** When false the layer renders but does not accept pointer input. */
  interactive: boolean;
  onChange?: (annotations: SceneAnnotations) => void;
  onPointer?: (point: { x: number; y: number } | null) => void;
  /** Remote pointer position for the laser, if any. */
  pointer?: { x: number; y: number } | null;
  pointerColor?: string;
  showLaser?: boolean;
}

export const AnnotationLayer = memo(function AnnotationLayer({
  annotations,
  tool,
  color,
  width,
  interactive,
  onChange,
  onPointer,
  pointer,
  pointerColor = "#F0B858",
  showLaser = true,
}: AnnotationLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  const eraseAt = useCallback(
    (point: { x: number; y: number }) => {
      if (!onChange) return;
      const tolerance = 0.02;
      const strokes = annotations.strokes.filter(
        (s) => !s.points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < tolerance),
      );
      const highlights = annotations.highlights.filter(
        (h) => !(point.x >= h.x && point.x <= h.x + h.w && point.y >= h.y && point.y <= h.y + h.h),
      );
      if (
        strokes.length !== annotations.strokes.length ||
        highlights.length !== annotations.highlights.length
      ) {
        onChange({ strokes, highlights });
      }
    },
    [annotations, onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!interactive || tool === "none") return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const point = toLocal(e);

      if (tool === "laser") {
        onPointer?.(point);
        return;
      }
      if (tool === "draw") {
        setDraft({ id: crypto.randomUUID().slice(0, 12), color, width, points: [point] });
        return;
      }
      if (tool === "highlight") {
        dragStart.current = point;
        setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 });
        return;
      }
      if (tool === "erase") {
        eraseAt(point);
      }
    },
    [color, eraseAt, interactive, onPointer, toLocal, tool, width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!interactive) return;
      const point = toLocal(e);

      if (tool === "laser") {
        // The laser follows the pointer whether or not a button is held, which
        // is what makes it feel like a physical pointer rather than a drag.
        onPointer?.(point);
        return;
      }
      if (e.buttons !== 1) return;

      if (tool === "draw" && draft) {
        const last = draft.points[draft.points.length - 1];
        // Skip sub-pixel moves; a 4000-point cap is plenty for a real sketch.
        if (Math.hypot(point.x - last.x, point.y - last.y) < 0.002) return;
        setDraft({ ...draft, points: [...draft.points, point] });
        return;
      }
      if (tool === "highlight" && dragStart.current) {
        const start = dragStart.current;
        setDraftRect({
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          w: Math.abs(point.x - start.x),
          h: Math.abs(point.y - start.y),
        });
        return;
      }
      if (tool === "erase") eraseAt(point);
    },
    [draft, eraseAt, interactive, onPointer, toLocal, tool],
  );

  const onPointerUp = useCallback(() => {
    if (!interactive) return;

    if (tool === "draw" && draft) {
      if (draft.points.length > 1 && onChange) {
        onChange({ ...annotations, strokes: [...annotations.strokes, draft] });
      }
      setDraft(null);
      return;
    }

    if (tool === "highlight" && draftRect) {
      // Ignore accidental taps; a highlight needs real area to be meaningful.
      if (draftRect.w > 0.01 && draftRect.h > 0.005 && onChange) {
        onChange({
          ...annotations,
          highlights: [
            ...annotations.highlights,
            { id: crypto.randomUUID().slice(0, 12), ...draftRect },
          ],
        });
      }
      setDraftRect(null);
      dragStart.current = null;
      return;
    }

    if (tool === "laser") onPointer?.(null);
  }, [annotations, draft, draftRect, interactive, onChange, onPointer, tool]);

  const cursor =
    !interactive || tool === "none"
      ? "default"
      : tool === "laser"
        ? "none"
        : tool === "erase"
          ? "cell"
          : "crosshair";

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: interactive && tool !== "none" ? "auto" : "none", cursor }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (tool === "laser") onPointer?.(null);
        }}
        aria-hidden
      >
        {/* Highlights sit under ink so a scribble on top stays readable. */}
        {annotations.highlights.map((h) => (
          <HighlightRect key={h.id} rect={h} />
        ))}
        {draftRect && <HighlightRect rect={draftRect} draft />}

        {annotations.strokes.map((stroke) => (
          <StrokePath key={stroke.id} stroke={stroke} />
        ))}
        {draft && <StrokePath stroke={draft} />}
      </svg>

      {showLaser && <Laser point={pointer ?? null} color={pointerColor} />}
    </div>
  );
});

function HighlightRect({
  rect,
  draft,
}: {
  rect: { x: number; y: number; w: number; h: number };
  draft?: boolean;
}) {
  return (
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      rx={0.004}
      fill="rgba(240, 184, 88, 0.26)"
      stroke="rgba(240, 184, 88, 0.85)"
      strokeWidth={draft ? 0.0018 : 0.0012}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function StrokePath({ stroke }: { stroke: Stroke }) {
  if (stroke.points.length < 2) {
    const [p] = stroke.points;
    return p ? <circle cx={p.x} cy={p.y} r={stroke.width * 0.003} fill={stroke.color} /> : null;
  }

  // Quadratic smoothing through midpoints keeps freehand ink from looking like
  // a polyline without needing a curve-fitting library.
  let d = `M ${stroke.points[0].x} ${stroke.points[0].y}`;
  for (let i = 1; i < stroke.points.length - 1; i += 1) {
    const current = stroke.points[i];
    const nextPoint = stroke.points[i + 1];
    d += ` Q ${current.x} ${current.y} ${(current.x + nextPoint.x) / 2} ${(current.y + nextPoint.y) / 2}`;
  }
  const last = stroke.points[stroke.points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return (
    <path
      d={d}
      fill="none"
      stroke={stroke.color}
      strokeWidth={stroke.width * 0.006}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      style={{ strokeWidth: `${stroke.width * 3}px` }}
    />
  );
}

/**
 * The laser. A soft glow with a bright core, which reads clearly on a projector
 * where a small hard dot would disappear.
 */
function Laser({ point, color }: { point: { x: number; y: number } | null; color: string }) {
  return (
    <AnimatePresence>
      {point && (
        <motion.span
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.7 }}
          transition={{ duration: 0.12 }}
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: `${point.x * 100}%`,
            top: `${point.y * 100}%`,
            transform: "translate(-50%, -50%)",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${color} 0%, ${color}cc 22%, ${color}44 46%, transparent 70%)`,
            boxShadow: `0 0 24px 6px ${color}66`,
          }}
        />
      )}
    </AnimatePresence>
  );
}
