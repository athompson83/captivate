import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBillingConfigured, isTestMode, priceIdFor } from "@/lib/billing/stripe";

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

  it("resolves a price id per interval from the environment", () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_month";
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_year";
    expect(priceIdFor("month")).toBe("price_month");
    expect(priceIdFor("year")).toBe("price_year");
  });

  it("returns null rather than an empty string for an unset price", () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = "   ";
    expect(priceIdFor("month")).toBeNull();
    expect(priceIdFor("year")).toBeNull();
  });
});
