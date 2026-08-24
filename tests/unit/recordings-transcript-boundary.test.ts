import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `listRecordings` reads `transcript` straight from the database. A legacy,
 * hand-edited, or corrupt row should not be able to hand a malformed cue to
 * the player — that boundary already exists (`parseCues` in
 * `lib/record/transcript-core.ts`) and this pins that `listRecordings` actually
 * uses it, rather than only checking the row is an array.
 */

const row = (transcript: unknown) => ({
  id: "11111111-1111-4111-8111-111111111111",
  presentation_id: null,
  title: "Take 1",
  mime_type: "video/webm",
  byte_size: 1024,
  duration_seconds: 12,
  status: "ready",
  has_camera: true,
  has_microphone: true,
  scene_timeline: [],
  transcript,
  error_message: null,
  created_at: "2026-01-01T00:00:00Z",
  presentations: null,
});

function mockSupabaseRows(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.order = self;
  chain.limit = self;
  chain.eq = self;
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });

  vi.doMock("@/lib/supabase/server", () => ({
    supabaseServer: vi.fn(async () => ({ from: () => chain })),
  }));
}

describe("listRecordings transcript boundary", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps well-formed cues", async () => {
    mockSupabaseRows([row([{ startMs: 0, endMs: 1000, text: "Hello" }])]);
    const { listRecordings } = await import("@/lib/data/recordings");
    const [recording] = await listRecordings();
    expect(recording.transcript).toEqual([{ startMs: 0, endMs: 1000, text: "Hello" }]);
  });

  it("drops a cue with a non-string text field instead of passing it through", async () => {
    mockSupabaseRows([row([{ startMs: 0, endMs: 1000, text: null }])]);
    const { listRecordings } = await import("@/lib/data/recordings");
    const [recording] = await listRecordings();
    expect(recording.transcript).toEqual([]);
  });

  it("drops a cue where endMs does not exceed startMs", async () => {
    mockSupabaseRows([row([{ startMs: 500, endMs: 500, text: "Stuck" }])]);
    const { listRecordings } = await import("@/lib/data/recordings");
    const [recording] = await listRecordings();
    expect(recording.transcript).toEqual([]);
  });

  it("treats a non-array transcript as empty", async () => {
    mockSupabaseRows([row("not-an-array")]);
    const { listRecordings } = await import("@/lib/data/recordings");
    const [recording] = await listRecordings();
    expect(recording.transcript).toEqual([]);
  });
});
