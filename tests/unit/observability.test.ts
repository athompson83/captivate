import { afterEach, describe, expect, it, vi } from "vitest";
import { __detailOfForTests, logFailure } from "@/lib/observability";

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
    expect(detail.length).toBeLessThanOrEqual(301);
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
