import { describe, expect, it, vi, afterEach } from "vitest";
import {
  formatBytes,
  formatDuration,
  pluralise,
  relativeTime,
  formatDate,
} from "@/lib/utils/format";

afterEach(() => vi.useRealTimers());

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("adds an hours field past an hour", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(7200)).toBe("2:00:00");
  });

  it("handles nonsense input rather than printing NaN", () => {
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Infinity)).toBe("0:00");
  });
});

describe("formatBytes", () => {
  it("scales through the units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 5)).toBe("5.0 MB");
    expect(formatBytes(1024 ** 3 * 2)).toBe("2.0 GB");
  });

  it("drops the decimal for large values", () => {
    expect(formatBytes(1024 * 12)).toBe("12 KB");
  });

  it("handles nonsense input", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
  });
});

describe("relativeTime", () => {
  it("says just now for the very recent past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    expect(relativeTime("2026-06-01T11:59:50Z")).toBe("just now");
  });

  it("formats older timestamps in sensible units", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    expect(relativeTime("2026-06-01T09:00:00Z")).toContain("hour");
    expect(relativeTime("2026-05-29T12:00:00Z")).toContain("day");
    expect(relativeTime("2026-01-01T12:00:00Z")).toContain("month");
  });

  it("handles missing and malformed values", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime(undefined)).toBe("never");
    expect(relativeTime("not a date")).toBe("unknown");
  });
});

describe("formatDate and pluralise", () => {
  it("renders an em dash for a missing date", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("formats a real date", () => {
    expect(formatDate("2026-06-01T12:00:00Z")).toMatch(/2026/);
  });

  it("pluralises", () => {
    expect(pluralise(1, "scene")).toBe("1 scene");
    expect(pluralise(2, "scene")).toBe("2 scenes");
    expect(pluralise(0, "scene")).toBe("0 scenes");
    expect(pluralise(2, "person", "people")).toBe("2 people");
  });
});
