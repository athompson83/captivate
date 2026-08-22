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
  presentationId,
  settings,
  onChange,
  interactive,
}: {
  presentationId: string;
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
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
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
    let raf = 0;
    let alive = true;
    let lastDrawn = 0;

    void sharedPersonSegmenter().then((segmenter) => {
      if (!alive) return;
      // Without a segmenter the raw feed simply stays visible.
      if (!segmenter) return;
      setSegmenting(true);

      const draw = (now: number) => {
        raf = requestAnimationFrame(draw);
        // 24fps is plenty for an inset and keeps the main thread honest while
        // the world is also flying a camera.
        if (now - lastDrawn < 1000 / 24) return;
        lastDrawn = now;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const background = settingsRef.current.background;
        if (!video || !canvas || !video.videoWidth || background === "none") return;

        const frame = segmenter.render(video, now, background);
        const source = frame ?? video;
        const w = frame ? frame.width : video.videoWidth;
        const h = frame ? frame.height : video.videoHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(source, 0, 0, w, h);
      };
      raf = requestAnimationFrame(draw);
    });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
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
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    if (drag.mode === "move") {
      onChange({
        ...drag.origin,
        x: clamp(drag.origin.x + dx, 0.04, 0.96),
        y: clamp(drag.origin.y + dy, 0.05, 0.95),
      });
    } else {
      onChange({ ...drag.origin, size: clamp(drag.origin.size + dx, 0.08, 0.5) });
    }
  };

  const endDrag = () => {
    if (dragState.current) {
      dragState.current = null;
      saveCameraFeedSettings(presentationId, settingsRef.current);
    }
  };

  if (!settings.enabled) return null;

  const transparent = settings.background === "remove" && segmenting;
  const showCanvas = settings.background !== "none" && segmenting;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Presenter camera"
      className={cn(
        "absolute z-30 select-none",
        interactive && "cursor-grab active:cursor-grabbing",
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
        aspectRatio: settings.shape === "circle" ? "1 / 1" : "16 / 10",
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
        <div
          aria-hidden
          onPointerDown={(e) => beginDrag(e, "resize")}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute -right-1.5 -bottom-1.5 size-5 cursor-nwse-resize rounded-full border border-white/40 bg-black/50 opacity-0 transition-opacity hover:opacity-100"
        />
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
