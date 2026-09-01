import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

/**
 * The webhook route, exercised through a real Stripe signature.
 *
 * `webhook-events.test.ts` covers the shape and ordering logic; this covers
 * the property that logic can never protect — that an unsigned or wrongly
 * signed body is refused before anything is read. The endpoint is public, so
 * this is the only thing standing between a stranger and the subscription
 * table.
 */

const SECRET = "whsec_test_secret_for_signing";

const upsert = vi.fn().mockResolvedValue({ error: null });
const insert = vi.fn().mockResolvedValue({ error: null });
const maybeSingle = vi.fn().mockResolvedValue({ data: null });
/** The claim being given back, so a Stripe retry is not answered as a duplicate. */
const deleteClaim = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      insert,
      upsert,
      select: () => ({ eq: () => ({ maybeSingle }) }),
      delete: () => ({
        eq: (_column: string, id: string) => deleteClaim(table, id),
      }),
    }),
  }),
}));

/** Fails the way a Stripe API call fails: after the claim, before the write. */
const retrieve = vi.fn();
/** How many top-ups one session bought. */
const listLineItems = vi.fn().mockResolvedValue({ data: [{ quantity: 1 }] });

vi.mock("@/lib/billing/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/stripe")>();
  return {
    ...actual,
    // Signature verification stays real — it is what the rest of this file is
    // about — and only the network call is replaced.
    stripe: () => ({
      webhooks: actual.stripe().webhooks,
      subscriptions: { retrieve },
      checkout: { sessions: { listLineItems } },
    }),
  };
});

const signed = (body: unknown, secret = SECRET) => {
  const payload = JSON.stringify(body);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
};

const subscriptionEvent = (over: Record<string, unknown> = {}) => ({
  id: "evt_1",
  type: "customer.subscription.updated",
  created: 1_790_000_000,
  data: {
    object: {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_end: 1_800_000_000,
            price: { id: "price_month", recurring: { interval: "month" } },
          },
        ],
      },
      ...over,
    },
  },
});

const checkoutEvent = () => ({
  id: "evt_checkout",
  type: "checkout.session.completed",
  created: 1_790_000_000,
  data: {
    object: {
      id: "cs_1",
      mode: "subscription",
      subscription: "sub_1",
      client_reference_id: "user-1",
    },
  },
});

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_abc";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: null });
  deleteClaim.mockResolvedValue({ error: null });
  listLineItems.mockResolvedValue({ data: [{ quantity: 1 }] });
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe("the webhook endpoint", () => {
  it("refuses an unsigned request without touching the database", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(new Request("https://example.com", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a body signed with the wrong secret", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(subscriptionEvent(), "whsec_not_our_secret"));
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a body that was altered after signing", async () => {
    const payload = JSON.stringify(subscriptionEvent());
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const tampered = payload.replace('"status":"active"', '"status":"trialing"');

    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(
      new Request("https://example.com", {
        method: "POST",
        headers: { "stripe-signature": header },
        body: tampered,
      }),
    );
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("accepts a properly signed event and mirrors the subscription", async () => {
    maybeSingle.mockResolvedValue({ data: { user_id: "user-1" } });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(subscriptionEvent()));

    expect(response.status).toBe(200);
    const written = upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(written.user_id).toBe("user-1");
    expect(written.status).toBe("active");
    expect(written.billing_interval).toBe("month");
    expect(written.current_period_end).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it("treats a redelivered event as a no-op", async () => {
    // Stripe retries; a retry must not double-apply.
    insert.mockResolvedValue({ error: { code: "23505" } });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(subscriptionEvent()));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("grants a top-up when a delayed payment finally succeeds", async () => {
    // Checkout with an asynchronous payment method *completes* before the money
    // arrives, so the grant is right to refuse an unpaid session — but the
    // event that says it arrived is a different one, and it used to fall
    // through to the ignored default. Somebody was charged and got nothing.
    const paid = {
      id: "evt_async",
      type: "checkout.session.async_payment_succeeded",
      created: 1_790_000_000,
      data: {
        object: {
          id: "cs_async",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_async",
          client_reference_id: "user-1",
        },
      },
    };
    listLineItems.mockResolvedValue({ data: [{ quantity: 1 }] });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(paid));

    expect(response.status).toBe(200);
    const granted = insert.mock.calls.map(([row]) => row as Record<string, unknown>);
    const credit = granted.find((row) => "presentations_granted" in row);
    expect(credit, "the paid session granted nothing").toBeTruthy();
    expect(credit?.stripe_checkout_session_id).toBe("cs_async");
    // Keyed on the session, so the `completed` delivery of the same purchase
    // collides with this rather than granting a second balance.
    expect(credit?.presentations_granted).toBe(10);
  });

  it("grants nothing for the same session while it is still unpaid", async () => {
    const unpaid = {
      id: "evt_async_pending",
      type: "checkout.session.completed",
      created: 1_790_000_000,
      data: {
        object: {
          id: "cs_async",
          mode: "payment",
          payment_status: "unpaid",
          client_reference_id: "user-1",
        },
      },
    };
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(unpaid));

    expect(response.status).toBe(200);
    expect(insert.mock.calls.some(([row]) => "presentations_granted" in (row as object))).toBe(
      false,
    );
  });

  it("gives the claim back when the handler throws, so the retry is not a no-op", async () => {
    // The claim is what makes a redelivery safe, and it is what makes a failed
    // attempt unsafe: without releasing it, Stripe's retry is short-circuited
    // as a duplicate of an event that was never applied, and somebody is billed
    // for a subscription the product never mirrored. Every path that *returns*
    // released already; this is the path that throws.
    retrieve.mockRejectedValue(new Error("stripe unreachable"));
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(checkoutEvent()));

    // 500, so Stripe retries at all.
    expect(response.status).toBe(500);
    // And the claim is gone, so the retry gets past the duplicate check.
    expect(deleteClaim).toHaveBeenCalledWith("stripe_events", "evt_checkout");
  });

  it("refuses to serve at all when billing is unconfigured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(subscriptionEvent()));
    expect(response.status).toBe(503);
  });
});
