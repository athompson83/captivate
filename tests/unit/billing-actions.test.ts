import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const portalCreate = vi.fn();
const customerCreate = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/billing/stripe", () => ({
  isBillingConfigured: () => true,
  priceIdFor: (plan: "basic" | "pro") => `price_env_${plan === "pro" ? "" : "basic_"}month`,
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
    await startCheckout({ plan: "pro", priceId: "price_attacker_chose_this" });

    const args = create.mock.calls[0][0];
    expect(args.line_items[0].price).toBe("price_env_month");
    expect(JSON.stringify(args)).not.toContain("price_attacker_chose_this");
  });

  it("refuses a tier that is not one of the plans on sale", async () => {
    // The tier is half of what decides the price, so it is validated like the
    // interval rather than trusted. "unlimited" is granted, never bought.
    const { startCheckout } = await import("@/lib/data/billing");
    for (const plan of ["unlimited", "free", "enterprise", ""]) {
      const result = await startCheckout({ plan });
      expect(result.ok, `${plan} should not be purchasable`).toBe(false);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("buys the tier the caller chose, at that tier's own price", async () => {
    const { startCheckout } = await import("@/lib/data/billing");
    await startCheckout({ plan: "basic" });
    expect(create.mock.calls[0][0].line_items[0].price).toBe("price_env_basic_month");
  });

  it("stamps the session with the caller's own id so the webhook can find them", async () => {
    const { startCheckout } = await import("@/lib/data/billing");
    const result = await startCheckout({ plan: "pro" });

    const args = create.mock.calls[0][0];
    expect(args.client_reference_id).toBe("user-1");
    expect(args.metadata.user_id).toBe("user-1");
    expect(args.line_items[0].price).toBe("price_env_month");
    expect(result).toEqual({ ok: true, data: { url: "https://checkout.stripe.com/session" } });
  });

  it("cannot be talked into an annual checkout, however it is asked", async () => {
    // Annual billing is deferred, and deferring it means having no code path
    // that opens one — not a hidden control. An interval in the input is
    // simply not part of the schema any more, so naming one changes nothing.
    const { startCheckout } = await import("@/lib/data/billing");
    await startCheckout({ plan: "pro", interval: "year" });
    expect(create.mock.calls[0][0].line_items[0].price).toBe("price_env_month");
  });

  it("refuses a request that names no plan at all", async () => {
    const { startCheckout } = await import("@/lib/data/billing");
    const result = await startCheckout({ interval: "fortnight" });
    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an error value rather than throwing when Stripe fails", async () => {
    create.mockRejectedValue(new Error("stripe down"));
    const { startCheckout } = await import("@/lib/data/billing");
    expect(await startCheckout({ plan: "pro" })).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });

  it("records a Stripe failure on stderr rather than swallowing it", async () => {
    // A returned failure reaches a toast and nothing else. The first time the
    // upgrade controls were driven on production the customer was created,
    // the session was not, and the only trace had faded by the time anyone
    // looked; this is the line that would have said why.
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(new Error("No such price: 'price_from_the_other_mode'"));
    const { startCheckout } = await import("@/lib/data/billing");
    await startCheckout({ plan: "pro" });

    const line = stderr.mock.calls
      .map((call) => String(call[0]))
      .find((l) => l.includes("billing"));
    expect(line).toContain("billing.checkout");
    expect(line).toContain("No such price");
    stderr.mockRestore();
  });

  it("tells a price Stripe does not recognise apart from an unreachable Stripe", async () => {
    // A price id copied from the wrong Stripe mode fails with the key working
    // and every other page looking right. The user sees the same "nothing
    // happened" either way; the sentence is what sends the operator to the
    // environment rather than the network.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { startCheckout } = await import("@/lib/data/billing");

    create.mockRejectedValue(
      Object.assign(new Error("No such price: 'price_x'"), {
        type: "StripeInvalidRequestError",
        code: "resource_missing",
        param: "line_items[0][price]",
      }),
    );
    const rejected = await startCheckout({ plan: "pro" });
    expect(rejected).toEqual({
      ok: false,
      error: "Stripe doesn't recognise that plan's price. Nothing was charged.",
    });

    create.mockRejectedValue(
      Object.assign(new Error("ECONNRESET"), { type: "StripeConnectionError" }),
    );
    const unreachable = await startCheckout({ plan: "pro" });
    expect(unreachable).toEqual({
      ok: false,
      error: "Couldn't reach Stripe. Nothing was charged.",
    });
    vi.restoreAllMocks();
  });

  it("does not blame Stripe for a failure that was not Stripe's", async () => {
    // The same try block reads the session and the customer mapping. A
    // database outage there must not send the user to Stripe's status page.
    vi.spyOn(console, "error").mockImplementation(() => {});
    customerCreate.mockResolvedValue({ id: "cus_new" });
    maybeSingle.mockRejectedValue(new Error("connection refused"));
    const { startCheckout } = await import("@/lib/data/billing");
    const result = await startCheckout({ plan: "pro" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).not.toMatch(/Stripe/);
    expect(result.ok ? "" : result.error).toContain("Nothing was charged.");
    expect(create).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("reuses an existing Stripe customer instead of minting a second one", async () => {
    maybeSingle.mockResolvedValue({ data: { stripe_customer_id: "cus_existing" } });
    const { startCheckout } = await import("@/lib/data/billing");
    await startCheckout({ plan: "pro" });
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
