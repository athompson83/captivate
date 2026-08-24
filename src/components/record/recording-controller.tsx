"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Captions,
  Circle,
  Download,
  Loader2,
  Mic,
  Pause,
  Play,
  Square,
  Video,
} from "lucide-react";
import {
  PermissionError,
  PresentationRecorder,
  serverSupportSnapshot,
  subscribeToSupport,
  supportSnapshot,
  downloadRecording,
  listDevices,
  sanitiseFilename,
  type CameraPlacement,
  type RecorderPhase,
  type RecorderResult,
} from "@/lib/record/recorder";
import type { CameraBackground } from "@/lib/media/segmentation";
import type { CameraFeedSettings } from "@/components/present/presenter-camera";
import { toWebVTT, transcriptSupported } from "@/lib/record/transcript";
import { createRecording, finaliseRecording } from "@/lib/data/recordings";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import type { PresentChannel } from "@/lib/present/protocol";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatBytes } from "@/lib/utils/format";

/**
 * Recording control for the stage window.
 *
 * The whole design principle here is that a recording is never lost. The blob
 * exists locally the instant capture stops; the user is offered the download
 * immediately, and the upload happens afterwards. If the upload fails the
 * recording is marked `local_only` and the UI says exactly that, instead of
 * showing a library entry that plays nothing.
 */
/** Which size preset a freely-dragged feed is closest to. */
function nearestSize(size: number): string {
  const options = ["0.13", "0.2", "0.3"];
  return options.reduce((best, option) =>
    Math.abs(Number(option) - size) < Math.abs(Number(best) - size) ? option : best,
  );
}

export function RecordingController({
  presentationId,
  presentationTitle,
  currentSceneIndex,
  currentSceneId,
  channel,
  cameraFeed,
  onCameraFeedChange,
}: {
  presentationId: string;
  presentationTitle: string;
  currentSceneIndex: number;
  currentSceneId: string | null;
  channel: PresentChannel | null;
  /**
   * The camera on the stage — the same one the recording will contain.
   *
   * The recorder no longer opens a camera of its own. Turning the camera on
   * here turns on the feed the presenter can see and drag, and that feed is
   * what the tab capture records. Two cameras is how a presenter ended up in
   * their own recording twice.
   */
  cameraFeed: CameraFeedSettings;
  onCameraFeedChange: (next: CameraFeedSettings) => void;
}) {
  const { toast } = useToast();
  const recorderRef = useRef<PresentationRecorder | null>(null);
  const support = useSyncExternalStore(subscribeToSupport, supportSnapshot, serverSupportSnapshot);
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [setupOpen, setSetupOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RecorderResult | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [canPause, setCanPause] = useState(false);

  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [cameraId, setCameraId] = useState<string>("");
  // Reads and writes the stage feed rather than a second set of settings: the
  // camera the presenter sees is the camera that gets recorded.
  const useCamera = cameraFeed.enabled;
  const setUseCamera = (enabled: boolean) => onCameraFeedChange({ ...cameraFeed, enabled });
  const cameraBackground = cameraFeed.background;
  const [transcribe, setTranscribe] = useState(true);
  const [burnInCaptions, setBurnInCaptions] = useState(false);
  /**
   * Still handed to the recorder, and no longer describing anything it draws.
   * The stage feed owns position, size and shape now; this exists because
   * `RecorderOptions` still carries the field, and it is filled from the stage
   * so a reader comparing the two does not find two different answers.
   */
  const placement: CameraPlacement = {
    corner: "bottom-right",
    size: cameraFeed.size,
    shape: cameraFeed.shape,
  };

  /* Keep the scene timeline in step with navigation. */
  useEffect(() => {
    if (phase === "recording") recorderRef.current?.markScene(currentSceneId, currentSceneIndex);
  }, [currentSceneIndex, currentSceneId, phase]);

  /* Elapsed clock and cross-window status badge. */
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const interval = setInterval(() => {
      const ms = recorderRef.current?.elapsedMs ?? 0;
      setElapsed(ms);
      channel?.post({
        type: "recording",
        status: phase === "paused" ? "paused" : "recording",
        elapsedMs: ms,
        hasCamera: useCamera,
        hasMicrophone: true,
      });
    }, 500);
    return () => clearInterval(interval);
  }, [phase, channel, useCamera]);

  useEffect(() => () => recorderRef.current?.cleanup(), []);

  const openSetup = async () => {
    const devices = await listDevices();
    setMicrophones(devices.microphones);
    setCameras(devices.cameras);
    setSetupOpen(true);
  };

  const begin = async () => {
    const recorder = new PresentationRecorder();
    recorderRef.current = recorder;
    recorder.onPhaseChange = (next, detail) => {
      setPhase(next);
      if (detail) setNotice(detail);
    };
    recorder.onExternalStop = () => {
      // The user pressed the browser's own "Stop sharing"; finish properly.
      void stop();
    };

    try {
      await recorder.prepare({
        microphoneId: micId || null,
        cameraId: useCamera ? cameraId || null : null,
        camera: useCamera,
        cameraBackground,
        transcribe,
        burnInCaptions,
        placement,
      });
      await recorder.start();
      recorder.markScene(currentSceneId, currentSceneIndex);
      setCanPause(recorder.canPause);
      setSetupOpen(false);
      setResult(null);
      setUploadState("idle");
      toast({
        tone: "success",
        title: "Recording",
        description: "Everything on this tab is being captured, including your annotations.",
      });
    } catch (error) {
      recorder.cleanup();
      recorderRef.current = null;
      setPhase("idle");
      toast({
        tone: "error",
        title:
          error instanceof PermissionError ? "Recording didn't start" : "Couldn't start recording",
        description: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  };

  const upload = async (recorded: RecorderResult) => {
    setUploadState("uploading");

    const title = `${presentationTitle} — ${new Date().toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;

    // The row is created first so a failed upload still leaves a visible record
    // rather than a recording that silently never existed.
    const created = await createRecording({
      presentationId,
      title,
      mimeType: recorded.mimeType,
      durationSeconds: recorded.durationMs / 1000,
      hasCamera: recorded.hasCamera,
      hasMicrophone: recorded.hasMicrophone,
      timeline: recorded.timeline,
      transcript: recorded.transcript,
      status: "uploading",
    });

    if (!created.ok) {
      setUploadState("failed");
      toast({
        tone: "error",
        title: "Couldn't save to your library",
        description: `${created.error} Download it now so it isn't lost.`,
      });
      return;
    }

    try {
      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Signed out");

      const path = `${user.id}/${crypto.randomUUID()}.${recorded.extension}`;
      const { error } = await supabase.storage
        .from(STORAGE_BUCKETS.recordings)
        .upload(path, recorded.blob, { contentType: recorded.mimeType, upsert: false });

      if (error) throw new Error(error.message);

      await finaliseRecording({
        id: created.data.id,
        storagePath: path,
        byteSize: recorded.blob.size,
        status: "ready",
      });

      setUploadState("done");
      toast({
        tone: "success",
        title: "Recording saved",
        description: `${formatDuration(recorded.durationMs / 1000)} · ${formatBytes(recorded.blob.size)} · in your Recordings library.`,
      });
    } catch (error) {
      await finaliseRecording({
        id: created.data.id,
        storagePath: null,
        byteSize: recorded.blob.size,
        status: "local_only",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Upload failed",
      });
      setUploadState("failed");
      toast({
        tone: "error",
        title: "Upload failed — download it now",
        description: "The recording is still in this tab. Close it and the file is gone.",
        action: {
          label: "Download",
          onClick: () => downloadRecording(recorded, sanitiseFilename(title)),
        },
      });
    }
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    try {
      const recorded = await recorder.stop();
      setResult(recorded);
      setElapsed(recorded.durationMs);
      channel?.post({
        type: "recording",
        status: "saving",
        elapsedMs: recorded.durationMs,
        hasCamera: recorded.hasCamera,
        hasMicrophone: recorded.hasMicrophone,
      });
      void upload(recorded);
    } catch (error) {
      setPhase("error");
      toast({
        tone: "error",
        title: "Recording failed",
        description: error instanceof Error ? error.message : "The recording couldn't be finished.",
      });
    } finally {
      recorderRef.current = null;
    }
  };

  const recording = phase === "recording" || phase === "paused";

  if (!support.supported) {
    return (
      <UnsupportedBadge reason={support.reason ?? "Recording isn't available in this browser."} />
    );
  }

  return (
    <>
      {/* Idle affordance lives in the top-right, away from the presenter bar. */}
      <AnimatePresence>
        {!recording && !result && (
          <motion.button
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            onClick={(e) => {
              e.stopPropagation();
              void openSetup();
            }}
            className="absolute top-5 right-5 z-30 flex items-center gap-2 rounded-full border border-white/12 bg-black/70 px-3.5 py-2 text-[12px] font-medium text-white/85 backdrop-blur-md transition-colors hover:bg-black/85 hover:text-white"
          >
            <Circle className="size-3 fill-[var(--record)] text-[var(--record)]" aria-hidden />
            Record
          </motion.button>
        )}
      </AnimatePresence>

      {/* Live badge. Visible to the presenter and, deliberately, to the room —
          people should know when they are being recorded. */}
      <AnimatePresence>
        {recording && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            onClick={(e) => e.stopPropagation()}
            role="status"
            aria-live="polite"
            className="absolute top-5 right-5 z-30 flex items-center gap-2 rounded-full border border-white/12 bg-black/75 px-2.5 py-1.5 backdrop-blur-md"
          >
            <span
              className={cn(
                "size-2 rounded-full bg-[var(--record)]",
                phase === "recording" && "animate-[captivate-pulse_1.6s_ease-in-out_infinite]",
              )}
              aria-hidden
            />
            <span className="text-[12px] text-white tabular-nums">
              {formatDuration(elapsed / 1000)}
            </span>
            <span className="sr-only">{phase === "paused" ? "Recording paused" : "Recording"}</span>

            {canPause && (
              <button
                onClick={() =>
                  phase === "paused" ? recorderRef.current?.resume() : recorderRef.current?.pause()
                }
                aria-label={phase === "paused" ? "Resume recording" : "Pause recording"}
                className="ml-1 flex size-6 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/12 hover:text-white"
              >
                {phase === "paused" ? (
                  <Play className="size-3" aria-hidden />
                ) : (
                  <Pause className="size-3" aria-hidden />
                )}
              </button>
            )}

            <button
              onClick={() => void stop()}
              aria-label="Stop recording"
              className="flex size-6 items-center justify-center rounded-full bg-white/12 text-white transition-colors hover:bg-white/25"
            >
              <Square className="size-2.5 fill-current" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Post-recording panel. */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-5 right-5 z-30 w-[300px] rounded-[var(--radius-lg)] border border-white/12 bg-black/85 p-3.5 text-white backdrop-blur-md"
          >
            <div className="flex items-center gap-2">
              <Video className="size-4 text-[var(--record)]" aria-hidden />
              <span className="text-[13px] font-medium">Recording finished</span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/65">
              {formatDuration(result.durationMs / 1000)} · {formatBytes(result.blob.size)} ·{" "}
              {result.extension.toUpperCase()}
              {result.hasCamera && " · camera included"}
              {result.transcript.length > 0 && " · transcript captured"}
            </p>

            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-white/70">
              {uploadState === "uploading" && (
                <>
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Saving to your library…
                </>
              )}
              {uploadState === "done" && (
                <span className="text-[var(--success)]">Saved to Recordings.</span>
              )}
              {uploadState === "failed" && (
                <span className="text-[var(--record)]">
                  Not uploaded. Download it before closing this tab.
                </span>
              )}
            </p>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => downloadRecording(result, sanitiseFilename(presentationTitle))}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-white px-3 py-1.5 text-[12px] font-medium text-black transition-opacity hover:opacity-90"
              >
                <Download className="size-3" aria-hidden />
                Download
              </button>
              {result.transcript.length > 0 && (
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([toWebVTT(result.transcript)], { type: "text/vtt" }),
                    );
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `${sanitiseFilename(presentationTitle)}.vtt`;
                    anchor.click();
                    setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  }}
                  aria-label="Download subtitles"
                  className="flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-white/20 px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10"
                >
                  <Captions className="size-3" aria-hidden />
                  .vtt
                </button>
              )}
              <button
                onClick={() => setResult(null)}
                className="rounded-[var(--radius-md)] border border-white/20 px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SetupDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onStart={() => void begin()}
        starting={phase === "requesting"}
        microphones={microphones}
        cameras={cameras}
        micId={micId}
        setMicId={setMicId}
        cameraId={cameraId}
        setCameraId={setCameraId}
        useCamera={useCamera}
        setUseCamera={setUseCamera}
        cameraBackground={cameraBackground}
        transcribe={transcribe}
        setTranscribe={setTranscribe}
        burnInCaptions={burnInCaptions}
        setBurnInCaptions={setBurnInCaptions}
        cameraFeed={cameraFeed}
        onCameraFeedChange={onCameraFeedChange}
        format={support.extension.toUpperCase()}
        notice={notice}
      />
    </>
  );
}

function UnsupportedBadge({ reason }: { reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="absolute top-5 right-5 z-30 flex items-center gap-2 rounded-full border border-white/12 bg-black/60 px-3 py-1.5 text-[12px] text-white/55 backdrop-blur-md"
      >
        <AlertTriangle className="size-3" aria-hidden />
        Recording unavailable
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Recording isn't available here"
        description={reason}
        size="sm"
        footer={
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      />
    </>
  );
}

function SetupDialog({
  open,
  onClose,
  onStart,
  starting,
  microphones,
  cameras,
  micId,
  setMicId,
  cameraId,
  setCameraId,
  useCamera,
  setUseCamera,
  cameraBackground,
  transcribe,
  setTranscribe,
  burnInCaptions,
  setBurnInCaptions,
  cameraFeed,
  onCameraFeedChange,
  format,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
  starting: boolean;
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  micId: string;
  setMicId: (v: string) => void;
  cameraId: string;
  setCameraId: (v: string) => void;
  useCamera: boolean;
  setUseCamera: (v: boolean) => void;
  cameraBackground: CameraBackground;
  transcribe: boolean;
  setTranscribe: (v: boolean) => void;
  burnInCaptions: boolean;
  setBurnInCaptions: (v: boolean) => void;
  cameraFeed: CameraFeedSettings;
  onCameraFeedChange: (next: CameraFeedSettings) => void;
  format: string;
  notice: string | null;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record this presentation"
      description="Captivate records the stage by capturing this browser tab, so everything the audience sees — including your laser, highlights and ink — ends up in the file."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="record" size="sm" onClick={onStart} loading={starting}>
            <Circle className="size-3 fill-current" aria-hidden />
            Start recording
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Microphone" icon={Mic}>
          <select
            value={micId}
            onChange={(e) => setMicId(e.target.value)}
            aria-label="Microphone"
            className="border-line text-ink focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-2.5 py-2 text-[13px] outline-none"
          >
            <option value="">System default</option>
            {microphones.map((device, i) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          {microphones.length > 0 && !microphones[0].label && (
            <p className="text-ink-3 mt-1.5 text-[11px]">
              Device names appear once you&apos;ve granted microphone access at least once.
            </p>
          )}
        </Field>

        <Field label="Camera" icon={useCamera ? Camera : CameraOff}>
          <label className="flex cursor-pointer items-start gap-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={useCamera}
              onClick={() => setUseCamera(!useCamera)}
              className={cn(
                "mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors",
                useCamera ? "bg-accent" : "bg-[var(--border-default)]",
              )}
            >
              <span
                className={cn(
                  "block size-3 rounded-full bg-white transition-transform",
                  useCamera && "translate-x-3",
                )}
              />
            </button>
            <span className="text-ink text-[13px]">
              Include my camera
              <span className="text-ink-3 mt-0.5 block text-[11.5px] leading-snug">
                Composited into the video itself, not overlaid at playback.
              </span>
            </span>
          </label>

          {useCamera && (
            <div className="border-line-subtle mt-3 space-y-3 border-l-2 pl-3">
              <select
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                aria-label="Camera"
                className="border-line text-ink focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-2.5 py-2 text-[13px] outline-none"
              >
                <option value="">System default</option>
                {cameras.map((device, i) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>

              <p className="text-ink-3 text-[11px] leading-snug">
                Drag the camera on the stage to move it, and pull its corner to resize. What you
                arrange there is what the recording contains — it is the same feed, not a copy.
              </p>

              <div>
                <p className="text-ink-3 mb-1.5 text-[10px] font-medium tracking-wider uppercase">
                  Background
                </p>
                <Segmented
                  label="Camera background"
                  size="sm"
                  value={cameraBackground}
                  onChange={(background) => {
                    // A cut-out only makes sense with the background removed.
                    onCameraFeedChange({
                      ...cameraFeed,
                      background,
                      shape:
                        background !== "remove" && cameraFeed.shape === "cutout"
                          ? "circle"
                          : cameraFeed.shape,
                    });
                  }}
                  options={[
                    { value: "none", label: "As is" },
                    { value: "blur", label: "Blurred" },
                    { value: "remove", label: "Removed" },
                  ]}
                />
                <p className="text-ink-3 mt-1 text-[11px] leading-snug">
                  Processed on this device — camera video never leaves it.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Segmented
                  label="Camera shape"
                  size="sm"
                  value={cameraFeed.shape}
                  onChange={(shape) => onCameraFeedChange({ ...cameraFeed, shape })}
                  options={
                    cameraBackground === "remove"
                      ? [
                          { value: "circle", label: "Circle" },
                          { value: "rounded", label: "Rounded" },
                          { value: "cutout", label: "Cut-out" },
                        ]
                      : [
                          { value: "circle", label: "Circle" },
                          { value: "rounded", label: "Rounded" },
                        ]
                  }
                />
                <Segmented
                  label="Camera size"
                  size="sm"
                  value={nearestSize(cameraFeed.size)}
                  onChange={(v) => onCameraFeedChange({ ...cameraFeed, size: Number(v) })}
                  options={[
                    { value: "0.13", label: "S" },
                    { value: "0.2", label: "M" },
                    { value: "0.3", label: "L" },
                  ]}
                />
              </div>
            </div>
          )}
        </Field>

        <Field label="Transcript" icon={Captions}>
          {transcriptSupported() ? (
            <div className="space-y-2.5">
              <label className="flex cursor-pointer items-start gap-2.5">
                <button
                  role="switch"
                  aria-checked={transcribe}
                  onClick={() => setTranscribe(!transcribe)}
                  className={cn(
                    "relative mt-0.5 h-4.5 w-8 shrink-0 rounded-full transition-colors",
                    transcribe ? "bg-accent" : "bg-[var(--border-strong)]",
                  )}
                >
                  <span
                    className={cn(
                      "block size-3 rounded-full bg-white transition-transform",
                      transcribe && "translate-x-3",
                    )}
                  />
                </button>
                <span className="text-ink text-[13px]">
                  Live transcript
                  <span className="text-ink-3 mt-0.5 block text-[11.5px] leading-snug">
                    Written by this browser as you speak. Downloads as subtitles (.vtt) and powers
                    captions during playback.
                  </span>
                </span>
              </label>

              {transcribe && (
                <label className="border-line-subtle ml-0.5 flex cursor-pointer items-start gap-2.5 border-l-2 pl-3">
                  <button
                    role="switch"
                    aria-checked={burnInCaptions}
                    onClick={() => setBurnInCaptions(!burnInCaptions)}
                    className={cn(
                      "relative mt-0.5 h-4.5 w-8 shrink-0 rounded-full transition-colors",
                      burnInCaptions ? "bg-accent" : "bg-[var(--border-strong)]",
                    )}
                  >
                    <span
                      className={cn(
                        "block size-3 rounded-full bg-white transition-transform",
                        burnInCaptions && "translate-x-3",
                      )}
                    />
                  </button>
                  <span className="text-ink text-[13px]">
                    Burn captions into the video
                    <span className="text-ink-3 mt-0.5 block text-[11.5px] leading-snug">
                      Subtitles become part of the picture — visible in any player, impossible to
                      turn off. Leave this off to keep them as a separate track.
                    </span>
                  </span>
                </label>
              )}
            </div>
          ) : (
            <p className="text-ink-3 text-[12px] leading-relaxed">
              Live transcripts aren&apos;t available in this browser — Chrome and Edge can write
              subtitles as you speak.
            </p>
          )}
        </Field>

        {notice && (
          <p
            role="status"
            className="text-ink-2 rounded-[var(--radius-md)] bg-[var(--accent-soft)] px-3 py-2 text-[12px]"
          >
            {notice}
          </p>
        )}

        <p className="border-line-subtle text-ink-3 rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-3 py-2.5 text-[11.5px] leading-relaxed">
          Your browser will ask which screen or tab to share — choose{" "}
          <strong className="text-ink-2">this tab</strong> for the cleanest result. The file will be{" "}
          {format}. It downloads to your device and uploads to your Recordings library.
        </p>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-ink-3 mb-1.5 flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
      {children}
    </div>
  );
}
