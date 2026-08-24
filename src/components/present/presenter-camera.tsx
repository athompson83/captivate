"use client";

import { useEffect, useRef, useState } from "react";
import { sharedPersonSegmenter, type CameraBackground } from "@/lib/media/segmentation";
import { cn } from "@/lib/utils/cn";

/**
 * The presenter, on the stage.
 *
 * A camera feed the presenter can place anywhere over the world while
 * presenting: dragged with a pointer, resized from its corner, background
 * removed on-device so only the person floats over the argument. The stream
 * never leaves this window — MediaStreams cannot cross a BroadcastChannel, so
 * the feed exists exactly where the camera is: the stage the audience sees.
 *
 * Settings persist per presentation, because where the presenter stands is a
 * property of the deck's layout, not of the browser.
 */

export interface CameraFeedSettings {
  enabled: boolean;
  background: CameraBackground;
  /** Centre of the feed, as fractions of the stage. */
  x: number;
  y: number;
  /** Width as a fraction of the stage width. */
  size: number;
  shape: "circle" | "rounded" | "cutout";
}

export const DEFAULT_CAMERA_FEED: CameraFeedSettings = {
  enabled: false,
  background: "remove",
  x: 0.86,
  y: 0.82,
  size: 0.2,
  shape: "cutout",
};

/** The feed may not shrink past illegible, nor grow into the argument. */
export const MIN_CAMERA_SIZE = 0.08;
export const MAX_CAMERA_SIZE = 0.5;

/** Width over height of the feed box. Circles are square; the rest match the
 *  16:9 a camera actually delivers, so `object-cover` has nothing to crop. */
export function cameraAspect(shape: CameraFeedSettings["shape"]): number {
  return shape === "circle" ? 1 : 16 / 9;
}

/**
 * Keeps the whole feed on the stage.
 *
 * `x` and `y` are the feed's *centre*, so clamping them to a fixed margin let
 * half the presenter hang off the edge — worse at large sizes, which is
 * exactly when someone drags to a corner. The margin has to be half the box,
 * and the box's height depends on the stage's own proportions because its
 * width is a fraction of the stage while its aspect is its own.
 */
export function clampPlacement(
  next: { x: number; y: number; size: number },
  stage: { width: number; height: number },
  aspect: number,
): { x: number; y: number; size: number } {
  const size = clamp(next.size, MIN_CAMERA_SIZE, MAX_CAMERA_SIZE);
  const halfWidth = size / 2;
  const halfHeight =
    stage.height > 0 ? (size * stage.width) / aspect / stage.height / 2 : halfWidth;
  return {
    size,
    x: clamp(next.x, halfWidth, 1 - halfWidth),
    // A box taller than the stage has no legal band; centre it rather than
    // pinning it to whichever edge the clamp happens to fall through to.
    y: halfHeight >= 0.5 ? 0.5 : clamp(next.y, halfHeight, 1 - halfHeight),
  };
}

/**
 * The size that puts the feed's bottom-right corner under the pointer.
 *
 * Absolute rather than delta-based: at a corner handle the corner should
 * follow the finger. The previous version added only the horizontal component
 * of the drag, so dragging the handle straight down did nothing at all.
 */
export function sizeFromCorner(
  pointer: { x: number; y: number },
  centre: { x: number; y: number },
  stage: { width: number; height: number },
  aspect: number,
): number {
  const fromWidth = (2 * (pointer.x - centre.x)) / Math.max(1, stage.width);
  const fromHeight =
    ((2 * (pointer.y - centre.y)) / Math.max(1, stage.height)) *
    ((stage.height * aspect) / Math.max(1, stage.width));
  return clamp(Math.max(fromWidth, fromHeight), MIN_CAMERA_SIZE, MAX_CAMERA_SIZE);
}

const storageKey = (presentationId: string) => `captivate:camera-feed:${presentationId}`;

export function loadCameraFeedSettings(presentationId: string): CameraFeedSettings {
  try {
    const raw = localStorage.getItem(storageKey(presentationId));
    if (!raw) return DEFAULT_CAMERA_FEED;
    const parsed = JSON.parse(raw) as Partial<CameraFeedSettings>;
    return {
      ...DEFAULT_CAMERA_FEED,
      ...parsed,
      // Never auto-open a camera on page load; presence is a live decision.
      enabled: false,
    };
  } catch {
    return DEFAULT_CAMERA_FEED;
  }
}

export function saveCameraFeedSettings(presentationId: string, settings: CameraFeedSettings): void {
  try {
    localStorage.setItem(storageKey(presentationId), JSON.stringify(settings));
  } catch {
    // Storage full or blocked; the feed still works for this session.
  }
}

export function PresenterCameraFeed({
  settings,
  onChange,
  interactive,
}: {
  settings: CameraFeedSettings;
  onChange: (next: CameraFeedSettings) => void;
  interactive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  /* Open and close the camera with the toggle. */
  useEffect(() => {
    if (!settings.enabled) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;

    navigator.mediaDevices
      ?.getUserMedia({
        // The stage feed is what the recording contains now, and the stage is
        // captured at up to the display's full resolution — a 720p source
        // scaled up into that is soft in a way it never was as a small inset.
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = media;
        setStream(media);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Camera unavailable");
      });

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [settings.enabled]);

  /* Feed the hidden video element. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [stream]);

  /* Segmentation loop. Runs only while the feed wants a treated background. */
  useEffect(() => {
    if (!settings.enabled || settings.background === "none" || !stream) return;
    let handle = 0;
    let alive = true;
    let usingVideoFrames = false;

    void sharedPersonSegmenter().then((segmenter) => {
      if (!alive) return;
      // Without a segmenter the raw feed simply stays visible.
      if (!segmenter) return;
      setSegmenting(true);

      const draw = (now: number) => {
        schedule();

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const background = settingsRef.current.background;
        if (!video || !canvas || !video.videoWidth || background === "none") return;

        const frame = segmenter.render(video, now, background);
        if (!frame) {
          // The segmenter has stopped — either this one frame failed or the
          // machine could not keep up at any rate. Either way the raw feed
          // underneath is already visible, and if it has given up for good
          // there is no reason to keep asking.
          if (segmenter.health().givenUp) {
            setSegmenting(false);
            alive = false;
          }
          return;
        }
        const w = frame.width;
        const h = frame.height;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(frame, 0, 0, w, h);
      };

      /*
       * Once per decoded video frame, not once per display refresh.
       *
       * `requestAnimationFrame` fires at the display's rate, which on a 60Hz
       * screen with a 30fps camera means half the callbacks carry a frame the
       * segmenter has already seen — paid for twice — while a 120Hz screen
       * pays four times. `requestVideoFrameCallback` fires exactly when a new
       * frame reaches the compositor, so the model runs once per frame that
       * exists, and stops entirely when the tab is hidden. Chromium and Safari
       * have it; anything else falls back to the old loop, where the
       * segmenter's own rate limit still holds the cost down.
       */
      const schedule = () => {
        if (!alive) return;
        const video = videoRef.current;
        if (usingVideoFrames && video) {
          handle = video.requestVideoFrameCallback((now) => draw(now));
        } else {
          handle = requestAnimationFrame(draw);
        }
      };

      usingVideoFrames = typeof videoRef.current?.requestVideoFrameCallback === "function";
      schedule();
    });

    // Captured now rather than read in the cleanup: by the time this runs the
    // ref may already point at a different element, or none.
    const video = videoRef.current;
    return () => {
      alive = false;
      if (usingVideoFrames) video?.cancelVideoFrameCallback?.(handle);
      else cancelAnimationFrame(handle);
      setSegmenting(false);
    };
  }, [settings.enabled, settings.background, stream]);

  /* Dragging and resizing, in stage fractions so it survives any resize. */
  const dragState = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: CameraFeedSettings;
  } | null>(null);

  const beginDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: settingsRef.current,
    };
  };

  const onDrag = (e: React.PointerEvent) => {
    const drag = dragState.current;
    const host = containerRef.current?.parentElement;
    if (!drag || !host) return;
    const rect = host.getBoundingClientRect();
    const stage = { width: rect.width, height: rect.height };
    const aspect = cameraAspect(drag.origin.shape);

    if (drag.mode === "move") {
      const dx = (e.clientX - drag.startX) / rect.width;
      const dy = (e.clientY - drag.startY) / rect.height;
      onChange({
        ...drag.origin,
        ...clampPlacement(
          { x: drag.origin.x + dx, y: drag.origin.y + dy, size: drag.origin.size },
          stage,
          aspect,
        ),
      });
      return;
    }

    const size = sizeFromCorner(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      { x: drag.origin.x * rect.width, y: drag.origin.y * rect.height },
      stage,
      aspect,
    );
    // Growing next to an edge would otherwise push the feed off the stage.
    onChange({ ...drag.origin, ...clampPlacement({ ...drag.origin, size }, stage, aspect) });
  };

  /**
   * Arrow keys move the feed, shift with them resizes it. The pointer handles
   * are the discoverable path; this is the one that works without a mouse, and
   * without it the only focusable thing here would be a handle that could not
   * be used.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive) return;
    const host = containerRef.current?.parentElement;
    if (!host) return;
    const step = e.altKey ? 0.005 : 0.02;
    const current = settingsRef.current;
    let next = { x: current.x, y: current.y, size: current.size };
    switch (e.key) {
      case "ArrowLeft":
        next = e.shiftKey ? { ...next, size: next.size - step } : { ...next, x: next.x - step };
        break;
      case "ArrowRight":
        next = e.shiftKey ? { ...next, size: next.size + step } : { ...next, x: next.x + step };
        break;
      case "ArrowUp":
        next = e.shiftKey ? { ...next, size: next.size + step } : { ...next, y: next.y - step };
        break;
      case "ArrowDown":
        next = e.shiftKey ? { ...next, size: next.size - step } : { ...next, y: next.y + step };
        break;
      default:
        return;
    }
    e.preventDefault();
    // Arrow keys advance the presentation; a camera being placed must not also
    // move the argument under it.
    e.stopPropagation();
    const rect = host.getBoundingClientRect();
    onChange({
      ...current,
      ...clampPlacement(
        next,
        { width: rect.width, height: rect.height },
        cameraAspect(current.shape),
      ),
    });
  };

  const endDrag = () => {
    // Persistence happens in the parent's onChange on every move; a second
    // write here read `settingsRef` before its effect had caught up and could
    // put the pre-drag position back over the one just saved.
    dragState.current = null;
  };

  if (!settings.enabled) return null;

  const transparent = settings.background === "remove" && segmenting;
  const showCanvas = settings.background !== "none" && segmenting;

  return (
    <div
      ref={containerRef}
      role={interactive ? "group" : "img"}
      aria-label={
        interactive
          ? "Presenter camera. Drag to move, drag the corner to resize. Arrow keys move it; hold shift to resize."
          : "Presenter camera"
      }
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "group/camera absolute z-30 select-none",
        interactive &&
          "cursor-grab focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none active:cursor-grabbing",
        settings.shape === "circle" && "overflow-hidden rounded-full",
        settings.shape === "rounded" && "overflow-hidden rounded-[calc(1.2vw+6px)]",
        !transparent &&
          settings.shape !== "cutout" &&
          "shadow-[0_12px_48px_rgba(0,0,0,0.45)] ring-1 ring-white/25",
      )}
      style={{
        left: `${settings.x * 100}%`,
        top: `${settings.y * 100}%`,
        width: `${settings.size * 100}%`,
        transform: "translate(-50%, -50%)",
        aspectRatio: settings.shape === "circle" ? "1 / 1" : "16 / 9",
        touchAction: "none",
      }}
      onPointerDown={(e) => beginDrag(e, "move")}
      onPointerMove={onDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => e.stopPropagation()}
    >
      {error ? (
        <div className="grid h-full w-full place-items-center rounded-[inherit] bg-black/70 px-3 text-center text-[12px] text-white/80">
          {error}
        </div>
      ) : (
        <>
          {/* The raw feed underlies the canvas until segmentation is live, so
              enabling the camera never flashes an empty box. */}
          <video
            ref={videoRef}
            muted
            playsInline
            className={cn(
              "h-full w-full rounded-[inherit] object-cover",
              showCanvas && "invisible",
            )}
          />
          {settings.background !== "none" && (
            <canvas
              ref={canvasRef}
              className={cn(
                "absolute inset-0 h-full w-full rounded-[inherit]",
                settings.shape !== "cutout" && "object-cover",
                !showCanvas && "invisible",
              )}
            />
          )}
        </>
      )}

      {interactive && (
        /*
         * The handle used to be transparent until the pointer was already on
         * it, which is a feature nobody can find: you had to guess that a
         * 20px target existed outside the bottom-right corner. It now sits at
         * a low but real opacity whenever the feed can be moved, and comes up
         * fully the moment the feed is hovered or focused — the whole feed is
         * the discovery surface, not the handle.
         */
        <button
          type="button"
          aria-label="Resize presenter camera"
          title="Drag to resize"
          onPointerDown={(e) => beginDrag(e, "resize")}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="absolute -right-2 -bottom-2 grid size-6 cursor-nwse-resize place-items-center rounded-full border border-white/50 bg-black/65 opacity-40 shadow-lg transition-opacity group-focus-within/camera:opacity-100 group-hover/camera:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:outline-none"
        >
          <svg viewBox="0 0 10 10" className="size-3 fill-white/90" aria-hidden>
            {/* Three pips on the diagonal: the universal "drag me" corner. */}
            <circle cx="8.5" cy="8.5" r="1" />
            <circle cx="5" cy="8.5" r="1" />
            <circle cx="8.5" cy="5" r="1" />
          </svg>
        </button>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
