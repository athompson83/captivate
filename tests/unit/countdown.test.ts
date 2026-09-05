import { afterEach, describe, expect, it, vi } from "vitest";
import { COUNTDOWN_FROM, COUNTDOWN_STEP_MS, countdown } from "@/lib/record/countdown";

afterEach(() => {
  vi.useRealTimers();
});

describe("the count before a recording", () => {
  it("shows each number a second apart and resolves a step after the last", async () => {
    vi.useFakeTimers();
    const shown: number[] = [];
    const done = countdown(COUNTDOWN_FROM, (n) => shown.push(n));
    expect(shown).toEqual([3]);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_STEP_MS);
    expect(shown).toEqual([3, 2]);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_STEP_MS);
    expect(shown).toEqual([3, 2, 1]);

    let settled: boolean | null = null;
    void done.then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(COUNTDOWN_STEP_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("stops at once when cancelled, and says so", async () => {
    vi.useFakeTimers();
    const shown: number[] = [];
    const control = new AbortController();
    const done = countdown(3, (n) => shown.push(n), control.signal);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_STEP_MS);
    control.abort();
    expect(await done).toBe(false);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_STEP_MS * 5);
    expect(shown).toEqual([3, 2]);
  });

  it("is already over when cancelled before it began, or asked for nothing", async () => {
    const control = new AbortController();
    control.abort();
    expect(await countdown(3, () => {}, control.signal)).toBe(false);
    expect(await countdown(0, () => {})).toBe(true);
  });
});
