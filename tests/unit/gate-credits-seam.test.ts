import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PER_PRESENTATION, limitFor } from "@/lib/billing/plans";

/**
 * The gate and the reservation have to agree about credits.
 *
 * This is the seam a real defect went through, and it went through it because
 * every test on either side of it mocked the other. `billing-gates` mocks
 * entitlement, so the gate never asked the real `ceilingsForCaller`; the SQL
 * acceptance test calls `captivate_reserve_generation` directly, so it never
 * passed through the gate. Both were green while an author who had bought ten
 * presentations was refused at their plan's allowance and never reached the
 * statement that would have spent one.
 *
 * So nothing here is mocked except the database itself. `guard` calls the real
 * entitlement module, which reads a plan and a credit balance from the same
 * fake Supabase the counter reads, and the assertion is the behaviour an author
 * would experience: at the allowance with credits in hand, the request is let
 * through.
 */

const BASIC_DECKS = limitFor("basic", "deck").max;

/** A Supabase whose answers describe one account, at a chosen point in its month. */
function db(options: { plan: string; used: number; creditsGranted: number[] }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (name: string, args?: { p_window_minutes?: number }) => {
      if (name === "captivate_current_plan") return { data: options.plan, error: null };
      if (name === "captivate_count_generations") {
        // Per window, like the real counter. Answering the month's figure to
        // the hour's question would make the burst ceiling refuse every case
        // below and hide what is actually being tested.
        return {
          data: args?.p_window_minutes === 60 ? 0 : options.used,
          error: null,
        };
      }
      return { data: null, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            gt: async () =>
              table === "generation_credits"
                ? {
                    data: options.creditsGranted.map((presentations_granted) => ({
                      presentations_granted,
                    })),
                    error: null,
                  }
                : { data: [], error: null },
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };
}

async function guardWith(options: { plan: string; used: number; creditsGranted: number[] }) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/server", () => ({
    getCurrentUser: async () => ({ id: "user-1" }),
    supabaseServer: async () => db(options),
  }));
  const { guard } = await import("@/lib/ai/route-helpers");
  return guard(
    new Request("https://example.com", { method: "POST", body: JSON.stringify({ prompt: "x" }) }),
    z.object({ prompt: z.string() }),
    "deck",
  );
}

describe("a bought top-up survives the gate", () => {
  it("refuses at the plan's allowance when nothing was bought", async () => {
    const result = await guardWith({ plan: "basic", used: BASIC_DECKS, creditsGranted: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(429);
  });

  it("lets the request through at the same count when credits were bought", async () => {
    // The defect, stated as behaviour: same plan, same usage, ten presentations
    // paid for. Refusing here is refusing something already sold.
    const result = await guardWith({ plan: "basic", used: BASIC_DECKS, creditsGranted: [10] });
    expect(result.ok, "a purchased top-up must reach the reservation").toBe(true);
  });

  it("refuses again once the credits are used up too", async () => {
    // Ten credits raise the deck ceiling by ten and no further: the top-up is
    // an amount, not an exemption.
    const spent = BASIC_DECKS + 10 * PER_PRESENTATION.deck;
    const result = await guardWith({ plan: "basic", used: spent, creditsGranted: [10] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(429);
  });

  it("raises the coupled pools too, so the extra decks can be illustrated", async () => {
    // A credit that only raised the deck ceiling would sell presentations that
    // could not be finished. Ten credits are a hundred drawings.
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      getCurrentUser: async () => ({ id: "user-1" }),
      supabaseServer: async () =>
        db({ plan: "basic", used: limitFor("basic", "drawing").max, creditsGranted: [10] }),
    }));
    const { guard } = await import("@/lib/ai/route-helpers");
    const result = await guard(
      new Request("https://example.com", { method: "POST", body: JSON.stringify({ prompt: "x" }) }),
      z.object({ prompt: z.string() }),
      "drawing",
    );
    expect(result.ok).toBe(true);
  });
});
