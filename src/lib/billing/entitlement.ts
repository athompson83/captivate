import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { isBillingConfigured } from "./stripe";
import {
  limitFor,
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

    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fails closed. Failing open on a read error is how a bug becomes free Pro
    // for everyone.
    if (error || !data) return "free";

    return planFromSubscription(
      {
        status: data.status,
        currentPeriodEndMs: data.current_period_end ? Date.parse(data.current_period_end) : null,
      },
      Date.now(),
    );
  } catch {
    return "free";
  }
}

/** The budget this caller's plan grants for one group of calls. */
export async function limitForCaller(group: BudgetGroup): Promise<RateLimit> {
  return limitFor(await currentPlan(), group);
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
      .select("status, billing_interval, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return null;

    return {
      plan: planFromSubscription(
        {
          status: data.status,
          currentPeriodEndMs: data.current_period_end ? Date.parse(data.current_period_end) : null,
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
