import { describe, expect, it } from "vitest";
import { readPeriodEndMs, shouldApply, subscriptionPatchFrom } from "@/lib/billing/webhook-events";

const END = 1_800_000_000; // seconds
const EVENT_AT = 1_790_000_000;

const price = { id: "price_month", recurring: { interval: "month" } };
const modern = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: END, price }] },
};

describe("readPeriodEndMs", () => {
  it("reads the item-level period, which is where Stripe moved it", () => {
    expect(readPeriodEndMs(modern)).toBe(END * 1000);
  });

  it("falls back to a subscription-level period for older API versions", () => {
    const legacy = { ...modern, items: { data: [{ price }] }, current_period_end: END };
    expect(readPeriodEndMs(legacy)).toBe(END * 1000);
  });

  it("returns null rather than inventing a timestamp when neither is present", () => {
    // A bogus period end would downgrade somebody who has just paid.
    expect(readPeriodEndMs({ ...modern, items: { data: [{ price }] } })).toBeNull();
  });

  it("survives a payload that is not a subscription at all", () => {
    expect(readPeriodEndMs(null)).toBeNull();
    expect(readPeriodEndMs("nonsense")).toBeNull();
    expect(readPeriodEndMs({ items: {} })).toBeNull();
  });
});

describe("subscriptionPatchFrom", () => {
  it("maps a subscription onto the row the mirror stores", () => {
    expect(subscriptionPatchFrom(modern, EVENT_AT)).toEqual({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      priceId: "price_month",
      billingInterval: "month",
      currentPeriodEnd: new Date(END * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      updatedFromEventAt: new Date(EVENT_AT * 1000).toISOString(),
    });
  });

  it("accepts an expanded customer object as well as an id", () => {
    const expanded = { ...modern, customer: { id: "cus_expanded" } };
    expect(subscriptionPatchFrom(expanded, EVENT_AT)?.stripeCustomerId).toBe("cus_expanded");
  });

  it("returns null for a payload missing what the row requires", () => {
    expect(subscriptionPatchFrom({ id: "sub_1" }, EVENT_AT)).toBeNull();
    expect(subscriptionPatchFrom(null, EVENT_AT)).toBeNull();
  });

  it("keeps a null period end rather than refusing the whole patch", () => {
    const noPeriod = { ...modern, items: { data: [{ price }] } };
    expect(subscriptionPatchFrom(noPeriod, EVENT_AT)?.currentPeriodEnd).toBeNull();
  });

  it("carries a cancellation that is scheduled for the period end", () => {
    const cancelling = { ...modern, cancel_at_period_end: true };
    expect(subscriptionPatchFrom(cancelling, EVENT_AT)?.cancelAtPeriodEnd).toBe(true);
  });
});

describe("shouldApply", () => {
  it("applies the first event a user has", () => {
    expect(shouldApply(null, "2026-09-01T00:00:00.000Z")).toBe(true);
  });

  it("applies a newer event", () => {
    expect(shouldApply("2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z")).toBe(true);
  });

  it("refuses an older event, because Stripe does not guarantee order", () => {
    // A late `deleted` arriving after a re-subscribe would otherwise strand a
    // paying customer on Free.
    expect(shouldApply("2026-09-02T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toBe(false);
  });

  it("applies an event with an identical timestamp, so a redelivery is not lost", () => {
    expect(shouldApply("2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toBe(true);
  });
});
