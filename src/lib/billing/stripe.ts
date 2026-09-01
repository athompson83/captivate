import "server-only";

import { PAID_PLANS, type PaidPlan } from "./plans";

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
 * The price ids for a plan and an interval, current first.
 *
 * The *only* place a price id enters the system. A checkout that accepted a
 * price from its caller would let anyone choose what they pay.
 *
 * Each variable may hold a comma-separated list, newest first, because a price
 * in Stripe is immutable: changing what Basic costs means creating a second
 * price, and every subscription already sold stays on the old one. With a
 * single value, rotating the variable stops `planForPriceId` recognising those
 * subscribers at all, and they quietly land on the lowest paid tier — a
 * downgrade nobody asked for and nothing reports. Listing the superseded ids
 * after the current one keeps them recognised as the tier they bought while
 * new checkouts go to the price at the head.
 */
function priceIdsFor(plan: PaidPlan, interval: "month" | "year"): string[] {
  const raw =
    plan === "basic"
      ? interval === "month"
        ? process.env.STRIPE_PRICE_BASIC_MONTHLY
        : process.env.STRIPE_PRICE_BASIC_ANNUAL
      : interval === "month"
        ? process.env.STRIPE_PRICE_PRO_MONTHLY
        : process.env.STRIPE_PRICE_PRO_ANNUAL;
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** The price a new checkout is opened against: the head of the list. */
export function priceIdFor(plan: PaidPlan, interval: "month" | "year"): string | null {
  return priceIdsFor(plan, interval)[0] ?? null;
}

/**
 * Which tier a subscription's price belongs to.
 *
 * The mirror table has carried `price_id` since billing was built and nothing
 * read it, because there was only ever one paid plan to be on. With two, the
 * price *is* the tier, and reading it is what stops a Basic subscription
 * granting Pro's allowance.
 *
 * Superseded ids count, which is the whole reason the variables are lists.
 * Null only for a price no variable names at all, and `planFromSubscription`
 * reads that as the lowest paid tier rather than the highest.
 */
export function planForPriceId(priceId: string | null): PaidPlan | null {
  if (!priceId) return null;
  const id = priceId.trim();
  if (!id) return null;

  for (const plan of PAID_PLANS) {
    for (const interval of ["month", "year"] as const) {
      if (priceIdsFor(plan, interval).includes(id)) return plan;
    }
  }
  return null;
}
