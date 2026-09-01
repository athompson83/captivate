import { afterEach, describe, expect, it, vi } from "vitest";
import { limitFor } from "@/lib/billing/plans";

const maybeSingle = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    rpc,
  }),
}));

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  vi.clearAllMocks();
  vi.resetModules();
});

/**
 * Resolving the plan moved into the database, so what is left to test here is
 * the boundary: this reads an answer it did not compute, and everything it
 * cannot trust is free.
 *
 * The resolution rules themselves — a grant outranking a subscription,
 * `past_due` graced to the period end, an unrecognised price landing on the
 * lowest paid tier — are `captivate_current_plan`'s now, and are exercised by
 * `supabase/tests/rls_isolation.test.sql` against the real schema. Testing
 * them here as well would only prove that a mock agrees with itself; that is
 * exactly what the old version of this file did, while the function the
 * reservation actually consulted was a different implementation.
 */
describe("currentPlan", () => {
  it("reports the plan the database resolved", async () => {
    rpc.mockResolvedValue({ data: "pro", error: null });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("pro");
    expect(rpc).toHaveBeenCalledWith("captivate_current_plan");
  });

  it("fails closed to free when the read errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("free");
  });

  it("fails closed to free when the answer is not a plan at all", async () => {
    // A schema drift, a renamed tier, a null. Anything unrecognised is free,
    // because failing open is how a bug becomes free Pro for everybody.
    for (const answer of ["enterprise", "", null, 7, undefined]) {
      vi.resetModules();
      rpc.mockResolvedValue({ data: answer, error: null });
      const { currentPlan } = await import("@/lib/billing/entitlement");
      expect(await currentPlan(), `${String(answer)} should not be a plan`).toBe("free");
    }
  });

  it("fails closed to free when the database is unreachable", async () => {
    rpc.mockRejectedValue(new Error("connection reset"));
    const { currentPlan } = await import("@/lib/billing/entitlement");
    expect(await currentPlan()).toBe("free");
  });
});

describe("limitForCaller", () => {
  it("hands each caller the budget of the plan the database named", async () => {
    for (const plan of ["free", "basic", "pro"] as const) {
      vi.resetModules();
      rpc.mockResolvedValue({ data: plan, error: null });
      const { limitForCaller } = await import("@/lib/billing/entitlement");
      expect(await limitForCaller("deck")).toEqual(limitFor(plan, "deck"));
    }
  });

  it("hands a caller it cannot place the free budget", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { limitForCaller } = await import("@/lib/billing/entitlement");
    expect(await limitForCaller("deck")).toEqual(limitFor("free", "deck"));
  });
});
