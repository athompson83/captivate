"use client";

/**
 * Presentation recorder.
 *
 * What is actually possible in a browser, stated plainly:
 *
 *  - There is no API that records a DOM subtree. The only way to capture what
 *    the audience really sees — including live annotations, video elements and
 *    CSS animation — is `getDisplayMedia`, where the user picks this tab. That
 *    is what Captivate does, and the UI says so rather than implying magic.
 *  - Camera picture-in-picture is a genuine composite: the screen frame and the
 *    camera frame are drawn onto an offscreen canvas each animation frame, and
 *    `canvas.captureStream()` feeds the recorder. The camera is therefore baked
 *    into the resulting file, not overlaid at playback time.
 *  - Container support is not universal. Chromium produces WebM; Safari
 *    produces MP4. The recorder asks the browser what it supports rather than
 *    assuming, and reports the real container to the user.
 */

export type RecorderPhase =
  "idle" | "requesting" | "ready" | "recording" | "paused" | "stopping" | "complete" | "error";

export interface CameraPlacement {
  corner: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Fraction of the output width occupied by the camera inset. */
  size: number;
  shape: "circle" | "rounded";
}

export interface RecorderOptions {
  microphoneId?: string | null;
  cameraId?: string | null;
  camera: boolean;
  placement: CameraPlacement;
  /** Longest edge of the recorded video. */
  targetWidth?: number;
  frameRate?: number;
}

export interface SceneMark {
  sceneId: string | null;
  sceneIndex: number;
  atMs: number;
}

export interface RecorderResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  durationMs: number;
  timeline: SceneMark[];
  hasCamera: boolean;
  hasMicrophone: boolean;
}

/** Preference order: quality first, then compatibility. */
const CANDIDATE_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export interface SupportInfo {
  supported: boolean;
  displayCapture: boolean;
  mimeType: string | null;
  extension: string;
  reason?: string;
}

/**
 * Support, as stable snapshots for `useSyncExternalStore`.
 *
 * Calling `detectSupport()` during render gives one answer on the server and
 * another in the browser, which is a hydration mismatch — the server rendered
 * "recording isn't available" and the client rendered the record button. The
 * capability never changes once the page is running, so the subscribe function
 * is a no-op and the snapshots are cached; `getSnapshot` returning a fresh
 * object each call would spin React forever.
 */
const SERVER_SUPPORT: SupportInfo = {
  supported: false,
  displayCapture: false,
  mimeType: null,
  extension: "webm",
};

let cachedSupport: SupportInfo | null = null;

export const subscribeToSupport = () => () => {};

export function supportSnapshot(): SupportInfo {
  cachedSupport ??= detectSupport();
  return cachedSupport;
}

export function serverSupportSnapshot(): SupportInfo {
  return SERVER_SUPPORT;
}

export function detectSupport(): SupportInfo {
  if (typeof window === "undefined") {
    return { supported: false, displayCapture: false, mimeType: null, extension: "webm" };
  }

  const displayCapture = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const hasRecorder = typeof MediaRecorder !== "undefined";

  if (!hasRecorder) {
    return {
      supported: false,
      displayCapture,
      mimeType: null,
      extension: "webm",
      reason:
        "This browser doesn't support MediaRecorder, so recording isn't available here. Chrome, Edge and Firefox on desktop all do.",
    };
  }

  if (!displayCapture) {
    return {
      supported: false,
      displayCapture: false,
      mimeType: null,
      extension: "webm",
      reason:
        "This browser can't capture the screen, which is how Captivate records the stage. Screen capture isn't available on iOS or iPadOS.",
    };
  }

  const mimeType = CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
  if (!mimeType) {
    return {
      supported: false,
      displayCapture,
      mimeType: null,
      extension: "webm",
      reason: "This browser doesn't offer a video format Captivate can record to.",
    };
  }

  return {
    supported: true,
    displayCapture: true,
    mimeType,
    extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
  };
}

export async function listDevices(): Promise<{
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  labelsAvailable: boolean;
}> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { microphones: [], cameras: [], labelsAvailable: false };
  }
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return {
    microphones: devices.filter((d) => d.kind === "audioinput"),
    cameras: devices.filter((d) => d.kind === "videoinput"),
    // Labels are empty until permission has been granted at least once.
    labelsAvailable: devices.some((d) => d.label !== ""),
  };
}

export class PermissionError extends Error {
  constructor(
    public readonly kind: "screen" | "microphone" | "camera",
    message: string,
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

export class PresentationRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private screenStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private compositeStream: MediaStream | null = null;
  private rafId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private screenVideo: HTMLVideoElement | null = null;
  private cameraVideo: HTMLVideoElement | null = null;

  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt: number | null = null;
  private timeline: SceneMark[] = [];
  private options: RecorderOptions | null = null;
  private support: SupportInfo = detectSupport();

  onPhaseChange?: (phase: RecorderPhase, detail?: string) => void;
  /** Fires when the user stops the share from the browser's own control. */
  onExternalStop?: () => void;

  get cameraPreviewStream(): MediaStream | null {
    return this.cameraStream;
  }

  get mimeType(): string | null {
    return this.support.mimeType;
  }

  get elapsedMs(): number {
    if (!this.startedAt) return 0;
    const pausedNow = this.pausedAt ? Date.now() - this.pausedAt : 0;
    return Date.now() - this.startedAt - this.pausedTotal - pausedNow;
  }

  /**
   * Acquires every stream the user agreed to. Called before recording starts so
   * permission prompts happen while the presenter is still looking at a dialog,
   * not mid-sentence in front of a room.
   */
  async prepare(options: RecorderOptions): Promise<void> {
    this.options = options;
    this.onPhaseChange?.("requesting");

    if (!this.support.supported) {
      throw new Error(this.support.reason ?? "Recording isn't supported in this browser.");
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: options.frameRate ?? 30 },
          width: { ideal: options.targetWidth ?? 1920 },
        },
        // System audio is inconsistent across platforms and easily produces
        // feedback; microphone audio is captured separately and reliably.
        audio: false,
      });
    } catch (error) {
      this.cleanup();
      throw new PermissionError(
        "screen",
        (error as Error).name === "NotAllowedError"
          ? "Screen sharing was declined, so there's nothing to record. Start again and choose this tab."
          : "This browser couldn't start screen capture.",
      );
    }

    // If the user ends the share from the browser's own bar, finish cleanly.
    this.screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      this.onExternalStop?.();
    });

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: options.microphoneId
          ? {
              deviceId: { exact: options.microphoneId },
              echoCancellation: true,
              noiseSuppression: true,
            }
          : { echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      this.cleanup();
      throw new PermissionError(
        "microphone",
        (error as Error).name === "NotAllowedError"
          ? "Microphone access was declined. A recording without narration isn't much use, so nothing was started."
          : "That microphone couldn't be opened.",
      );
    }

    if (options.camera) {
      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: options.cameraId
            ? {
                deviceId: { exact: options.cameraId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        // A missing camera must not cost the presenter their recording; carry
        // on without it and let the caller surface the downgrade.
        this.cameraStream = null;
        this.onPhaseChange?.(
          "ready",
          "The camera couldn't be opened, so this will record screen and microphone only.",
        );
      }
    }

    this.onPhaseChange?.("ready");
  }

  async start(): Promise<void> {
    if (!this.screenStream || !this.micStream || !this.options || !this.support.mimeType) {
      throw new Error("The recorder isn't ready.");
    }

    const stream = this.cameraStream
      ? await this.buildCompositeStream()
      : new MediaStream([
          ...this.screenStream.getVideoTracks(),
          ...this.micStream.getAudioTracks(),
        ]);

    this.recorder = new MediaRecorder(stream, {
      mimeType: this.support.mimeType,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });

    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onerror = () => {
      this.onPhaseChange?.(
        "error",
        "The recorder stopped unexpectedly. Anything captured so far is still available.",
      );
    };

    // A one-second timeslice means a crash costs at most a second of footage
    // rather than the whole session.
    this.recorder.start(1000);
    this.startedAt = Date.now();
    this.pausedTotal = 0;
    this.pausedAt = null;
    this.timeline = [];
    this.onPhaseChange?.("recording");
  }

  markScene(sceneId: string | null, sceneIndex: number): void {
    if (!this.startedAt || this.recorder?.state !== "recording") return;
    const atMs = this.elapsedMs;
    const last = this.timeline[this.timeline.length - 1];
    if (last && last.sceneIndex === sceneIndex) return;
    this.timeline.push({ sceneId, sceneIndex, atMs });
  }

  get canPause(): boolean {
    return (
      typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype.pause === "function"
    );
  }

  pause(): void {
    if (this.recorder?.state !== "recording" || !this.canPause) return;
    this.recorder.pause();
    this.pausedAt = Date.now();
    this.onPhaseChange?.("paused");
  }

  resume(): void {
    if (this.recorder?.state !== "paused") return;
    this.recorder.resume();
    if (this.pausedAt) this.pausedTotal += Date.now() - this.pausedAt;
    this.pausedAt = null;
    this.onPhaseChange?.("recording");
  }

  async stop(): Promise<RecorderResult> {
    if (!this.recorder) throw new Error("Nothing is being recorded.");
    this.onPhaseChange?.("stopping");

    const durationMs = this.elapsedMs;
    const mimeType = this.support.mimeType ?? "video/webm";

    const blob = await new Promise<Blob>((resolve) => {
      const recorder = this.recorder!;
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: mimeType }));
      if (recorder.state !== "inactive") recorder.stop();
      else resolve(new Blob(this.chunks, { type: mimeType }));
    });

    const result: RecorderResult = {
      blob,
      mimeType,
      extension: this.support.extension,
      durationMs,
      timeline: this.timeline,
      hasCamera: Boolean(this.cameraStream),
      hasMicrophone: Boolean(this.micStream),
    };

    this.cleanup();
    this.onPhaseChange?.("complete");
    return result;
  }

  /** Releases every device. Safe to call at any point. */
  cleanup(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const stream of [
      this.screenStream,
      this.micStream,
      this.cameraStream,
      this.compositeStream,
    ]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    this.screenStream = null;
    this.micStream = null;
    this.cameraStream = null;
    this.compositeStream = null;
    this.screenVideo = null;
    this.cameraVideo = null;
    this.canvas = null;
    this.recorder = null;
  }

  /**
   * Draws screen and camera onto one canvas so the camera is genuinely part of
   * the output file. Runs on requestAnimationFrame and stops with the recorder.
   */
  private async buildCompositeStream(): Promise<MediaStream> {
    const options = this.options!;
    const screenTrack = this.screenStream!.getVideoTracks()[0];
    const settings = screenTrack.getSettings();

    const width = settings.width ?? options.targetWidth ?? 1920;
    const height = settings.height ?? Math.round(width * (9 / 16));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    this.canvas = canvas;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser couldn't create the compositing canvas.");

    this.screenVideo = await attachStream(this.screenStream!);
    this.cameraVideo = await attachStream(this.cameraStream!);

    const inset = Math.round(width * options.placement.size);
    const margin = Math.round(width * 0.022);

    // Composite at the rate actually being captured. This ran at the

    // display's rate, so a 120Hz laptop drew a full 1080p frame plus the

    // camera inset four times for every frame the encoder took — while the

    // machine was already presenting and encoding.

    const fps = options.frameRate ?? 30;

    const interval = 1000 / fps;

    let lastDrawn = 0;

    const draw = (now: number) => {
      this.rafId = requestAnimationFrame(draw);

      if (now - lastDrawn < interval) return;

      lastDrawn = now;
      const screen = this.screenVideo;
      const camera = this.cameraVideo;
      if (!screen || !camera) return;

      context.drawImage(screen, 0, 0, canvas.width, canvas.height);

      const camW = inset;
      const camH = Math.round(inset * (camera.videoHeight / camera.videoWidth || 0.5625));
      const x = options.placement.corner.endsWith("right") ? canvas.width - camW - margin : margin;
      const y = options.placement.corner.startsWith("bottom")
        ? canvas.height - camH - margin
        : margin;

      context.save();
      context.beginPath();
      if (options.placement.shape === "circle") {
        const radius = Math.min(camW, camH) / 2;
        context.arc(x + camW / 2, y + camH / 2, radius, 0, Math.PI * 2);
        context.clip();
        // Centre-crop the camera frame into the circle so faces are not squashed.
        const side = Math.min(camera.videoWidth, camera.videoHeight);
        const sx = (camera.videoWidth - side) / 2;
        const sy = (camera.videoHeight - side) / 2;
        context.drawImage(
          camera,
          sx,
          sy,
          side,
          side,
          x + camW / 2 - radius,
          y + camH / 2 - radius,
          radius * 2,
          radius * 2,
        );
      } else {
        const radius = Math.round(camW * 0.06);
        roundedRect(context, x, y, camW, camH, radius);
        context.clip();
        context.drawImage(camera, x, y, camW, camH);
      }
      context.restore();

      // A hairline keeps the inset legible against a light slide.
      context.save();
      context.strokeStyle = "rgba(255,255,255,0.35)";
      context.lineWidth = Math.max(2, width * 0.0015);
      if (options.placement.shape === "circle") {
        context.beginPath();
        context.arc(x + camW / 2, y + camH / 2, Math.min(camW, camH) / 2, 0, Math.PI * 2);
        context.stroke();
      } else {
        roundedRect(context, x, y, camW, camH, Math.round(camW * 0.06));
        context.stroke();
      }
      context.restore();
    };

    this.rafId = requestAnimationFrame(draw);

    const canvasStream = canvas.captureStream(fps);
    for (const track of this.micStream!.getAudioTracks()) canvasStream.addTrack(track);
    this.compositeStream = canvasStream;
    return canvasStream;
  }
}

async function attachStream(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  // Wait for real dimensions; drawing a zero-sized frame produces a black video.
  if (!video.videoWidth) {
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 1500);
    });
  }
  return video;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

/** Immediate local download — the recording is safe before any upload runs. */
export function downloadRecording(result: RecorderResult, title: string): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitiseFilename(title)}.${result.extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function sanitiseFilename(name: string): string {
  return (
    name
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "captivate-recording"
  );
}
