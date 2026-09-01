import { afterEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("currentPlan", () => {
  it("treats everyone as pro when billing is not configured", async () => {
    // A deployment that cannot charge must not throttle.
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("pro");
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("reads the mirror table when billing is configured, and the tier from its price", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro";
    maybeSingle.mockResolvedValue({
      data: {
        status: "active",
        price_id: "price_pro",
        current_period_end: "2099-01-01T00:00:00Z",
      },
      error: null,
    });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("pro");
  });

  it("grants the tier the subscription actually pays for", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_BASIC_MONTHLY = "price_basic";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro";
    maybeSingle.mockResolvedValue({
      data: {
        status: "active",
        price_id: "price_basic",
        current_period_end: "2099-01-01T00:00:00Z",
      },
      error: null,
    });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("basic");
  });

  it("does not hand out the top tier for a price it cannot place", async () => {
    // A rotated price or a missing variable resolves to the lowest paid tier,
    // never the highest.
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro";
    maybeSingle.mockResolvedValue({
      data: {
        status: "active",
        price_id: "price_from_another_deployment",
        current_period_end: "2099-01-01T00:00:00Z",
      },
      error: null,
    });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("basic");
  });

  it("falls back to free when there is no subscription row", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("free");
  });

  it("fails closed to free when the read errors", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("free");
  });

  it("downgrades a cancelled subscription", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    maybeSingle.mockResolvedValue({
      data: { status: "canceled", current_period_end: "2099-01-01T00:00:00Z" },
      error: null,
    });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("free");
  });
});

describe("limitForCaller", () => {
  it("hands a free caller the 30-day deck budget", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { limitForCaller } = await import("@/lib/billing/entitlement");
    expect(await limitForCaller("deck")).toEqual({ windowMinutes: 43_200, max: 10 });
  });

  it("hands an unconfigured deployment the pro budget", async () => {
    const { limitForCaller } = await import("@/lib/billing/entitlement");
    expect(await limitForCaller("deck")).toEqual({ windowMinutes: 43_200, max: 200 });
  });
});
