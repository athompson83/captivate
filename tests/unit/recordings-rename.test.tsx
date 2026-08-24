// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RecordingSummary } from "@/lib/data/recordings";

/**
 * Renaming a recording committed on blur and only on blur. Typing a new title
 * and pressing Enter — the gesture a single-line title field invites — left
 * the field looking edited and wrote nothing, and there was no way to abandon
 * an edit at all short of retyping the old name.
 */

const renameRecording = vi.fn(async () => ({ ok: true as const, data: undefined }));

vi.mock("@/lib/data/recordings", () => ({
  getRecordingUrl: vi.fn(async () => ({ ok: true as const, data: { url: "https://example.com/r.webm" } })),
  deleteRecording: vi.fn(async () => ({ ok: true as const, data: undefined })),
  renameRecording: (...args: unknown[]) => renameRecording(...(args as [])),
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
  hasCamera: false,
  hasMicrophone: false,
  timeline: [],
  transcript: [],
  errorMessage: null,
  createdAt: "2026-01-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  renameRecording.mockClear();
});

async function openTitleField() {
  const { PlaybackBody } = await import("@/components/dashboard/recordings-library");
  render(<PlaybackBody recording={recording} onClose={() => {}} onRenamed={() => {}} />);
  return screen.findByLabelText("Recording title");
}

describe("renaming a recording", () => {
  it("commits on Enter", async () => {
    const user = userEvent.setup();
    const field = await openTitleField();
    await user.clear(field);
    await user.type(field, "Second take{Enter}");
    await waitFor(() => expect(renameRecording).toHaveBeenCalledWith(recording.id, "Second take"));
  });

  it("still commits on blur, for anyone who clicks away instead", async () => {
    const user = userEvent.setup();
    const field = await openTitleField();
    await user.clear(field);
    await user.type(field, "Third take");
    await user.tab();
    await waitFor(() => expect(renameRecording).toHaveBeenCalledWith(recording.id, "Third take"));
  });

  it("abandons the edit on Escape without writing it", async () => {
    const user = userEvent.setup();
    const field = await openTitleField();
    await user.clear(field);
    await user.type(field, "Never saved{Escape}");
    // The blur Escape triggers must not smuggle the abandoned text through.
    await waitFor(() => expect(field).toHaveValue("Take 1"));
    expect(renameRecording).not.toHaveBeenCalled();
  });

  it("does not write an empty title", async () => {
    const user = userEvent.setup();
    const field = await openTitleField();
    await user.clear(field);
    await user.type(field, "   {Enter}");
    await waitFor(() => expect(field).toHaveValue("   "));
    expect(renameRecording).not.toHaveBeenCalled();
  });
});
