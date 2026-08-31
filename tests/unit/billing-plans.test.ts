import { describe, expect, it } from "vitest";
import {
  BUDGET_KINDS,
  PLAN_BUDGETS,
  allowsImageGeneration,
  limitFor,
  planFromSubscription,
} from "@/lib/billing/plans";
import { AI_KINDS } from "@/lib/ai/schemas";

const NOW = Date.parse("2026-09-01T00:00:00Z");
const FUTURE = Date.parse("2026-10-01T00:00:00Z");
const PAST = Date.parse("2026-08-01T00:00:00Z");

describe("plan budgets", () => {
  it("counts the free deck allowance in presentations over a rolling 30 days", () => {
    expect(limitFor("free", "deck")).toEqual({ windowMinutes: 43_200, max: 10 });
  });

  it("gives pro the hourly ceilings the app shipped with", () => {
    expect(limitFor("pro", "deck")).toEqual({ windowMinutes: 60, max: 30 });
    expect(limitFor("pro", "light")).toEqual({ windowMinutes: 60, max: 300 });
  });

  it("gives every group its counted kinds, and every kind exactly one group", () => {
    const groups = ["deck", "draft", "drawing", "light"] as const;
    const seen = new Set<string>();
    for (const group of groups) {
      expect(BUDGET_KINDS[group].length).toBeGreaterThan(0);
      for (const kind of BUDGET_KINDS[group]) {
        // Two groups counting one kind is how drafting an argument came to
        // spend a deck the author had not created.
        expect(seen.has(kind)).toBe(false);
        seen.add(kind);
      }
    }
    // Every kind the app can record draws on some budget. A kind in no group
    // is an unmetered side door.
    for (const kind of AI_KINDS) {
      expect(seen.has(kind)).toBe(true);
    }
  });

  it("bounds every free group, so no side door is unmetered", () => {
    for (const group of ["deck", "draft", "drawing", "light"] as const) {
      const limit = PLAN_BUDGETS.free[group];
      expect(limit.max).toBeGreaterThan(0);
      expect(limit.windowMinutes).toBe(43_200);
    }
  });

  it("makes paid image generation the one capability free does not have", () => {
    expect(allowsImageGeneration("free")).toBe(false);
    expect(allowsImageGeneration("pro")).toBe(true);
  });
});

describe("planFromSubscription", () => {
  const sub = (status: string, currentPeriodEndMs: number | null = FUTURE) => ({
    status,
    currentPeriodEndMs,
  });

  it("grants pro to an active or trialing subscription", () => {
    expect(planFromSubscription(sub("active"), NOW)).toBe("pro");
    expect(planFromSubscription(sub("trialing"), NOW)).toBe("pro");
  });

  it("keeps an active subscription on pro even if the period end looks stale", () => {
    expect(planFromSubscription(sub("active", PAST), NOW)).toBe("pro");
  });

  it("graces past_due until the period genuinely ends", () => {
    expect(planFromSubscription(sub("past_due", FUTURE), NOW)).toBe("pro");
    expect(planFromSubscription(sub("past_due", PAST), NOW)).toBe("free");
  });

  it("trusts the status when the period end is unknown", () => {
    expect(planFromSubscription(sub("active", null), NOW)).toBe("pro");
    expect(planFromSubscription(sub("past_due", null), NOW)).toBe("pro");
  });

  it("fails closed for every other status and for no subscription at all", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", ""]) {
      expect(planFromSubscription(sub(status), NOW)).toBe("free");
    }
    expect(planFromSubscription(null, NOW)).toBe("free");
  });
});
