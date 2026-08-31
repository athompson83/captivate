/**
 * What each plan is allowed to do.
 *
 * Pure and isomorphic on purpose: the pricing page renders this copy, the
 * entitlement gate reads these budgets, and the tests import it directly.
 * Nothing here touches Stripe, Supabase or the network — which is also why it
 * is safe to import from a client component.
 */

export type Plan = "free" | "pro";

/**
 * The budget a call draws on. Named for what it bounds rather than for a price
 * tier, because a group means the same thing on both plans.
 */
export type BudgetGroup = "deck" | "draft" | "drawing" | "light";

export interface RateLimit {
  windowMinutes: number;
  max: number;
}

const THIRTY_DAYS = 30 * 24 * 60;
const ONE_HOUR = 60;

/**
 * Free is counted in *generated presentations*, not model calls.
 *
 * One deck is already a map call, a scenes call and several drawings. Counting
 * calls would spend a whole month's allowance on a single presentation and read
 * as a bait-and-switch, so `deck` counts the scenes pass — exactly one row per
 * deck — and the other groups carry their own ceilings so no account can run up
 * unbounded spend through a side door.
 *
 * The window is rolling, not calendar. Every string shown to a user therefore
 * says "in the last 30 days"; describing it as monthly would be a lie about
 * billing.
 */
export const PLAN_BUDGETS: Record<Plan, Record<BudgetGroup, RateLimit>> = {
  free: {
    deck: { windowMinutes: THIRTY_DAYS, max: 10 },
    // Raised with the pooling below: a group is now one shared count rather
    // than a number each kind inside it got separately, so these are the old
    // per-kind ceilings added up rather than a new policy.
    draft: { windowMinutes: THIRTY_DAYS, max: 40 },
    drawing: { windowMinutes: THIRTY_DAYS, max: 20 },
    light: { windowMinutes: THIRTY_DAYS, max: 100 },
  },
  pro: {
    deck: { windowMinutes: ONE_HOUR, max: 30 },
    draft: { windowMinutes: ONE_HOUR, max: 60 },
    drawing: { windowMinutes: ONE_HOUR, max: 30 },
    light: { windowMinutes: ONE_HOUR, max: 300 },
  },
};

export function limitFor(plan: Plan, group: BudgetGroup): RateLimit {
  return PLAN_BUDGETS[plan][group];
}

/**
 * Which ledger kinds each group counts.
 *
 * One definition, because two of them diverged and cost an author their
 * allowance: the create route's pre-filter charged the deck budget for `map`
 * rows, so every *draft* proposal on /new — budgeted separately, and cheap —
 * spent one of the ten decks a Free account is sold, and the author was
 * refused at the moment of creating anything while the settings page still
 * read three of ten. A group is a budget *and* what draws on it; neither half
 * means anything alone.
 */
export const BUDGET_KINDS: Record<BudgetGroup, string[]> = {
  deck: ["scenes", "presentation"],
  draft: ["map", "scene"],
  drawing: ["drawing"],
  light: ["moment", "rewrite", "speaker_notes", "visuals", "flow"],
};

/** Paid image generation is the one capability Free does not have at all. */
export function allowsImageGeneration(plan: Plan): boolean {
  return plan === "pro";
}

/**
 * The plan a mirrored subscription row grants.
 *
 * `active` and `trialing` are Pro on the status alone. Requiring a future
 * period end would downgrade a paying customer for as long as a renewal webhook
 * took to arrive, and Stripe — not our copy of its timestamp — is the authority
 * on whether a subscription is live.
 *
 * `past_due` is graced until the period ends: dunning is still retrying the
 * card, and cutting someone off mid-cycle over a temporary decline is hostile.
 * When dunning gives up Stripe moves the subscription to `canceled` or
 * `unpaid`, which land here as free.
 *
 * A null period end means "trust the status" — see `readPeriodEndMs`. Anything
 * unrecognised is free: this fails closed, because failing open is how a bug
 * becomes free Pro for everybody.
 */
export function planFromSubscription(
  subscription: { status: string; currentPeriodEndMs: number | null } | null,
  nowMs: number,
): Plan {
  if (!subscription) return "free";
  if (subscription.status === "active" || subscription.status === "trialing") return "pro";
  if (subscription.status === "past_due") {
    return subscription.currentPeriodEndMs === null || subscription.currentPeriodEndMs > nowMs
      ? "pro"
      : "free";
  }
  return "free";
}

/** Display copy. The amounts live in Stripe; these must be kept in step. */
export const PRO_PRICING = {
  monthly: "$12",
  annual: "$96",
  annualSavingPercent: 33,
} as const;

export const FREE_ALLOWANCE_COPY = "10 presentations generated in any 30 days";
