import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/billing/entitlement", () => ({
  currentPlan: vi.fn().mockResolvedValue("free"),
  limitForCaller: vi.fn().mockResolvedValue({ windowMinutes: 43_200, max: 10 }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    // The count is the database's to define — a reservation abandoned by a
    // killed function is not spend — so the gate asks for it rather than
    // assembling a query of its own.
    rpc: async () => ({ data: 99, error: null }),
  }),
}));

describe("the AI gate is plan-aware", () => {
  it("refuses a free caller over their allowance, in the window it actually used", async () => {
    const { guard } = await import("@/lib/ai/route-helpers");

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({ prompt: "x" }),
    });
    const result = await guard(request, z.object({ prompt: z.string() }), "deck");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(429);
      const body = await result.response.json();
      // The window is rolling over 30 days; the copy must not call it an hour
      // or a month.
      expect(body.error).toContain("30 days");
      expect(body.error).not.toMatch(/this month|last hour/i);
    }
  });

  it("asks the caller's plan for the budget rather than using a constant", async () => {
    const { limitForCaller } = await import("@/lib/billing/entitlement");
    const { guard } = await import("@/lib/ai/route-helpers");

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({ prompt: "x" }),
    });
    await guard(request, z.object({ prompt: z.string() }), "drawing");
    expect(limitForCaller).toHaveBeenCalledWith("drawing");
  });
});

describe("image generation", () => {
  it("is the one capability free does not have", async () => {
    const { allowsImageGeneration } = await import("@/lib/billing/plans");
    expect(allowsImageGeneration("free")).toBe(false);
    expect(allowsImageGeneration("pro")).toBe(true);
  });
});
