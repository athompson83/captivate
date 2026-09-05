import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { HEARTBEAT, HEARTBEAT_MS, keepAlive } from "@/lib/ai/keep-alive";

/**
 * The long AI routes answer through `keepAlive`, which sends the headers at
 * once and a byte of JSON whitespace every ten seconds until the route's own
 * body is ready. A phone drops a request that goes sixty seconds without a
 * byte, and a full deck takes a hundred — the owner watched "Couldn't reach
 * the server" over a deck that finished writing and was saved.
 */

const decoder = new TextDecoder();

/** Every chunk the stream produced, in order, until it closed. */
async function drain(response: Response): Promise<string[]> {
  const reader = response.body!.getReader();
  const chunks: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return chunks;
    chunks.push(decoder.decode(value));
  }
}

/** A promise the test resolves by hand, standing in for a slow model call. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("keepAlive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers with headers and heartbeats before the work is done, then the work's body", async () => {
    const work = deferred<Response>();
    const response = keepAlive(() => work.promise);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("no-transform");

    const reader = response.body!.getReader();

    // Three heartbeats in thirty seconds, well inside a phone's patience.
    for (let n = 0; n < 3; n += 1) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      expect(decoder.decode(value)).toBe(HEARTBEAT);
    }

    work.resolve(NextResponse.json({ id: "deck-1", sceneCount: 17 }));
    await vi.advanceTimersByTimeAsync(0);

    const { value } = await reader.read();
    expect(JSON.parse(decoder.decode(value))).toEqual({ id: "deck-1", sceneCount: 17 });
    expect((await reader.read()).done).toBe(true);
  });

  it("produces a body that response.json() reads as the route's JSON, prelude and all", async () => {
    const work = deferred<Response>();
    const response = keepAlive(() => work.promise);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 4);
    work.resolve(NextResponse.json({ ok: true, scenes: [1, 2, 3] }));
    await vi.advanceTimersByTimeAsync(0);

    // Leading whitespace is valid JSON; the client's `response.json()` needs
    // no change to read a body that begins with forty seconds of newlines.
    await expect(response.json()).resolves.toEqual({ ok: true, scenes: [1, 2, 3] });
  });

  it("carries the route's own error through, whatever status it chose", async () => {
    const response = keepAlive(async () =>
      NextResponse.json({ error: "The model took too long to answer." }, { status: 502 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      error: "The model took too long to answer.",
    });
  });

  it("turns a thrown route into an error body, and logs the cause for the operator", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = keepAlive(async () => {
      throw new Error("supabase fell over");
    });
    await vi.advanceTimersByTimeAsync(0);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/dashboard/);
    // The route's exception text is an operator's concern, not the author's —
    // before the wrapper it surfaced as a logged 500, and a polite 200 with
    // no trace would be strictly harder to diagnose.
    expect(body.error).not.toContain("supabase");
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toContain("supabase fell over");
    stderr.mockRestore();
  });

  it("stops the heartbeat once the body is written", async () => {
    const response = keepAlive(async () => NextResponse.json({ done: true }));
    await vi.advanceTimersByTimeAsync(0);
    const chunks = await drain(response);
    expect(chunks.join("")).toBe(JSON.stringify({ done: true }));
    // With the stream closed, a further tick must not try to enqueue.
    expect(() => vi.advanceTimersByTime(HEARTBEAT_MS * 3)).not.toThrow();
  });

  it("keeps working when the reader cancels, and does not throw at the next beat", async () => {
    const work = deferred<Response>();
    let finished = false;
    const response = keepAlive(() =>
      work.promise.then((r) => {
        finished = true;
        return r;
      }),
    );
    await response.body!.cancel();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    work.resolve(NextResponse.json({ id: "deck-2" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
  });
});
