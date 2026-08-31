import "server-only";

import Stripe from "stripe";

/**
 * The Stripe boundary.
 *
 * `server-only` because this module reads the secret key: an accidental client
 * import becomes a build error rather than a leaked key.
 *
 * No `apiVersion` is pinned here. The installed SDK pins its own, and naming a
 * version string the SDK does not know is a startup error for no benefit.
 * Where an API shape has moved between versions the code reads it defensively
 * instead — see `readPeriodEndMs`.
 */

let client: Stripe | null = null;

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/** True when the configured key is a test key, so the UI can say so. */
export function isTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test");
}

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set. This code path requires billing.");
  }
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

/**
 * The price for an interval, from the environment.
 *
 * The *only* place a price id enters the system. A checkout that accepted a
 * price from its caller would let anyone choose what they pay.
 */
export function priceIdFor(interval: "month" | "year"): string | null {
  const raw =
    interval === "month"
      ? process.env.STRIPE_PRICE_PRO_MONTHLY
      : process.env.STRIPE_PRICE_PRO_ANNUAL;
  return raw?.trim() || null;
}
