import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __detailOfForTests,
  __resetSamplingForTests,
  logFailure,
  logFailureSampled,
} from "@/lib/observability";

/**
 * What the operator gets, and what they must not.
 *
 * Captivate returns failures as values, so a handled failure reaches the user
 * as a toast and the platform log as nothing at all. That is how the sign-in
 * outage in this release came to be diagnosable only from the database's own
 * edge log. `logFailure` closes that, and these are the two properties it has
 * to hold while doing so: it must produce something a person can read, and it
 * must never become the reason a request fails.
 */

describe("what a failure line says", () => {
  it("reads the message off each shape an error actually arrives in", () => {
    // Three sources, three shapes: a thrown Error, a PostgREST object, and the
    // occasional bare string. A line that reads "[object Object]" is the same
    // as no line.
    expect(__detailOfForTests(new Error("connection refused"))).toBe("connection refused");
    expect(__detailOfForTests({ message: "JWT expired" })).toBe("JWT expired");
    expect(__detailOfForTests("plain string")).toBe("plain string");
    expect(__detailOfForTests(null)).toBe("null");
  });

  it("collapses whitespace so one failure is one line", () => {
    expect(__detailOfForTests("a\n  b\t\tc")).toBe("a b c");
  });

  it("bounds an enormous provider message rather than flooding the log", () => {
    const detail = __detailOfForTests("x".repeat(5000));
    // Exactly the bound, ellipsis included. The first version of this asserted
    // 301 and so agreed with the off-by-one instead of catching it.
    expect(detail.length).toBe(300);
    expect(detail.endsWith("…")).toBe(true);
  });
});

describe("logging a failure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one greppable line naming the operation", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure("data.mutation", new Error("permission denied"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("captivate:failure data.mutation: permission denied");
  });

  it("never throws, even when stderr itself does", () => {
    // This runs inside paths that are already going badly. An observability
    // call that can fail the request it is observing is worse than none.
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("stderr is gone");
    });
    expect(() => logFailure("data.mutation", "anything")).not.toThrow();
  });
});

/**
 * The webhook is the one logging site an unauthenticated caller can reach.
 *
 * A bot posting rubbish signatures at `/api/stripe/webhook` would otherwise
 * mint a line per request, and an observability change that lets an outsider
 * bury the signal is worse than the silence it replaced.
 */
describe("a failure anyone can trigger", () => {
  beforeEach(() => __resetSamplingForTests());
  afterEach(() => vi.restoreAllMocks());

  it("prints the first and counts the rest", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 500; i += 1) logFailureSampled("stripe.webhook.signature", "bad signature");

    // One line for five hundred attempts, not five hundred.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("says how many it stood in for once the window passes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      logFailureSampled("stripe.webhook.signature", "bad signature", 1000);
      for (let i = 0; i < 9; i += 1)
        logFailureSampled("stripe.webhook.signature", "bad signature", 1000);
      vi.advanceTimersByTime(1500);
      logFailureSampled("stripe.webhook.signature", "bad signature", 1000);
    } finally {
      vi.useRealTimers();
    }

    // A burst must still read as a burst, or throttling has hidden the thing
    // it was meant to bound.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0]).toContain("+9 more");
  });

  it("keeps the count on an error long enough to be truncated", () => {
    // The regression: the detail was bounded, the suffix appended, and the
    // whole thing bounded again — so a long provider message ate the very
    // number that keeps a throttle from being a way to hide things.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const enormous = "x".repeat(5000);
    vi.useFakeTimers();
    try {
      logFailureSampled("stripe.webhook.signature", enormous, 1000);
      for (let i = 0; i < 4; i += 1) logFailureSampled("stripe.webhook.signature", enormous, 1000);
      vi.advanceTimersByTime(1500);
      logFailureSampled("stripe.webhook.signature", enormous, 1000);
    } finally {
      vi.useRealTimers();
    }

    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1][0])).toContain("+4 more");
  });

  it("counts each operation separately", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailureSampled("one", "x");
    logFailureSampled("two", "x");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
