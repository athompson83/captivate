/**
 * What each plan is allowed to do.
 *
 * Pure and isomorphic on purpose: the pricing page renders this copy, the
 * entitlement gate reads these budgets, and the tests import it directly.
 * Nothing here touches Stripe, Supabase or the network — which is also why it
 * is safe to import from a client component.
 *
 * Everything below derives from two tables: how many presentations a plan is
 * sold, and how much of each pool one presentation can consume. Nothing is
 * written twice. A comment here once claimed Basic cost forty cents a
 * presentation when the constants said twenty, and the comment was believed
 * because it was the only place the sum appeared.
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

export const BUDGET_GROUPS = ["deck", "draft", "drawing", "light"] as const;

export interface RateLimit {
  windowMinutes: number;
  max: number;
}

/**
 * Every ceiling a call has to clear, allowance first.
 *
 * The allowance is what was bought and what drains — the number in settings,
 * the one a top-up adds to. The burst ceiling is abuse protection: it is not a
 * product promise, nobody reaches it in a day's work, and it cannot be bought.
 * Selling a month's worth and metering it by the hour, which is what this used
 * to do, gives an author no way to see what they have left and nothing for a
 * top-up to top up.
 */
export type Budget = readonly [allowance: RateLimit, ...burst: RateLimit[]];

const THIRTY_DAYS = 30 * 24 * 60;
const ONE_HOUR = 60;

const month = (max: number): RateLimit => ({ windowMinutes: THIRTY_DAYS, max });
const hour = (max: number): RateLimit => ({ windowMinutes: ONE_HOUR, max });

/**
 * How much of each pool one complete presentation can consume.
 *
 * These are *caps*, not averages, and that is the point. Generating a
 * presentation is a map call, a scenes call and a staged drawing for every ten
 * minutes of talk — up to ten of them on a deployment with no photo provider,
 * where drawings are the only pictures there are. A plan whose drawing pool is
 * the same size as its deck pool sells N presentations and can only illustrate
 * one of them, which is what the previous shape did: sixty decks and sixty
 * drawings. The pools are coupled, so they are sized together.
 *
 * `light` is the after-the-fact work on a deck somebody just made — speaker
 * notes, a rewrite, a visual suggestion. Ten per presentation is generous
 * because each one is a short call.
 */
export const PER_PRESENTATION: Record<BudgetGroup, number> = {
  deck: 1,
  draft: 2,
  drawing: 10,
  light: 10,
};

/**
 * The one number a plan is sold on: presentations in any rolling 30 days.
 *
 * Rolling, not calendar. Every string shown to a user therefore says "in the
 * last 30 days"; describing it as monthly would be a lie about billing.
 */
export const PRESENTATIONS: Record<Plan, number> = {
  free: 10,
  basic: 25,
  pro: 60,
  unlimited: 2000,
};

/**
 * Presentations an hour — the burst ceiling, in the same currency as the
 * allowance so the two cannot drift apart.
 *
 * Nobody authors five presentations in an hour; a script does. Free carries
 * one too, because a free account is the cheapest thing in the world to
 * create and its pools are now large enough to be worth draining.
 */
const BURST_PRESENTATIONS: Record<Plan, number> = {
  free: 3,
  basic: 5,
  pro: 10,
  unlimited: 200,
};

const budgetFor = (plan: Plan, group: BudgetGroup): Budget => [
  month(PRESENTATIONS[plan] * PER_PRESENTATION[group]),
  hour(BURST_PRESENTATIONS[plan] * PER_PRESENTATION[group]),
];

export const PLAN_BUDGETS: Record<Plan, Record<BudgetGroup, Budget>> = {
  free: {
    deck: budgetFor("free", "deck"),
    draft: budgetFor("free", "draft"),
    drawing: budgetFor("free", "drawing"),
    light: budgetFor("free", "light"),
  },
  basic: {
    deck: budgetFor("basic", "deck"),
    draft: budgetFor("basic", "draft"),
    drawing: budgetFor("basic", "drawing"),
    light: budgetFor("basic", "light"),
  },
  pro: {
    deck: budgetFor("pro", "deck"),
    draft: budgetFor("pro", "draft"),
    drawing: budgetFor("pro", "drawing"),
    light: budgetFor("pro", "light"),
  },
  unlimited: {
    deck: budgetFor("unlimited", "deck"),
    draft: budgetFor("unlimited", "draft"),
    drawing: budgetFor("unlimited", "drawing"),
    light: budgetFor("unlimited", "light"),
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
 * What a plan costs a month, in cents. The amounts live in Stripe; these must
 * be kept in step.
 *
 * Monthly only. Annual billing is deferred until there is enough measured cost
 * per presentation to know an annual price is not a year-long commitment to an
 * unprofitable one — a decision that cannot be unwound for anybody who has
 * already paid. There is deliberately no annual figure here to render: copy
 * that offers a plan the checkout will refuse is worse than no copy.
 */
export const MONTHLY_CENTS: Record<PaidPlan, number> = {
  basic: 1200,
  pro: 2500,
};

/** What a top-up costs and buys. */
export const TOPUP = {
  cents: 500,
  presentations: 10,
  /** Credits are usable for this long, and the copy has to say so. */
  validDays: 30,
} as const;

/** `1234` → `"$12.34"`, and `1200` → `"$12"`. Money is formatted in one place. */
export function money(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * What one presentation costs on a plan, in cents.
 *
 * Derived, never written down. The ladder it produces is the product decision
 * — Basic is the convenient tier, Pro is better value per presentation, and a
 * top-up is dearer than both so it stays the answer to a month somebody went
 * over rather than a way to live below the tier they need. `billing-plans`
 * asserts that ordering rather than trusting it.
 */
export function centsPerPresentation(plan: PaidPlan): number {
  return MONTHLY_CENTS[plan] / PRESENTATIONS[plan];
}

export function topUpCentsPerPresentation(): number {
  return TOPUP.cents / TOPUP.presentations;
}

/** Display copy for the paid tiers. */
export const PRICING: Record<PaidPlan, { monthly: string }> = {
  basic: { monthly: money(MONTHLY_CENTS.basic) },
  pro: { monthly: money(MONTHLY_CENTS.pro) },
};

/**
 * The plan a mirrored subscription row grants.
 *
 * `active` and `trialing` are the bought plan on the status alone. Requiring a
 * future period end would downgrade a paying customer for as long as a renewal
 * webhook took to arrive, and Stripe — not our copy of its timestamp — is the
 * authority on whether a subscription is live.
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
     * Which tier was bought. Resolved from the price when the webhook wrote
     * the row and stored alongside it, so a price this deployment no longer
     * names still resolves to the tier its holder paid for. Null only for a
     * row written before that column existed, and then it is Basic — the
     * *lowest* paid tier. Guessing upward would hand somebody Pro for Basic's
     * money on nothing more than a stale environment variable.
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

export const FREE_ALLOWANCE_COPY = `${PRESENTATIONS.free} presentations generated in any 30 days`;
