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

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert,
      upsert,
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));

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

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_abc";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: null });
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

  it("refuses to serve at all when billing is unconfigured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(signed(subscriptionEvent()));
    expect(response.status).toBe(503);
  });
});
