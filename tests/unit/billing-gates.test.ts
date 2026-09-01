import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The counts the gate sees, keyed by the window it asks about.
 *
 * Two windows now, because a paid plan has two ceilings — a 30-day allowance
 * and an hourly burst — and the whole point of the fix these tests guard is
 * that a call has to clear both. A mock that answered the same number
 * whichever window it was handed could not tell them apart.
 */
const used = { 43_200: 99, 60: 0 };

vi.mock("@/lib/billing/entitlement", () => ({
  currentPlan: vi.fn().mockResolvedValue("free"),
  limitForCaller: vi.fn().mockResolvedValue({ windowMinutes: 43_200, max: 10 }),
  ceilingsForCaller: vi.fn().mockResolvedValue([
    { windowMinutes: 43_200, max: 10 },
    { windowMinutes: 60, max: 5 },
  ]),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    // The count is the database's to define — a reservation abandoned by a
    // killed function is not spend — so the gate asks for it rather than
    // assembling a query of its own.
    rpc: async (_name: string, args: { p_window_minutes: number }) => ({
      data: used[args.p_window_minutes as keyof typeof used] ?? 0,
      error: null,
    }),
  }),
}));

const post = () =>
  new Request("https://example.com", { method: "POST", body: JSON.stringify({ prompt: "x" }) });

describe("the AI gate is plan-aware", () => {
  it("refuses a free caller over their allowance, in the window it actually used", async () => {
    const { guard } = await import("@/lib/ai/route-helpers");

    const result = await guard(post(), z.object({ prompt: z.string() }), "deck");

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

  it("asks the caller's plan for every ceiling rather than using a constant", async () => {
    const { ceilingsForCaller } = await import("@/lib/billing/entitlement");
    const { guard } = await import("@/lib/ai/route-helpers");

    await guard(post(), z.object({ prompt: z.string() }), "drawing");
    expect(ceilingsForCaller).toHaveBeenCalledWith("drawing");
  });

  it("enforces the burst ceiling, not only the allowance", async () => {
    // The regression this exists for: the gate read `limitForCaller`, which is
    // the allowance alone, so an hourly ceiling was a number in a table and
    // nothing else. Here the 30-day allowance is nowhere near spent and the
    // hour is, and the refusal has to name the hour.
    used[43_200] = 1;
    used[60] = 5;
    try {
      const { guard } = await import("@/lib/ai/route-helpers");
      const result = await guard(post(), z.object({ prompt: z.string() }), "deck");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(429);
        expect((await result.response.json()).error).toContain("the last 1 hour");
      }
    } finally {
      used[43_200] = 99;
      used[60] = 0;
    }
  });
});

describe("image generation", () => {
  it("is the one capability free does not have", async () => {
    const { allowsImageGeneration } = await import("@/lib/billing/plans");
    expect(allowsImageGeneration("free")).toBe(false);
    expect(allowsImageGeneration("basic")).toBe(true);
    expect(allowsImageGeneration("pro")).toBe(true);
  });
});
