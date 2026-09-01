/**
 * What each plan is allowed to do.
 *
 * Pure and isomorphic on purpose: the pricing page renders this copy, the
 * entitlement gate reads these budgets, and the tests import it directly.
 * Nothing here touches Stripe, Supabase or the network — which is also why it
 * is safe to import from a client component.
 */

/**
 * `unlimited` is not bought — it is granted (`plan_grants`), for the people who
 * run Captivate, a support case, or an institution running a pilot. It is not
 * literally without limit: every call still passes the reservation, because an
 * uncounted call is also an unrecorded cost, and the ledger is how spend is
 * seen at all. The ceilings are simply set where ordinary use never reaches
 * them.
 */
export type Plan = "free" | "basic" | "pro" | "unlimited";

/** The plans somebody can actually buy, cheapest first. */
export const PAID_PLANS = ["basic", "pro"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

/**
 * The budget a call draws on. Named for what it bounds rather than for a price
 * tier, because a group means the same thing on both plans.
 */
export type BudgetGroup = "deck" | "draft" | "drawing" | "light";

export interface RateLimit {
  windowMinutes: number;
  max: number;
}

/**
 * Every ceiling a call has to clear, allowance first.
 *
 * There are two on a paid plan and they answer different questions. The
 * allowance is what was bought and what drains — the number in settings, the
 * one a top-up adds to. The burst ceiling is abuse protection: it is not a
 * product promise, and nobody reaches it in a day's work. Selling a month's
 * worth and metering it by the hour, which is what this used to do, gives an
 * author no way to see what they have left and nothing for a top-up to top up.
 */
export type Budget = readonly [allowance: RateLimit, ...burst: RateLimit[]];

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
const month = (max: number): RateLimit => ({ windowMinutes: THIRTY_DAYS, max });
const hour = (max: number): RateLimit => ({ windowMinutes: ONE_HOUR, max });

/**
 * Paid plans are sold by the month and protected by the hour.
 *
 * Both ratios in the pricing change are relative to what Pro *used to
 * advertise*: the new Pro is half of it, and Basic is fifteen per cent of it.
 * So against each other Basic is thirty per cent of Pro, and that one
 * relationship holds on both ceilings rather than the burst and the allowance
 * drifting apart.
 *
 * The hourly numbers are those percentages applied directly, because the
 * hourly cap is what Pro advertised. The monthly allowances are new — there
 * was no monthly number to take a percentage of — so they are chosen to keep
 * the same thirty per cent, and to make a ladder that reads honestly in money:
 * 20c a presentation on Basic, 12.5c on Pro, and 50c to top up.
 *
 * Free is unchanged. It was already sold by the month, and it is the floor
 * every paid tier has to be worth more than: 60 decks against 10.
 */
export const PLAN_BUDGETS: Record<Plan, Record<BudgetGroup, Budget>> = {
  free: {
    // Raised with the pooling below: a group is now one shared count rather
    // than a number each kind inside it got separately, so these are the old
    // per-kind ceilings added up rather than a new policy.
    deck: [month(10)],
    draft: [month(40)],
    drawing: [month(20)],
    light: [month(100)],
  },
  basic: {
    deck: [month(60), hour(5)],
    draft: [month(120), hour(9)],
    drawing: [month(60), hour(5)],
    light: [month(600), hour(45)],
  },
  pro: {
    deck: [month(200), hour(15)],
    draft: [month(400), hour(30)],
    drawing: [month(200), hour(15)],
    light: [month(2000), hour(150)],
  },
  unlimited: {
    deck: [month(10_000), hour(500)],
    draft: [month(20_000), hour(1000)],
    drawing: [month(10_000), hour(500)],
    light: [month(100_000), hour(5000)],
  },
};

/** The allowance: what was bought, what drains, what a top-up adds to. */
export function limitFor(plan: Plan, group: BudgetGroup): RateLimit {
  return PLAN_BUDGETS[plan][group][0];
}

/** Every ceiling the call has to clear, allowance included. */
export function ceilingsFor(plan: Plan, group: BudgetGroup): readonly RateLimit[] {
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
  return plan !== "free";
}

/**
 * What a top-up buys.
 *
 * Ten presentations for five dollars, which is deliberately worse value per
 * deck than either paid tier — fifty cents against Basic's forty and Pro's
 * twelve and a half. A top-up is for the month somebody went over, not a way
 * to live below the tier they actually need.
 *
 * It adds to the deck allowance only. The other groups are large enough
 * relative to it that a deck's worth of drafts and drawings is already
 * covered, and metering four balances is a worse product than metering one.
 *
 * Not purchasable yet — there is no Checkout price, no credit balance and no
 * webhook that grants one. It is the agreed shape of the top-up, kept here so
 * the tier economics can be reasoned about and tested against, and it is
 * deliberately not rendered anywhere a user can see: a control that looks
 * buyable and is not is worse than its absence.
 */
export const TOPUP = { price: "$5", decks: 10 } as const;

/**
 * The plan a grant carries, if it is still in force.
 *
 * A grant outranks a subscription rather than merging with it: somebody with
 * both should get the better of the two, and the granted plan is always at
 * least Pro. An expiry in the past is simply not a grant any more.
 */
export function planFromGrant(
  grant: { plan: string; expiresAtMs: number | null } | null,
  nowMs: number,
): Plan | null {
  if (!grant) return null;
  if (grant.expiresAtMs !== null && grant.expiresAtMs <= nowMs) return null;
  return grant.plan === "unlimited" ? "unlimited" : grant.plan === "pro" ? "pro" : null;
}

/** How a plan is described where the holder can see it. */
export function planLabel(plan: Plan): string {
  switch (plan) {
    case "unlimited":
      return "Unlimited";
    case "pro":
      return "Captivate Pro";
    case "basic":
      return "Captivate Basic";
    default:
      return "Free";
  }
}

/**
 * Display copy. The amounts live in Stripe; these must be kept in step.
 *
 * The annual figures are the monthly ones at the same third off the plan
 * already carried, which is the one number here that was not specified.
 */
export const PRICING: Record<PaidPlan, { monthly: string; annual: string; saving: number }> = {
  basic: { monthly: "$12", annual: "$96", saving: 33 },
  pro: { monthly: "$25", annual: "$200", saving: 33 },
};

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
  subscription: {
    status: string;
    currentPeriodEndMs: number | null;
    /**
     * Which tier was bought, resolved from the price the subscription is for.
     * Null when the row predates the column or names a price this deployment
     * does not know, and then it is Basic — the *lowest* paid tier. Guessing
     * upward would hand somebody Pro for Basic's money on nothing more than a
     * stale environment variable.
     */
    plan: PaidPlan | null;
  } | null,
  nowMs: number,
): Plan {
  if (!subscription) return "free";
  const bought: Plan = subscription.plan ?? "basic";
  if (subscription.status === "active" || subscription.status === "trialing") return bought;
  if (subscription.status === "past_due") {
    return subscription.currentPeriodEndMs === null || subscription.currentPeriodEndMs > nowMs
      ? bought
      : "free";
  }
  return "free";
}

/** Kept for the copy that still names Pro's price directly. */
export const PRO_PRICING = {
  monthly: PRICING.pro.monthly,
  annual: PRICING.pro.annual,
  annualSavingPercent: PRICING.pro.saving,
} as const;

export const FREE_ALLOWANCE_COPY = "10 presentations generated in any 30 days";
