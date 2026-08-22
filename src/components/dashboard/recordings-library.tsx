"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  Captions,
  Download,
  ExternalLink,
  Mic,
  Play,
  Trash2,
  Video,
} from "lucide-react";
import type { RecordingSummary } from "@/lib/data/recordings";
import { deleteRecording, getRecordingUrl, renameRecording } from "@/lib/data/recordings";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Badge, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatDuration, relativeTime } from "@/lib/utils/format";
import { toWebVTT } from "@/lib/record/transcript";

/**
 * Recordings library.
 *
 * Recordings that never made it to storage are shown, clearly labelled, rather
 * than hidden — a user who lost an upload needs to know it happened, not
 * discover an empty library later.
 */
export function RecordingsLibrary({
  recordings,
  initialOpenId,
}: {
  recordings: RecordingSummary[];
  initialOpenId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [playing, setPlaying] = useState<RecordingSummary | null>(
    recordings.find((r) => r.id === initialOpenId) ?? null,
  );
  const [deleteTarget, setDeleteTarget] = useState<RecordingSummary | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-ink text-[22px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>Recordings</h1>
        <p className="text-ink-3 mt-1.5 max-w-2xl text-[13px] leading-relaxed">
          Everything you&apos;ve captured while presenting. Recordings are private to your account
          and stream through short-lived signed links.
        </p>
      </header>

      {recordings.length === 0 ? (
        <div className="border-line bg-raised/40 rounded-[var(--radius-lg)] border border-dashed">
          <EmptyState
            icon={<Video />}
            title="No recordings yet"
            description="Open a presentation, press Present, then Record. Captivate captures the stage with your narration and, optionally, your camera."
            action={
              <Link href="/presentations">
                <Button variant="primary" size="sm">
                  Go to presentations
                </Button>
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="space-y-2.5">
          {recordings.map((recording) => (
            <li
              key={recording.id}
              className={cn(
                "border-line-subtle bg-raised flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3.5",
                recording.status !== "ready" && "border-dashed",
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]",
                  recording.status === "ready"
                    ? "bg-[var(--record-soft)]"
                    : "bg-[var(--surface-inset)]",
                )}
              >
                {recording.status === "ready" ? (
                  <Video className="text-record size-4" aria-hidden />
                ) : (
                  <AlertTriangle className="text-warning size-4" aria-hidden />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-ink truncate text-[14px] font-medium">{recording.title}</p>
                <p className="text-ink-3 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                  <span>{formatDuration(recording.durationSeconds)}</span>
                  {recording.byteSize > 0 && <span>{formatBytes(recording.byteSize)}</span>}
                  <span>{relativeTime(recording.createdAt)}</span>
                  {recording.hasMicrophone && (
                    <span className="inline-flex items-center gap-1">
                      <Mic className="size-2.5" aria-hidden />
                      mic
                    </span>
                  )}
                  {recording.hasCamera && (
                    <span className="inline-flex items-center gap-1">
                      <Camera className="size-2.5" aria-hidden />
                      camera
                    </span>
                  )}
                  {recording.timeline.length > 0 && (
                    <span>{recording.timeline.length} chapters</span>
                  )}
                </p>

                {recording.status === "local_only" && (
                  <p className="text-warning mt-1.5 text-[11.5px] leading-relaxed">
                    This recording was never uploaded — the file only exists on the device that made
                    it. {recording.errorMessage ? `(${recording.errorMessage})` : ""}
                  </p>
                )}
                {recording.status === "failed" && (
                  <p className="text-danger mt-1.5 text-[11.5px]">
                    Recording failed. {recording.errorMessage ?? ""}
                  </p>
                )}
              </div>

              {recording.presentationTitle && recording.presentationId && (
                <Link
                  href={`/edit/${recording.presentationId}`}
                  className="text-ink-3 hover:text-ink-2 hidden max-w-[160px] items-center gap-1 truncate text-[12px] transition-colors sm:flex"
                >
                  {recording.presentationTitle}
                  <ExternalLink className="size-2.5 shrink-0" aria-hidden />
                </Link>
              )}

              {recording.status === "ready" ? (
                <Button variant="secondary" size="sm" onClick={() => setPlaying(recording)}>
                  <Play className="size-3.5" aria-hidden />
                  Play
                </Button>
              ) : (
                <Badge tone="warning">{recording.status.replace("_", " ")}</Badge>
              )}

              <button
                onClick={() => setDeleteTarget(recording)}
                aria-label={`Delete ${recording.title}`}
                className="text-ink-3 hover:text-danger rounded p-1.5 transition-colors"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PlaybackDialog
        recording={playing}
        onClose={() => setPlaying(null)}
        onRenamed={() => router.refresh()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        loading={pending}
        title={`Delete “${deleteTarget?.title}”?`}
        description="The video file is removed from storage. This cannot be undone."
        confirmLabel="Delete recording"
        onConfirm={() =>
          start(async () => {
            if (!deleteTarget) return;
            const result = await deleteRecording(deleteTarget.id);
            setDeleteTarget(null);
            if (result.ok) {
              toast({ tone: "success", title: "Recording deleted" });
              router.refresh();
            } else {
              toast({ tone: "error", title: "Couldn't delete", description: result.error });
            }
          })
        }
      />
    </div>
  );
}

function PlaybackDialog({
  recording,
  onClose,
  onRenamed,
}: {
  recording: RecordingSummary | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  return (
    <Dialog
      open={Boolean(recording)}
      onClose={onClose}
      title={recording?.title ?? "Recording"}
      size="lg"
    >
      {recording && (
        <PlaybackBody
          key={recording.id}
          recording={recording}
          onClose={onClose}
          onRenamed={onRenamed}
        />
      )}
    </Dialog>
  );
}

/**
 * Mounted per recording, so the signed URL, error and title draft all reset on
 * their own instead of being cleared by an effect.
 */
function PlaybackBody({
  recording,
  onClose,
  onRenamed,
}: {
  recording: RecordingSummary;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(recording.title);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  /** Captions as a data: URL — a pure computation, so there is no blob to
      allocate during render and nothing to revoke. Transcripts are a few
      kilobytes; the browser parses the track the same either way. */
  const vttUrl = useMemo(() => {
    if (recording.transcript.length === 0) return null;
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(toWebVTT(recording.transcript))}`;
  }, [recording.transcript]);

  useEffect(() => {
    let cancelled = false;
    void getRecordingUrl(recording.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setUrl(result.data.url);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [recording.id]);

  const saveTitle = async () => {
    if (title.trim() === recording.title || !title.trim()) return;
    const result = await renameRecording(recording.id, title.trim());
    if (result.ok) onRenamed();
    else toast({ tone: "error", title: "Couldn't rename", description: result.error });
  };

  return (
    <>
      {
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            aria-label="Recording title"
            className="text-ink hover:border-line-subtle focus:border-line w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-2 py-1 text-[14px] font-medium transition-colors focus:bg-[var(--surface-inset)]"
          />

          <div className="overflow-hidden rounded-[var(--radius-md)] bg-black">
            {url ? (
              <video
                ref={setVideoEl}
                src={url}
                controls
                autoPlay
                playsInline
                crossOrigin="anonymous"
                className="aspect-video w-full"
              >
                {vttUrl && <track kind="captions" src={vttUrl} label="Transcript" default />}
              </video>
            ) : error ? (
              <div className="flex aspect-video items-center justify-center px-6 text-center">
                <p className="text-[13px] leading-relaxed text-white/70">{error}</p>
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center">
                <Spinner />
              </div>
            )}
          </div>

          {recording.timeline.length > 0 && url && (
            <div>
              <p className="text-ink-3 mb-1.5 text-[10px] font-medium tracking-wider uppercase">
                Chapters
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {recording.timeline.map((mark, i) => (
                  <li key={i}>
                    <button
                      onClick={() => {
                        if (videoEl) {
                          videoEl.currentTime = mark.atMs / 1000;
                          void videoEl.play();
                        }
                      }}
                      className="border-line-subtle text-ink-2 hover:border-line-strong hover:text-ink rounded-full border px-2.5 py-1 text-[11.5px] transition-colors"
                    >
                      Scene {mark.sceneIndex + 1} · {formatDuration(mark.atMs / 1000)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recording.transcript.length > 0 && (
            <div>
              <button
                onClick={() => setTranscriptOpen((open) => !open)}
                aria-expanded={transcriptOpen}
                className="text-ink-3 hover:text-ink mb-1.5 flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase transition-colors"
              >
                <Captions className="size-3" aria-hidden />
                Transcript · {recording.transcript.length} lines
              </button>
              {transcriptOpen && (
                <ul className="border-line-subtle max-h-40 space-y-0.5 overflow-y-auto rounded-[var(--radius-md)] border bg-[var(--surface-inset)] p-2">
                  {recording.transcript.map((cue, i) => (
                    <li key={i}>
                      <button
                        onClick={() => {
                          if (videoEl) {
                            videoEl.currentTime = cue.startMs / 1000;
                            void videoEl.play();
                          }
                        }}
                        className="text-ink-2 hover:bg-raised hover:text-ink flex w-full gap-2 rounded px-1.5 py-0.5 text-left text-[12px] leading-relaxed transition-colors"
                      >
                        <span className="text-ink-3 shrink-0 text-[11px] tabular-nums">
                          {formatDuration(cue.startMs / 1000)}
                        </span>
                        {cue.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="text-ink-3 text-[11.5px] leading-relaxed">
            {recording.mimeType.includes("mp4")
              ? "MP4 — plays in any modern player."
              : "WebM — plays in Chrome, Edge and Firefox, and in VLC. Convert it if you need MP4 for older software."}
          </p>
        </div>
      }

      <div className="border-line-subtle mt-5 flex items-center gap-2 border-t pt-4">
        {url && (
          <a href={url} download className="mr-auto">
            <Button variant="secondary" size="sm">
              <Download className="size-3.5" aria-hidden />
              Download
            </Button>
          </a>
        )}
        {vttUrl && (
          <a href={vttUrl} download={`${recording.title.replace(/[^\w\s.-]/g, "").trim() || "recording"}.vtt`}>
            <Button variant="secondary" size="sm">
              <Captions className="size-3.5" aria-hidden />
              Subtitles
            </Button>
          </a>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}
