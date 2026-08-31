/**
 * Turning a Stripe subscription into the row the mirror stores.
 *
 * Pure and free of IO, so every ordering and shape decision is unit-testable
 * without a webhook, a signature or a database — which leaves the route itself
 * thin enough to read in one sitting.
 */

export interface SubscriptionPatch {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  priceId: string;
  billingInterval: "month" | "year";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedFromEventAt: string;
}

type Bag = Record<string, unknown>;

const asRecord = (value: unknown): Bag | null =>
  typeof value === "object" && value !== null ? (value as Bag) : null;

const firstItem = (subscription: Bag): Bag | null => {
  const items = asRecord(subscription.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  return asRecord(data[0]);
};

/**
 * When the current period ends, in milliseconds — or null.
 *
 * Recent Stripe API versions removed `current_period_end` from the
 * Subscription object and moved it onto the subscription *item*. Reading only
 * the old location silently yields undefined, and writing that as a timestamp
 * would downgrade a customer who has just paid. So: item first, subscription
 * second, and null when neither is present — a null period end means "trust
 * the status" everywhere downstream.
 */
export function readPeriodEndMs(subscription: unknown): number | null {
  const sub = asRecord(subscription);
  if (!sub) return null;

  const fromItem = firstItem(sub)?.current_period_end;
  if (typeof fromItem === "number") return fromItem * 1000;

  const fromSub = sub.current_period_end;
  if (typeof fromSub === "number") return fromSub * 1000;

  return null;
}

/** The row a subscription event should write, or null if the payload cannot fill it. */
export function subscriptionPatchFrom(
  subscription: unknown,
  eventCreatedSeconds: number,
): SubscriptionPatch | null {
  const sub = asRecord(subscription);
  if (!sub) return null;

  const id = typeof sub.id === "string" ? sub.id : null;
  const customerId = asRecord(sub.customer)?.id;
  const customer =
    typeof sub.customer === "string"
      ? sub.customer
      : typeof customerId === "string"
        ? customerId
        : null;
  const status = typeof sub.status === "string" ? sub.status : null;

  const price = asRecord(firstItem(sub)?.price);
  const priceId = typeof price?.id === "string" ? price.id : null;
  const interval = asRecord(price?.recurring)?.interval;
  const billingInterval = interval === "year" ? "year" : interval === "month" ? "month" : null;

  if (!id || !customer || !status || !priceId || !billingInterval) return null;

  const periodEndMs = readPeriodEndMs(sub);

  return {
    stripeCustomerId: customer,
    stripeSubscriptionId: id,
    status,
    priceId,
    billingInterval,
    currentPeriodEnd: periodEndMs === null ? null : new Date(periodEndMs).toISOString(),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    updatedFromEventAt: new Date(eventCreatedSeconds * 1000).toISOString(),
  };
}

/**
 * Whether an incoming event is newer than what the row was last written from.
 *
 * Stripe does not guarantee delivery order. An equal timestamp applies, so a
 * redelivery of the newest event is not silently dropped.
 */
export function shouldApply(
  storedUpdatedFromEventAt: string | null,
  incomingUpdatedFromEventAt: string,
): boolean {
  if (!storedUpdatedFromEventAt) return true;
  return Date.parse(incomingUpdatedFromEventAt) >= Date.parse(storedUpdatedFromEventAt);
}
