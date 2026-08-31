import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const portalCreate = vi.fn();
const customerCreate = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/billing/stripe", () => ({
  isBillingConfigured: () => true,
  priceIdFor: (interval: "month" | "year") =>
    interval === "month" ? "price_env_month" : "price_env_year",
  stripe: () => ({
    checkout: { sessions: { create } },
    billingPortal: { sessions: { create: portalCreate } },
    customers: { create: customerCreate },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "a@b.c" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://captivate.axtevi.com";
  maybeSingle.mockResolvedValue({ data: null });
  customerCreate.mockResolvedValue({ id: "cus_new" });
  create.mockResolvedValue({ url: "https://checkout.stripe.com/session" });
  portalCreate.mockResolvedValue({ url: "https://billing.stripe.com/session" });
});

afterEach(() => vi.clearAllMocks());

describe("startCheckout", () => {
  it("uses the price from the environment, never one supplied by the caller", async () => {
    const { startCheckout } = await import("@/lib/data/billing");
    await startCheckout({ interval: "month", priceId: "price_attacker_chose_this" });

    const args = create.mock.calls[0][0];
    expect(args.line_items[0].price).toBe("price_env_month");
    expect(JSON.stringify(args)).not.toContain("price_attacker_chose_this");
  });

  it("stamps the session with the caller's own id so the webhook can find them", async () => {
    const { startCheckout } = await import("@/lib/data/billing");
    const result = await startCheckout({ interval: "year" });

    const args = create.mock.calls[0][0];
    expect(args.client_reference_id).toBe("user-1");
    expect(args.metadata.user_id).toBe("user-1");
    expect(args.line_items[0].price).toBe("price_env_year");
    expect(result).toEqual({ ok: true, data: { url: "https://checkout.stripe.com/session" } });
  });

  it("refuses an interval that is not month or year", async () => {
    const { startCheckout } = await import("@/lib/data/billing");
    const result = await startCheckout({ interval: "fortnight" });
    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an error value rather than throwing when Stripe fails", async () => {
    create.mockRejectedValue(new Error("stripe down"));
    const { startCheckout } = await import("@/lib/data/billing");
    expect(await startCheckout({ interval: "month" })).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });

  it("reuses an existing Stripe customer instead of minting a second one", async () => {
    maybeSingle.mockResolvedValue({ data: { stripe_customer_id: "cus_existing" } });
    const { startCheckout } = await import("@/lib/data/billing");
    await startCheckout({ interval: "month" });
    expect(customerCreate).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].customer).toBe("cus_existing");
  });
});

describe("openBillingPortal", () => {
  it("opens the caller's own customer, resolved from the session", async () => {
    maybeSingle.mockResolvedValue({ data: { stripe_customer_id: "cus_mine" } });
    const { openBillingPortal } = await import("@/lib/data/billing");
    const result = await openBillingPortal();
    expect(portalCreate.mock.calls[0][0].customer).toBe("cus_mine");
    expect(result).toEqual({ ok: true, data: { url: "https://billing.stripe.com/session" } });
  });

  it("says so plainly when there is nothing to manage yet", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    const { openBillingPortal } = await import("@/lib/data/billing");
    const result = await openBillingPortal();
    expect(result.ok).toBe(false);
    expect(portalCreate).not.toHaveBeenCalled();
  });
});
