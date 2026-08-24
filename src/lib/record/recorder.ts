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
 *  - The camera is not composited here, and deliberately so. The presenter's
 *    feed is already on the stage, in the tab being captured, where they put
 *    it and at the size they made it. Drawing it a second time put two of the
 *    presenter in the file, overlapping. What you see is what is recorded.
 *  - Burn-in captions *are* composited, because they are the one thing that
 *    exists only in the recording and never on the stage.
 *  - Container support is not universal. Chromium produces WebM; Safari
 *    produces MP4. The recorder asks the browser what it supports rather than
 *    assuming, and reports the real container to the user.
 */

import type { CameraBackground } from "@/lib/media/segmentation";
import { LiveTranscriber, transcriptSupported } from "@/lib/record/transcript";
import { clampCues, type TranscriptCue } from "@/lib/record/transcript-core";

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

/**
 * Preference order: quality first, then compatibility.
 *
 * The profile in an `avc1` string is a request, not decoration, and this list
 * used to lead with `avc1.42E01E` — H.264 **Baseline**, level 3.0. Baseline
 * has no CABAC and no B-frames, and it was being asked to encode a 1440p deck
 * of hard-edged text: the one kind of content that shows the difference. High
 * profile is asked for first now, at descending levels, with Baseline kept as
 * the fallback for an encoder that genuinely has nothing else.
 *
 * MP4 stays ahead of WebM because it is the file a presenter can hand to
 * anyone, and because H.264 is the codec most likely to have a hardware
 * encoder behind it — which matters when the same machine is also segmenting
 * a camera and driving a presentation. A browser without H.264 (Chromium
 * builds without proprietary codecs) falls through to VP9, which is excellent
 * on screen content.
 *
 * `MediaRecorder.isTypeSupported` decides; nothing here is assumed.
 */
const CANDIDATE_TYPES = [
  "video/mp4;codecs=avc1.640033,mp4a.40.2", // High @ 5.1 — 4K
  "video/mp4;codecs=avc1.64002A,mp4a.40.2", // High @ 4.2 — 1440p
  "video/mp4;codecs=avc1.640029,mp4a.40.2", // High @ 4.1 — 1080p60
  "video/mp4;codecs=avc1.640028,mp4a.40.2", // High @ 4.0
  "video/webm;codecs=vp9,opus",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2", // Baseline: last resort, not first choice.
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

/**
 * The best container and codec this browser will actually record.
 *
 * Exported so the preference order can be checked against a stubbed
 * `isTypeSupported` — the order is the whole decision, and it is not visible
 * anywhere in the output until someone plays a soft recording.
 */
export function pickMimeType(
  supported: (type: string) => boolean = (type) => MediaRecorder.isTypeSupported(type),
): string | null {
  return CANDIDATE_TYPES.find((type) => supported(type)) ?? null;
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

  const mimeType = pickMimeType();
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

/**
 * Bitrate for what is actually being encoded.
 *
 * A flat 4 Mbit/s was fine for a 720p webcam and wrong for a deck: screen
 * capture is mostly flat colour with hard-edged text, and text is exactly what
 * a codec spends its bits on when it has them and smears when it does not. At
 * 1440p that budget worked out at under a tenth of a bit per pixel, which is
 * why a sharp presentation came back soft.
 *
 * Scaled by pixels and frame rate instead, with a floor so a small capture is
 * not starved and a ceiling so a 4K screen does not produce a file nobody can
 * upload.
 */
export function videoBitrateFor(stream: MediaStream, fps: number): number {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  return bitrateForFrame(settings?.width ?? 1920, settings?.height ?? 1080, fps);
}

/** The same decision, on plain numbers, so it can be checked without a stream. */
export function bitrateForFrame(width: number, height: number, fps: number): number {
  const perFramePerPixel = 0.14;
  const scaled = width * height * fps * perFramePerPixel;
  return Math.round(Math.min(40_000_000, Math.max(6_000_000, scaled)));
}

/** What `getDisplayMedia` says the presenter actually picked. */
type DisplaySurface = "browser" | "window" | "monitor";

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
  private compositeStream: MediaStream | null = null;
  private rafId: number | null = null;
  /** Which scheduler owns `rafId`, so the right cancel is called. */
  private usingVideoFrameCallback = false;
  private canvas: HTMLCanvasElement | null = null;
  private screenVideo: HTMLVideoElement | null = null;

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
          // `ideal` on a display capture is a *ceiling* the browser scales
          // down to, so 1920 meant a 2560-wide screen was resampled before it
          // ever reached the canvas — which on a deck that is mostly text
          // reads as a blurry recording of a sharp presentation. Ask for more
          // than any current display and take whatever the browser actually
          // has; `settings.width` below then sizes the canvas to match, so
          // nothing is scaled at any point in the pipeline.
          width: { ideal: options.targetWidth ?? 3840 },
          height: { ideal: Math.round((options.targetWidth ?? 3840) * (9 / 16)) },
        },
        // System audio is inconsistent across platforms and easily produces
        // feedback; microphone audio is captured separately and reliably.
        audio: false,
        // Put *this* tab in front of the presenter in the picker, and offer it
        // as the default. Without these two, Chrome opens on a list of every
        // tab that happens to be open and the one they are presenting from is
        // somewhere in it — which is exactly the moment a recording gets
        // pointed at the wrong window. Both are Chromium-only and both are
        // ignored elsewhere, so no capability check is needed.
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        // Nothing here needs the presenter's other windows, and offering them
        // is how a private tab ends up in a published recording.
        systemAudio: "exclude",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
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

    /*
     * Say something if they shared the wrong thing.
     *
     * The browser's picker cannot be chosen for them — Chrome requires the
     * selection, and no flag bypasses it — so `preferCurrentTab` puts this tab
     * in front of them and this catches the case where they picked past it. A
     * whole screen or another window is not merely a worse recording: sharing
     * the screen this tab is on puts the preview inside its own capture, which
     * is the mirrored-tunnel effect, and it captures whatever else is on that
     * screen. Better to hear it in the first second than at the end of a talk.
     */
    const surface = this.screenStream.getVideoTracks()[0]?.getSettings().displaySurface as
      DisplaySurface | undefined;
    if (surface && surface !== "browser") {
      this.onPhaseChange?.(
        "requesting",
        surface === "monitor"
          ? "You shared a whole screen. Everything on it is being recorded, and this tab will appear inside its own preview — stop and choose this tab instead for a clean capture."
          : "You shared a window rather than this tab. Stop and choose this tab if you meant to record the presentation.",
      );
    }

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

    // The camera is deliberately *not* opened here.
    //
    // It used to be: the recorder took its own camera stream and composited it
    // into the canvas, while the presenter's on-stage feed carried on rendering
    // in the tab being captured. Both ended up in the file, so a presenter who
    // could see themselves got two of themselves in the recording, overlapping.
    //
    // The camera on the stage is the camera. It is already in the captured tab,
    // already where the presenter dragged it, already the size they made it and
    // already carrying whatever background treatment they chose — so recording
    // it is a matter of not drawing it a second time. This also halves the work:
    // one segmenter running on one feed rather than two of each, on a machine
    // that is presenting and encoding at the same time.

    this.onPhaseChange?.("ready");
  }

  async start(): Promise<void> {
    if (!this.screenStream || !this.micStream || !this.options || !this.support.mimeType) {
      throw new Error("The recorder isn't ready.");
    }

    const wantsBurnIn = Boolean(this.options.transcribe && this.options.burnInCaptions);
    const stream = wantsBurnIn
      ? await this.buildCompositeStream()
      : new MediaStream([
          ...this.screenStream.getVideoTracks(),
          ...this.micStream.getAudioTracks(),
        ]);

    this.recorder = new MediaRecorder(stream, {
      mimeType: this.support.mimeType,
      videoBitsPerSecond: videoBitrateFor(stream, this.options.frameRate ?? 30),
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
      // True when the presenter had their feed on the stage, which is where
      // the camera in this file came from.
      hasCamera: Boolean(this.options?.camera),
      hasMicrophone: Boolean(this.micStream),
    };

    this.cleanup();
    this.onPhaseChange?.("complete");
    return result;
  }

  /** Releases every device. Safe to call at any point. */
  cleanup(): void {
    if (this.rafId !== null) {
      if (this.usingVideoFrameCallback) this.screenVideo?.cancelVideoFrameCallback?.(this.rafId);
      else cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.usingVideoFrameCallback = false;
    }
    for (const stream of [this.screenStream, this.micStream, this.compositeStream]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    this.screenStream = null;
    this.micStream = null;
    this.compositeStream = null;
    this.screenVideo = null;
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

    /*
     * Composite once per captured frame.
     *
     * This ran on `requestAnimationFrame` with a time check, so a 120Hz laptop
     * woke four times for every frame the encoder took, and on a display
     * slower than the capture rate it missed frames outright. The capture
     * track produces frames; `requestVideoFrameCallback` fires on exactly
     * those, so the copy happens once per frame that exists, no more and no
     * fewer. The timed fallback stays for browsers without it.
     */
    const fps = options.frameRate ?? 30;
    const interval = 1000 / fps;
    let lastDrawn = -Infinity;

    const paint = () => {
      const screen = this.screenVideo;
      if (!screen) return;
      context.drawImage(screen, 0, 0, canvas.width, canvas.height);
      // Captions are drawn last so they sit above the camera if the two meet.
      if (options.transcribe && options.burnInCaptions) {
        const caption = this.transcriber?.displayText() ?? "";
        if (caption) drawCaption(context, canvas, caption);
      }
    };

    const perVideoFrame = typeof this.screenVideo.requestVideoFrameCallback === "function";
    const draw = (now: number) => {
      if (perVideoFrame) {
        this.rafId = this.screenVideo!.requestVideoFrameCallback(draw);
        paint();
        return;
      }
      this.rafId = requestAnimationFrame(draw);
      if (now - lastDrawn < interval) return;
      lastDrawn = now;
      paint();
    };

    this.rafId = perVideoFrame
      ? this.screenVideo.requestVideoFrameCallback(draw)
      : requestAnimationFrame(draw);
    this.usingVideoFrameCallback = perVideoFrame;

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
