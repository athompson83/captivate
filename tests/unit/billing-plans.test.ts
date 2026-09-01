import { describe, expect, it } from "vitest";
import {
  BUDGET_KINDS,
  PRICING,
  TOPUP,
  allowsImageGeneration,
  ceilingsFor,
  limitFor,
  planFromSubscription,
  planLabel,
} from "@/lib/billing/plans";
import { AI_KINDS } from "@/lib/ai/schemas";

const NOW = Date.parse("2026-09-01T00:00:00Z");
const FUTURE = Date.parse("2026-10-01T00:00:00Z");
const PAST = Date.parse("2026-08-01T00:00:00Z");

describe("plan budgets", () => {
  it("counts the free deck allowance in presentations over a rolling 30 days", () => {
    expect(limitFor("free", "deck")).toEqual({ windowMinutes: 43_200, max: 10 });
  });

  it("sells Pro by the month and keeps half its old hourly cap as a burst", () => {
    // This asserted the hourly ceiling *as the allowance*, which is what the
    // pricing change moved away from: a month's worth metered by the hour is
    // a number nobody can see themselves spending, and nothing a top-up can
    // add to. The hourly figure survives as the burst ceiling, at the half
    // the change specified.
    expect(limitFor("pro", "deck")).toEqual({ windowMinutes: 43_200, max: 200 });
    expect(ceilingsFor("pro", "deck")[1]).toEqual({ windowMinutes: 60, max: 15 });
    expect(ceilingsFor("pro", "light")[1]).toEqual({ windowMinutes: 60, max: 150 });
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
      const limit = limitFor("free", group);
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
  const sub = (
    status: string,
    currentPeriodEndMs: number | null = FUTURE,
    plan: "basic" | "pro" | null = "pro",
  ) => ({ status, currentPeriodEndMs, plan });

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

  it("grants the tier that was actually bought", () => {
    // The price is the tier. A Basic subscription granting Pro's allowance is
    // the whole reason `price_id` — carried on the row since billing was built
    // and read by nothing — is read now.
    expect(planFromSubscription(sub("active", FUTURE, "basic"), NOW)).toBe("basic");
    expect(planFromSubscription(sub("active", FUTURE, "pro"), NOW)).toBe("pro");
    expect(planFromSubscription(sub("past_due", FUTURE, "basic"), NOW)).toBe("basic");
  });

  it("guesses downward when the price is not recognised", () => {
    // A rotated price or a missing environment variable. Guessing upward would
    // hand somebody Pro for Basic's money on nothing more than stale config.
    expect(planFromSubscription(sub("active", FUTURE, null), NOW)).toBe("basic");
  });
});

describe("the tiers are worth what they cost", () => {
  const decks = (plan: "free" | "basic" | "pro") => limitFor(plan, "deck").max;

  it("is a ladder: every paid tier beats the one below it in every group", () => {
    for (const group of ["deck", "draft", "drawing", "light"] as const) {
      expect(limitFor("basic", group).max).toBeGreaterThan(limitFor("free", group).max);
      expect(limitFor("pro", group).max).toBeGreaterThan(limitFor("basic", group).max);
    }
  });

  it("holds the ratios the pricing change was specified in", () => {
    // Basic is fifteen per cent of Pro, on the allowance and on the burst
    // ceiling both, so the two numbers describe one decision.
    for (const group of ["deck", "draft", "drawing", "light"] as const) {
      // Both percentages in the change are relative to what Pro used to
      // advertise — the new Pro is half of it, Basic fifteen per cent — so
      // against each other Basic is thirty per cent of Pro. The point of the
      // assertion is that the allowance and the burst agree on that, rather
      // than one of them being set by hand and drifting.
      const [proMonth, proHour] = ceilingsFor("pro", group);
      const [basicMonth, basicHour] = ceilingsFor("basic", group);
      expect(basicMonth.max / proMonth.max).toBeCloseTo(0.3, 2);
      // The hourly numbers are small enough that rounding 4.5 up to 5 moves
      // the ratio, so this is held to one place rather than two.
      expect(basicHour!.max / proHour!.max).toBeCloseTo(0.3, 1);
    }
  });

  it("sells a month by the month, and protects it by the hour", () => {
    // The allowance is what drains and what a top-up adds to; the burst
    // ceiling is abuse protection and is not a product promise. Metering a
    // month's worth by the hour, which is what this used to do, leaves an
    // author no way to see what is left.
    for (const plan of ["basic", "pro"] as const) {
      for (const group of ["deck", "draft", "drawing", "light"] as const) {
        const ceilings = ceilingsFor(plan, group);
        expect(ceilings).toHaveLength(2);
        expect(ceilings[0].windowMinutes).toBe(43_200);
        expect(ceilings[1]!.windowMinutes).toBe(60);
        // A burst ceiling nobody reaches in a day's work, but low enough that
        // a month cannot be spent in an afternoon.
        expect(ceilings[1]!.max).toBeLessThan(ceilings[0].max);
      }
    }
  });

  it("prices a top-up above both tiers, per presentation", () => {
    // A top-up is for the month somebody went over, not a way to live below
    // the tier they need. Cents per deck, so the ladder is checked in money.
    const cents = (money: string) => Number(money.replace("$", "")) * 100;
    const topUp = cents(TOPUP.price) / TOPUP.decks;
    expect(topUp).toBeGreaterThan(cents(PRICING.basic.monthly) / decks("basic"));
    expect(topUp).toBeGreaterThan(cents(PRICING.pro.monthly) / decks("pro"));
    expect(cents(PRICING.basic.monthly) / decks("basic")).toBeGreaterThan(
      cents(PRICING.pro.monthly) / decks("pro"),
    );
  });

  it("names every plan somebody can be on", () => {
    for (const plan of ["free", "basic", "pro", "unlimited"] as const) {
      expect(planLabel(plan).length).toBeGreaterThan(0);
    }
    expect(planLabel("basic")).toContain("Basic");
    expect(planLabel("pro")).toContain("Pro");
  });
});
