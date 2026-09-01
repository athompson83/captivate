import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBillingConfigured, isTestMode, planForPriceId, priceIdFor } from "@/lib/billing/stripe";

// Every variable the module reads. Missing the Basic ones here let one test's
// environment leak into the next.
const KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_BASIC_MONTHLY",
  "STRIPE_PRICE_BASIC_ANNUAL",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_ANNUAL",
] as const;

beforeEach(() => KEYS.forEach((k) => delete process.env[k]));
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("billing configuration", () => {
  it("is unconfigured without a secret key", () => {
    expect(isBillingConfigured()).toBe(false);
  });

  it("is configured with one", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(isBillingConfigured()).toBe(true);
  });

  it("knows a test key from a live one, so the UI can say which it is", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(isTestMode()).toBe(true);
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    expect(isTestMode()).toBe(false);
  });

  it("resolves a price id per tier and interval from the environment", () => {
    process.env.STRIPE_PRICE_BASIC_MONTHLY = "price_basic_month";
    process.env.STRIPE_PRICE_BASIC_ANNUAL = "price_basic_year";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_month";
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_pro_year";

    // Monthly only: annual billing is deferred, so there is no code path that
    // can open an annual checkout. The annual variables are still read, but
    // only by `planForPriceId` below — recognising a price and offering it are
    // different things.
    expect(priceIdFor("basic")).toBe("price_basic_month");
    expect(priceIdFor("pro")).toBe("price_pro_month");
  });

  it("returns null rather than an empty string for an unset price", () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = "   ";
    expect(priceIdFor("pro")).toBeNull();
  });

  it("still resolves an annual subscription's tier, even though annual is not sold", () => {
    // Somebody who bought an annual plan before it was withdrawn keeps it.
    // Failing to recognise their price would drop them to the lowest paid
    // tier, which is a downgrade nobody asked for.
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_pro_year";
    process.env.STRIPE_PRICE_BASIC_ANNUAL = "price_basic_year";
    expect(planForPriceId("price_pro_year")).toBe("pro");
    expect(planForPriceId("price_basic_year")).toBe("basic");
  });

  it("maps a subscription's price back to the tier it bought", () => {
    // The price is the tier. Without this a Basic subscription would grant
    // Pro's allowance, because the mirror row carries a price and nothing else
    // that says which plan it is.
    process.env.STRIPE_PRICE_BASIC_MONTHLY = "price_basic_month";
    process.env.STRIPE_PRICE_BASIC_ANNUAL = "price_basic_year";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_month";
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_pro_year";

    expect(planForPriceId("price_basic_month")).toBe("basic");
    expect(planForPriceId("price_basic_year")).toBe("basic");
    expect(planForPriceId("price_pro_month")).toBe("pro");
    expect(planForPriceId("price_pro_year")).toBe("pro");
  });

  it("keeps recognising a superseded price, so rotating one cannot downgrade anybody", () => {
    // A price in Stripe is immutable: changing what Pro costs means a second
    // price, and everyone already subscribed stays on the first. With one id
    // per variable, rotating it stops this resolving their tier at all and
    // every existing Pro subscriber silently becomes Basic. The list is what
    // stops that, and the head is still what a new checkout is opened against.
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_month_v2, price_pro_month_v1";
    process.env.STRIPE_PRICE_BASIC_MONTHLY = "price_basic_month_v2,price_basic_month_v1";

    expect(priceIdFor("pro")).toBe("price_pro_month_v2");
    expect(planForPriceId("price_pro_month_v2")).toBe("pro");
    expect(planForPriceId("price_pro_month_v1")).toBe("pro");
    expect(planForPriceId("price_basic_month_v1")).toBe("basic");
  });

  it("does not recognise a price this deployment was never told about", () => {
    // A variable that never made it to the environment, or another account's
    // price. `planFromSubscription` reads null as the lowest paid tier, so an
    // unrecognised price cannot quietly grant the highest one.
    process.env.STRIPE_PRICE_BASIC_MONTHLY = "price_basic_month";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_month";

    expect(planForPriceId("price_someone_elses")).toBeNull();
    expect(planForPriceId(null)).toBeNull();
    expect(planForPriceId("  ")).toBeNull();
  });

  it("does not match an unset price to a subscription with no price", () => {
    // Every price variable blank and a row whose price is an empty string
    // would otherwise resolve to whichever tier was checked first.
    for (const key of [
      "STRIPE_PRICE_BASIC_MONTHLY",
      "STRIPE_PRICE_BASIC_ANNUAL",
      "STRIPE_PRICE_PRO_MONTHLY",
      "STRIPE_PRICE_PRO_ANNUAL",
    ]) {
      delete process.env[key];
    }
    expect(planForPriceId("")).toBeNull();
    expect(planForPriceId("anything")).toBeNull();
  });
});
