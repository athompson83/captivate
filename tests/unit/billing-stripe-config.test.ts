import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBillingConfigured, isTestMode, planForPriceId, priceIdFor } from "@/lib/billing/stripe";

const KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_ANNUAL"] as const;

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

    expect(priceIdFor("basic", "month")).toBe("price_basic_month");
    expect(priceIdFor("basic", "year")).toBe("price_basic_year");
    expect(priceIdFor("pro", "month")).toBe("price_pro_month");
    expect(priceIdFor("pro", "year")).toBe("price_pro_year");
  });

  it("returns null rather than an empty string for an unset price", () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = "   ";
    delete process.env.STRIPE_PRICE_PRO_ANNUAL;
    expect(priceIdFor("pro", "month")).toBeNull();
    expect(priceIdFor("pro", "year")).toBeNull();
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

  it("does not recognise a price this deployment was never told about", () => {
    // A rotated price, or a variable that never made it to the environment.
    // `planFromSubscription` reads null as the lowest paid tier, so an
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
