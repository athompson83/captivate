import { describe, expect, it } from "vitest";
import {
  BUDGET_GROUPS,
  BUDGET_KINDS,
  PER_PRESENTATION,
  PRESENTATIONS,
  TOPUP,
  allowsImageGeneration,
  ceilingsFor,
  centsPerPresentation,
  limitFor,
  planFromSubscription,
  planLabel,
  topUpCentsPerPresentation,
} from "@/lib/billing/plans";
import { AI_KINDS } from "@/lib/ai/schemas";
import { drawingCap } from "@/lib/editor/place-drawing";

const NOW = Date.parse("2026-09-01T00:00:00Z");
const FUTURE = Date.parse("2026-10-01T00:00:00Z");
const PAST = Date.parse("2026-08-01T00:00:00Z");

describe("plan budgets", () => {
  it("counts the free deck allowance in presentations over a rolling 30 days", () => {
    expect(limitFor("free", "deck")).toEqual({ windowMinutes: 43_200, max: 10 });
  });

  it("sells each plan a number of presentations, and sizes every pool from it", () => {
    // The allowances the owner approved as the launch guardrails. Everything
    // else in the table is these numbers times what one presentation can
    // consume — asserted here rather than restated, because the failure this
    // guards against is a pool being edited on its own.
    expect(PRESENTATIONS).toEqual({ free: 10, basic: 25, pro: 60, unlimited: 2000 });

    for (const plan of ["free", "basic", "pro", "unlimited"] as const) {
      for (const group of BUDGET_GROUPS) {
        expect(limitFor(plan, group).max).toBe(PRESENTATIONS[plan] * PER_PRESENTATION[group]);
      }
    }
  });

  it("can illustrate every presentation it sells", () => {
    // The defect this exists for: Basic was sixty decks and sixty drawings, so
    // a customer who used their allowance could illustrate one presentation in
    // every one they generated — and a top-up that replenished only the deck
    // counter would have sold them presentations they could not finish. The
    // bound comes from the generator, not from a number copied into this file:
    // `drawingCap` is what actually decides how many drawings a deck asks for.
    const worstCase = drawingCap(60 * 60 * 24, true);
    expect(PER_PRESENTATION.drawing).toBeGreaterThanOrEqual(worstCase);

    for (const plan of ["free", "basic", "pro"] as const) {
      expect(limitFor(plan, "drawing").max).toBeGreaterThanOrEqual(
        limitFor(plan, "deck").max * worstCase,
      );
      // And a map for each of them, which is the other call every generation
      // makes before it writes a scene.
      expect(limitFor(plan, "draft").max).toBeGreaterThanOrEqual(limitFor(plan, "deck").max);
    }
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
    for (const group of BUDGET_GROUPS) {
      const limit = limitFor("free", group);
      expect(limit.max).toBeGreaterThan(0);
      expect(limit.windowMinutes).toBe(43_200);
    }
  });

  it("makes paid image generation the one capability free does not have", () => {
    expect(allowsImageGeneration("free")).toBe(false);
    expect(allowsImageGeneration("basic")).toBe(true);
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
  it("is a ladder: every paid tier beats the one below it in every group", () => {
    for (const group of BUDGET_GROUPS) {
      expect(limitFor("basic", group).max).toBeGreaterThan(limitFor("free", group).max);
      expect(limitFor("pro", group).max).toBeGreaterThan(limitFor("basic", group).max);
    }
  });

  it("sells a month by the month, and protects it by the hour", () => {
    // The allowance is what drains and what a top-up adds to; the burst
    // ceiling is abuse protection and is not a product promise. Metering a
    // month's worth by the hour, which is what this used to do, leaves an
    // author no way to see what is left.
    for (const plan of ["free", "basic", "pro"] as const) {
      for (const group of BUDGET_GROUPS) {
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

  it("keeps the burst ceiling in the same currency as the allowance", () => {
    // Both are presentations times the same per-presentation cost, so a change
    // to one pool cannot leave the hourly cap describing a different product
    // from the monthly one — which is how a plan ends up with a burst ceiling
    // it can never reach, or one that bites in ordinary use.
    for (const plan of ["free", "basic", "pro"] as const) {
      for (const group of BUDGET_GROUPS) {
        const [allowance, burst] = ceilingsFor(plan, group);
        expect(burst!.max % PER_PRESENTATION[group]).toBe(0);
        expect(allowance.max % PER_PRESENTATION[group]).toBe(0);
      }
    }
  });

  it("prices a top-up above both tiers, per presentation", () => {
    // A top-up is for the month somebody went over, not a way to live below
    // the tier they need — and Pro has to be better value than Basic, or the
    // upgrade is a worse deal than staying put. Every figure is derived from
    // the canonical constants; a comment here once claimed Basic cost forty
    // cents when the constants said twenty, and nothing contradicted it.
    const basic = centsPerPresentation("basic");
    const pro = centsPerPresentation("pro");
    const topUp = topUpCentsPerPresentation();

    expect(topUp).toBeGreaterThan(basic);
    expect(topUp).toBeGreaterThan(pro);
    expect(basic).toBeGreaterThan(pro);
  });

  it("gives a top-up a stated life, because a credit that never expires is a liability", () => {
    expect(TOPUP.presentations).toBeGreaterThan(0);
    expect(TOPUP.validDays).toBeGreaterThan(0);
  });

  it("names every plan somebody can be on", () => {
    for (const plan of ["free", "basic", "pro", "unlimited"] as const) {
      expect(planLabel(plan).length).toBeGreaterThan(0);
    }
    expect(planLabel("basic")).toContain("Basic");
    expect(planLabel("pro")).toContain("Pro");
  });
});
