import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One transient read failure must not be a full-page error.
 *
 * The live incident: signing in redirects to /home, whose first query runs
 * against a cold serverless function with a milliseconds-old session cookie.
 * One refused PostgREST request there was thrown straight into the route's
 * error boundary — "This page didn't load", over a database that answered
 * perfectly on the next request. `readTwice` in `lib/data/presentations.ts`
 * absorbs exactly one such blip; a database that is genuinely down still
 * fails, deliberately, into the same boundary.
 */

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  folder_id: null,
  title: "Deck",
  description: "",
  theme_id: "ember",
  theme_overrides: null,
  aspect_ratio: "16:9",
  tags: [],
  is_favorite: false,
  thumbnail_url: null,
  schema_version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  last_opened_at: null,
  deleted_at: null,
  journey: null,
  target_seconds: 0,
  share_token: null,
  folders: null,
  scenes: [{ count: 3 }],
};

/**
 * A thenable query chain whose executions resolve from `outcomes` in order —
 * the shape that matters, because a PostgREST builder re-executes on every
 * await and the retry depends on exactly that.
 */
function mockChain(outcomes: { data: unknown; error: { message: string } | null }[]) {
  let call = 0;
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "eq", "is", "not", "or", "contains", "order", "limit", "maybeSingle"]) {
    chain[method] = self;
  }
  chain.then = (resolve: (v: unknown) => void) => {
    const outcome = outcomes[Math.min(call, outcomes.length - 1)];
    call += 1;
    return Promise.resolve(resolve(outcome));
  };
  return { chain, calls: () => call };
}

function mockSupabase(outcomes: { data: unknown; error: { message: string } | null }[]) {
  const { chain, calls } = mockChain(outcomes);
  vi.doMock("@/lib/supabase/server", () => ({
    supabaseServer: vi.fn(async () => ({ from: () => chain })),
  }));
  return calls;
}

describe("listPresentations under a transient failure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  it("absorbs one failed read and returns the second answer", async () => {
    const calls = mockSupabase([
      { data: null, error: { message: "upstream connect error" } },
      { data: [row], error: null },
    ]);
    const { listPresentations } = await import("@/lib/data/presentations");
    const pending = listPresentations({});
    await vi.advanceTimersByTimeAsync(400);
    const result = await pending;
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Deck");
    expect(calls()).toBe(2);
  });

  it("still fails when the database is genuinely down", async () => {
    mockSupabase([{ data: null, error: { message: "still down" } }]);
    const { listPresentations } = await import("@/lib/data/presentations");
    const pending = listPresentations({}).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(400);
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("still down");
  });

  it("does not retry a read that succeeded", async () => {
    const calls = mockSupabase([{ data: [row], error: null }]);
    const { listPresentations } = await import("@/lib/data/presentations");
    await listPresentations({});
    expect(calls()).toBe(1);
  });
});
