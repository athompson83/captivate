import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { usedGenerations } from "@/lib/ai/rate-limit";
import { isBillingConfigured, planForPriceId } from "./stripe";
import {
  BUDGET_KINDS,
  ceilingsFor,
  limitFor,
  planFromGrant,
  planFromSubscription,
  type BudgetGroup,
  type Plan,
  type RateLimit,
} from "./plans";

/**
 * Which plan the signed-in caller is on.
 *
 * One cheap read of the mirror table the webhook maintains. Deliberately not a
 * call to Stripe: an entitlement check sits in front of every AI generation,
 * and a network hop there would put Stripe's uptime in front of Captivate's.
 *
 * When no Stripe key is configured everybody is Pro. A deployment that cannot
 * charge must not throttle — the same principle as the AI tools degrading
 * rather than disappearing when no model is configured. It also means merging
 * billing changes nothing about a running deployment until keys are added
 * deliberately.
 */
export async function currentPlan(): Promise<Plan> {
  if (!isBillingConfigured()) return "pro";

  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return "free";

    // A grant first. It is checked before Stripe because a granted plan is
    // never worse than a bought one, and because the people it exists for —
    // the owner, a support case, a pilot — must not depend on a subscription
    // they were never meant to have.
    const { data: grant } = await supabase
      .from("plan_grants")
      .select("plan, expires_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const granted = planFromGrant(
      grant
        ? { plan: grant.plan, expiresAtMs: grant.expires_at ? Date.parse(grant.expires_at) : null }
        : null,
      Date.now(),
    );
    if (granted) return granted;

    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, price_id, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fails closed. Failing open on a read error is how a bug becomes free Pro
    // for everyone.
    if (error || !data) return "free";

    return planFromSubscription(
      {
        status: data.status,
        currentPeriodEndMs: data.current_period_end ? Date.parse(data.current_period_end) : null,
        plan: planForPriceId(data.price_id),
      },
      Date.now(),
    );
  } catch {
    return "free";
  }
}

/** The allowance this caller's plan grants for one group of calls. */
export async function limitForCaller(group: BudgetGroup): Promise<RateLimit> {
  return limitFor(await currentPlan(), group);
}

/**
 * Every ceiling the caller has to clear, allowance first.
 *
 * The gate takes all of them. Taking only the allowance is what let a paid
 * plan's burst ceiling exist as a number in a table and nowhere in the code
 * that enforces anything — a month's worth spendable in an afternoon.
 */
export async function ceilingsForCaller(group: BudgetGroup): Promise<readonly RateLimit[]> {
  return ceilingsFor(await currentPlan(), group);
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
      .select("status, price_id, billing_interval, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return null;

    return {
      plan: planFromSubscription(
        {
          status: data.status,
          currentPeriodEndMs: data.current_period_end ? Date.parse(data.current_period_end) : null,
          plan: planForPriceId(data.price_id),
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

/** The deck allowance alone, for the surfaces that only show that one. */
export async function deckUsage(): Promise<{ decksUsed: number; deckAllowance: number }> {
  const { groups } = await planUsage();
  const deck = groups.find((g) => g.group === "deck");
  return { decksUsed: deck?.used ?? 0, deckAllowance: deck?.allowance ?? 0 };
}
