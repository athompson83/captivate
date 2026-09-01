import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { usedGenerations } from "@/lib/ai/rate-limit";
import type { PaidPlan } from "./plans";
import {
  BUDGET_KINDS,
  PER_PRESENTATION,
  ceilingsFor,
  limitFor,
  planFromGrant,
  planFromSubscription,
  type BudgetGroup,
  type Plan,
  type RateLimit,
} from "./plans";

const PLANS = new Set<Plan>(["free", "basic", "pro", "unlimited"]);

/**
 * Which plan the signed-in caller is on.
 *
 * Asked of the database, because the database is what enforces it. The
 * resolution used to live here — grant first, then the subscription mirror,
 * then a fallback — and `captivate_reserve_generation` was handed the answer
 * as a ceiling to apply. That made this function the gate, and it was reachable
 * only if the caller chose to go through the application: the same RPC issued
 * from a browser could name any ceiling it liked. The resolution now lives in
 * `captivate_current_plan`, and this reads it so that what settings shows and
 * what the reservation enforces are the same sentence rather than two
 * implementations of one rule that agreed until they didn't.
 *
 * Fails closed. A read error is free, because failing open is how a bug
 * becomes free Pro for everybody.
 *
 * A deployment with no Stripe keys has no subscriptions and so is on Free.
 * That used to be special-cased to Pro here — a deployment that cannot charge
 * must not throttle — but the database cannot see an environment variable, and
 * a rule the enforcement layer does not know is not a rule. `plan_grants`
 * exists for exactly this and is honoured by both: a self-hosted deployment
 * grants itself `unlimited` in one row, visibly, rather than relying on a
 * fallback nobody can see. See `docs/DEPLOYMENT.md`.
 */
export async function currentPlan(): Promise<Plan> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("captivate_current_plan");
    if (error || typeof data !== "string" || !PLANS.has(data as Plan)) return "free";
    return data as Plan;
  } catch {
    return "free";
  }
}

/** The allowance this caller's plan grants for one group of calls. */
export async function limitForCaller(group: BudgetGroup): Promise<RateLimit> {
  return limitFor(await currentPlan(), group);
}

/**
 * Every ceiling the caller has to clear, allowance first — credits included.
 *
 * The credits matter here specifically because this is a *pre-filter*. The
 * reservation is the authority and it adds the top-up headroom itself, but it
 * is only reached if this lets the request through: without the same headroom,
 * an author at their plan's allowance was answered 429 before the statement
 * that would have spent the credit they had just bought. Ten presentations,
 * paid for, unreachable.
 *
 * The arithmetic mirrors `captivate_reserve_generation` exactly — one credit is
 * one presentation, worth `PER_PRESENTATION[group]` of this pool — and it is
 * keyed on what was *granted* rather than what remains, for the same reason:
 * spending a credit both lowers the balance and raises the count, so a ceiling
 * keyed on the remainder closes from both ends.
 */
export async function ceilingsForCaller(group: BudgetGroup): Promise<readonly RateLimit[]> {
  const plan = await currentPlan();
  const [allowance, ...burst] = ceilingsFor(plan, group);

  // The deck allowance is not decided here any more.
  //
  // `captivate_reserve_generation` measures what the *plan* granted against
  // what was drawn from the plan, ignoring rows a credit paid for. This cannot:
  // it has one number, the total count, and no way to tell the two apart. So
  // the two disagree exactly when it matters — an author spends credits, keeps
  // using base slots as they renew, and their purchase expires while its
  // credited rows are still inside the rolling window. The headroom here drops
  // to the plan's allowance while those rows are still being counted against
  // it, and a 429 is returned from in front of the statement that would have
  // said yes. A renewed allowance, refused, with nothing to buy that fixes it.
  //
  // Deferring is safe because the reservation refuses in the same words: the
  // row it returns names the ceiling and the window, and `reserve` renders it.
  // The cost is one round trip on a request that was going to be refused, and
  // the gain is a single authority for a rule that has now drifted twice.
  if (group === "deck") return burst;

  // Read only where it is used. Deck is the most frequent group by some way and
  // returns above, so fetching the balance before that branch spent an
  // `auth.getUser` and a `generation_credits` query on every deck request to
  // throw the answer away.
  const credits = await grantedCredits();

  // Every other pool is *raised* by a purchase rather than spent from, and the
  // reservation computes the same figure from the same inputs, so this can
  // still answer early without risk of being stricter than the authority.
  if (credits <= 0) return [allowance, ...burst];
  return [
    { ...allowance, max: allowance.max + credits * PER_PRESENTATION[group] },
    // A purchase does not raise the burst ceiling. That is abuse protection
    // rather than something bought, and a top-up buys quantity, not speed.
    ...burst,
  ];
}

export interface GrantSummary {
  plan: Plan;
  note: string;
  expiresAt: string | null;
}

/**
 * The grant on this account, if any, for the settings page to name.
 *
 * A granted plan must never be presented as a subscription: somebody comped
 * should not be shown a renewal date they do not have, nor an upgrade button
 * for a plan they already exceed.
 */
export async function grantSummary(): Promise<GrantSummary | null> {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("plan_grants")
      .select("plan, note, expires_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) return null;

    const plan = planFromGrant(
      { plan: data.plan, expiresAtMs: data.expires_at ? Date.parse(data.expires_at) : null },
      Date.now(),
    );
    if (!plan) return null;

    return { plan, note: data.note, expiresAt: data.expires_at };
  } catch {
    return null;
  }
}

export interface SubscriptionSummary {
  plan: Plan;
  status: string;
  billingInterval: "month" | "year";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** Everything the settings page needs to describe the caller's subscription. */
export async function subscriptionSummary(): Promise<SubscriptionSummary | null> {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, plan, billing_interval, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return null;

    return {
      // The stored tier, not one re-derived from the price. A Stripe price is
      // immutable, so raising Pro's price means a new price and a rotated
      // variable — and from that moment re-deriving would resolve the old
      // price to nothing and quietly move its holder to the lowest paid tier.
      // The webhook resolved it once, when it wrote the row.
      plan: planFromSubscription(
        {
          status: data.status,
          currentPeriodEndMs: data.current_period_end ? Date.parse(data.current_period_end) : null,
          plan: (data.plan as PaidPlan | null) ?? null,
        },
        Date.now(),
      ),
      status: data.status,
      billingInterval: data.billing_interval,
      currentPeriodEnd: data.current_period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
    };
  } catch {
    return null;
  }
}

/**
 * How much of the free allowance the caller has spent.
 *
 * Counted the same way the limiter counts it — the same kinds, the same
 * window, the same database function — so the number shown in settings and the
 * number enforced at the gate can never disagree. It did: settings read three
 * of ten while the gate refused at ten, because the two were counting
 * different kinds.
 *
 * It lives here rather than in the page because reading the clock during a
 * component render is impure, and because how an allowance is counted is this
 * module's business rather than a page's.
 */
export interface GroupUsage {
  group: BudgetGroup;
  label: string;
  used: number;
  allowance: number;
  windowMinutes: number;
}

/** What each group is called where somebody is looking at their own usage. */
const GROUP_LABELS: Record<BudgetGroup, string> = {
  deck: "Presentations generated",
  draft: "Narrative maps and single scenes",
  drawing: "Staged drawings",
  light: "Rewrites, notes and suggestions",
};

/**
 * Every allowance the caller has, and how much of each is spent.
 *
 * Counted the same way the limiter counts it — the same kinds, the same
 * window, the same database function — so the number shown in settings and the
 * number enforced at the gate can never disagree. It did: settings read three
 * of ten while the gate refused at ten, because the two were counting
 * different kinds.
 *
 * All four groups rather than just decks. An author refused a rewrite while
 * settings shows only a deck count has no way to find out why, which is the
 * same complaint the deck counter was added to answer.
 *
 * It lives here rather than in the page because reading the clock during a
 * component render is impure, and because how an allowance is counted is this
 * module's business rather than a page's.
 */
export async function planUsage(): Promise<{ plan: Plan; groups: GroupUsage[] }> {
  const plan = await currentPlan();

  const empty = (): GroupUsage[] =>
    (Object.keys(GROUP_LABELS) as BudgetGroup[]).map((group) => {
      const budget = limitFor(plan, group);
      return {
        group,
        label: GROUP_LABELS[group],
        used: 0,
        allowance: budget.max,
        windowMinutes: budget.windowMinutes,
      };
    });

  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { plan, groups: empty() };

    const groups = await Promise.all(
      (Object.keys(GROUP_LABELS) as BudgetGroup[]).map(async (group) => {
        const budget = limitFor(plan, group);
        const used = await usedGenerations(BUDGET_KINDS[group], budget.windowMinutes);
        return {
          group,
          label: GROUP_LABELS[group],
          used: used ?? 0,
          allowance: budget.max,
          windowMinutes: budget.windowMinutes,
        };
      }),
    );
    return { plan, groups };
  } catch {
    return { plan, groups: empty() };
  }
}

/**
 * Presentations bought and still live, spent or not.
 *
 * What the *ceiling* is raised by, as opposed to what is left to spend. See
 * `ceilingsForCaller`.
 */
async function grantedCredits(): Promise<number> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("generation_credits")
      .select("presentations_granted")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    if (error || !data) return 0;
    return data.reduce((sum, row) => sum + (row.presentations_granted ?? 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Presentations bought outright and not yet spent.
 *
 * Reported separately from the allowance rather than folded into it. They are
 * different things to an author — one renews, the other does not and expires —
 * and a single blended number could not say which of them is about to run out.
 */
export async function creditBalance(): Promise<number> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("captivate_credit_balance");
    if (error || typeof data !== "number") return 0;
    return data;
  } catch {
    return 0;
  }
}

/** The deck allowance alone, for the surfaces that only show that one. */
export async function deckUsage(): Promise<{ decksUsed: number; deckAllowance: number }> {
  const { groups } = await planUsage();
  const deck = groups.find((g) => g.group === "deck");
  return { decksUsed: deck?.used ?? 0, deckAllowance: deck?.allowance ?? 0 };
}
