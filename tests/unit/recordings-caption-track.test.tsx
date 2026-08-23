// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { RecordingSummary } from "@/lib/data/recordings";

/**
 * The playback dialog's caption track has to survive the production CSP.
 * `media-src` allows `blob:` but not `data:` — a `<track src="data:...">`
 * is silently dropped by a CSP-enforcing browser, so captions never appear.
 * This pins that the track is built from an allocated object URL instead.
 */

vi.mock("@/lib/data/recordings", () => ({
  getRecordingUrl: vi.fn(async () => ({ ok: true as const, data: { url: "https://example.com/rec.webm" } })),
  deleteRecording: vi.fn(async () => ({ ok: true as const, data: undefined })),
  renameRecording: vi.fn(async () => ({ ok: true as const, data: undefined })),
}));

const recording: RecordingSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  presentationId: null,
  presentationTitle: null,
  title: "Take 1",
  mimeType: "video/webm",
  byteSize: 1024,
  durationSeconds: 12,
  status: "ready",
  hasCamera: true,
  hasMicrophone: true,
  timeline: [],
  transcript: [{ startMs: 0, endMs: 1000, text: "Hello" }],
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("recording playback captions", () => {
  it("points the caption track at a blob: URL, never a data: URL", async () => {
    const { PlaybackBody } = await import("@/components/dashboard/recordings-library");
    render(<PlaybackBody recording={recording} onClose={() => {}} onRenamed={() => {}} />);

    const track = await waitFor(() => {
      const el = document.querySelector("track[label='Transcript']");
      if (!el) throw new Error("track not rendered yet");
      return el as HTMLTrackElement;
    });

    expect(track.src).toMatch(/^blob:/);
    expect(track.src).not.toMatch(/^data:/);
  });

  it("renders no caption track when there is no transcript", async () => {
    const { PlaybackBody } = await import("@/components/dashboard/recordings-library");
    render(
      <PlaybackBody
        recording={{ ...recording, transcript: [] }}
        onClose={() => {}}
        onRenamed={() => {}}
      />,
    );
    await screen.findByLabelText("Recording title");
    expect(document.querySelector("track[label='Transcript']")).toBeNull();
  });
});
