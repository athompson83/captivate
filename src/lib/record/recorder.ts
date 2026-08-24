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

import { sharedPersonSegmenter, type CameraBackground, type PersonSegmenter } from "@/lib/media/segmentation";
import {
  LiveTranscriber,
  clampCues,
  transcriptSupported,
  type TranscriptCue,
} from "@/lib/record/transcript";

export type RecorderPhase =
  "idle" | "requesting" | "ready" | "recording" | "paused" | "stopping" | "complete" | "error";

export interface CameraPlacement {
  corner: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Fraction of the output width occupied by the camera inset. */
  size: number;
  /** `cutout` draws the presenter alone, no frame — background removal only. */
  shape: "circle" | "rounded" | "cutout";
}

export interface RecorderOptions {
  microphoneId?: string | null;
  cameraId?: string | null;
  camera: boolean;
  /** Background treatment for the camera inset; runs entirely on-device. */
  cameraBackground?: CameraBackground;
  /** Generate a transcript from the microphone while recording. */
  transcribe?: boolean;
  /** Draw live captions into the video itself. Requires `transcribe`. */
  burnInCaptions?: boolean;
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
  transcript: TranscriptCue[];
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

  private segmenter: PersonSegmenter | null = null;
  private transcriber: LiveTranscriber | null = null;

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

      if (this.cameraStream && options.cameraBackground && options.cameraBackground !== "none") {
        this.segmenter = await sharedPersonSegmenter();
        if (!this.segmenter) {
          this.onPhaseChange?.(
            "ready",
            "Background removal isn't available in this browser, so the camera records as-is.",
          );
        }
      }
    }

    this.onPhaseChange?.("ready");
  }

  async start(): Promise<void> {
    if (!this.screenStream || !this.micStream || !this.options || !this.support.mimeType) {
      throw new Error("The recorder isn't ready.");
    }

    const wantsBurnIn = Boolean(this.options.transcribe && this.options.burnInCaptions);
    const stream =
      this.cameraStream || wantsBurnIn
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

    if (this.options.transcribe && transcriptSupported()) {
      this.transcriber = new LiveTranscriber();
      const started = this.transcriber.start(() => this.elapsedMs, {
        // The same track the recording captures, so the transcript hears the
        // microphone the presenter chose, not the system default.
        audioTrack: this.micStream.getAudioTracks()[0] ?? null,
      });
      if (!started) this.transcriber = null;
    }

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
    this.transcriber?.suspend();
    this.onPhaseChange?.("paused");
  }

  resume(): void {
    if (this.recorder?.state !== "paused") return;
    this.recorder.resume();
    if (this.pausedAt) this.pausedTotal += Date.now() - this.pausedAt;
    this.pausedAt = null;
    this.transcriber?.resume();
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

    // The transcriber listens through the encoder's finalisation, because the
    // last words of the take are still in flight then — and they are audible
    // in the file. The clamp is what guarantees no cue outlives the video:
    // a result stamped during the wait is trimmed to `durationMs`, not kept
    // past it and not thrown away.
    const transcript = clampCues((await this.transcriber?.stop()) ?? [], durationMs);
    this.transcriber = null;

    const result: RecorderResult = {
      blob,
      mimeType,
      extension: this.support.extension,
      durationMs,
      timeline: this.timeline,
      transcript,
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
    // Fire-and-forget: cleanup is the abandon path, and the cues are unwanted.
    void this.transcriber?.stop();
    this.transcriber = null;
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
    this.cameraVideo = this.cameraStream ? await attachStream(this.cameraStream) : null;

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
      if (!screen) return;

      context.drawImage(screen, 0, 0, canvas.width, canvas.height);

      if (camera) this.drawCameraInset(context, canvas, camera, options, inset, margin, width, now);

      // Captions are drawn last so they sit above the camera if the two meet.
      if (options.transcribe && options.burnInCaptions) {
        const caption = this.transcriber?.displayText() ?? "";
        if (caption) drawCaption(context, canvas, caption);
      }
    };

    this.rafId = requestAnimationFrame(draw);

    const canvasStream = canvas.captureStream(fps);
    for (const track of this.micStream!.getAudioTracks()) canvasStream.addTrack(track);
    this.compositeStream = canvasStream;
    return canvasStream;
  }

  /** The camera inset, with its background treated per-frame, on-device. */
  private drawCameraInset(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camera: HTMLVideoElement,
    options: RecorderOptions,
    inset: number,
    margin: number,
    width: number,
    now: number,
  ): void {
    {
      // Background treatment happens per-frame, on-device. When the segmenter
      // has no answer for a frame (warm-up, a hiccup) the raw camera is drawn —
      // a flickering feed is worse than one frame of background.
      const background = options.cameraBackground ?? "none";
      const treated =
        background !== "none" && this.segmenter ? this.segmenter.render(camera, now, background) : null;
      const source: CanvasImageSource = treated ?? camera;
      const srcW = treated ? treated.width : camera.videoWidth;
      const srcH = treated ? treated.height : camera.videoHeight;
      const transparent = background === "remove" && treated !== null;

      const camW = inset;
      const camH = Math.round(inset * (srcH / srcW || 0.5625));
      const x = options.placement.corner.endsWith("right") ? canvas.width - camW - margin : margin;
      const y = options.placement.corner.startsWith("bottom")
        ? canvas.height - camH - margin
        : margin;

      const shape = options.placement.shape;
      if (shape === "cutout") {
        // The presenter alone, floating over the stage. Without a working
        // segmenter this falls back to a rounded card rather than stamping a
        // rectangle of wall over the slide.
        if (transparent) {
          context.drawImage(source, x, y, camW, camH);
        } else {
          context.save();
          roundedRect(context, x, y, camW, camH, Math.round(camW * 0.06));
          context.clip();
          context.drawImage(source, x, y, camW, camH);
          context.restore();
        }
      } else {
        context.save();
        context.beginPath();
        if (shape === "circle") {
          const radius = Math.min(camW, camH) / 2;
          context.arc(x + camW / 2, y + camH / 2, radius, 0, Math.PI * 2);
          context.clip();
          // Centre-crop the camera frame into the circle so faces are not squashed.
          const side = Math.min(srcW, srcH);
          const sx = (srcW - side) / 2;
          const sy = (srcH - side) / 2;
          context.drawImage(
            source,
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
          context.drawImage(source, x, y, camW, camH);
        }
        context.restore();

        // A hairline keeps the inset legible against a light slide — except a
        // transparent cut-out, where it would outline empty air.
        if (!transparent) {
          context.save();
          context.strokeStyle = "rgba(255,255,255,0.35)";
          context.lineWidth = Math.max(2, width * 0.0015);
          if (shape === "circle") {
            context.beginPath();
            context.arc(x + camW / 2, y + camH / 2, Math.min(camW, camH) / 2, 0, Math.PI * 2);
            context.stroke();
          } else {
            roundedRect(context, x, y, camW, camH, Math.round(camW * 0.06));
            context.stroke();
          }
          context.restore();
        }
      }
    }
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

/**
 * Live captions, drawn into the frame itself.
 *
 * Standard subtitle conventions: bottom-centred, at most two lines, white on a
 * soft dark plate so they read over any slide. The text is what is being said
 * right now — interim recognition included — because captions that lag the
 * voice by a sentence are worse than none.
 */
function drawCaption(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  text: string,
): void {
  const fontSize = Math.max(18, Math.round(canvas.height * 0.042));
  context.save();
  context.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Wrap onto at most two lines that fit inside 80% of the frame.
  const maxWidth = canvas.width * 0.8;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  // Keep the newest words: trailing lines are the live ones.
  const shown = lines.slice(-2);

  const lineHeight = Math.round(fontSize * 1.35);
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.35);
  const bottom = canvas.height - Math.round(canvas.height * 0.045);

  shown.forEach((entry, i) => {
    const y = bottom - (shown.length - 1 - i) * lineHeight - lineHeight / 2;
    const textWidth = context.measureText(entry).width;
    context.fillStyle = "rgba(10, 10, 12, 0.68)";
    const w = textWidth + padX * 2;
    const h = lineHeight + padY * 0.4;
    roundedRect(context, canvas.width / 2 - w / 2, y - h / 2, w, h, Math.round(h / 4));
    context.fill();
    context.fillStyle = "rgba(255,255,255,0.96)";
    context.fillText(entry, canvas.width / 2, y + fontSize * 0.05);
  });
  context.restore();
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
