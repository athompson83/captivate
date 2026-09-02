"use server";

import { z } from "zod";
import { isBillingConfigured, priceIdFor, stripe, topUpPriceId } from "@/lib/billing/stripe";
import { PAID_PLANS } from "@/lib/billing/plans";
import { currentPlan } from "@/lib/billing/entitlement";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logFailure } from "@/lib/observability";

/**
 * Starting and managing a subscription.
 *
 * Stripe's hosted pages own every card field, so nothing here touches payment
 * details. What this module owns is the two things Stripe cannot know: which
 * Captivate user is checking out, and what they are allowed to buy.
 *
 * This file is `"use server"`, so it may export only async functions — a
 * constant here would make every action in it fail at runtime with a 500 while
 * the build said nothing. Plan constants live in `@/lib/billing/plans`.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * A Stripe call that threw, turned into a value the caller can show.
 *
 * Logged first, because this is the choke point where a billing failure
 * becomes invisible: the action returns a sentence, the page shows it in a
 * toast, and nothing else records that Stripe said no. The first time the
 * Basic and Pro controls were driven on production, the customer was created
 * and the session was not, and the only trace was a toast that had gone by
 * the time anyone looked. Stripe's message never carries card details, and
 * this file never hands it a prompt or a note, so the line is safe to keep.
 *
 * Then told apart. An unreachable Stripe and a rejected request read the same
 * to a user — nothing happened — but mean opposite things to the operator:
 * one is the network, the other is this deployment's own configuration. A
 * price Stripe does not recognise is the specific case worth its own sentence,
 * because a price id copied from the wrong Stripe mode fails exactly this way,
 * with the key working and every other page looking right.
 */
function stripeFailure(operation: string, error: unknown, nothing: string): Result<never> {
  logFailure(operation, error);
  const details = error as { type?: unknown; code?: unknown; param?: unknown } | null;
  // Each try block also reads the session and the customer mapping from
  // Supabase. A failure there is not Stripe's, and a sentence that names
  // Stripe sends a user to the wrong status page and an operator to the wrong
  // dependency. Stripe's SDK stamps every error it raises with a `type` that
  // begins "Stripe"; anything else is reported as what it is — the request
  // did not complete — with the same guarantee about money.
  if (typeof details?.type !== "string" || !details.type.startsWith("Stripe")) {
    return { ok: false, error: `Couldn't complete that request. ${nothing}` };
  }
  if (details.type === "StripeInvalidRequestError") {
    if (details.code === "resource_missing" && String(details.param ?? "").includes("price")) {
      return { ok: false, error: `Stripe doesn't recognise that plan's price. ${nothing}` };
    }
    return { ok: false, error: `Stripe rejected that request. ${nothing}` };
  }
  return { ok: false, error: `Couldn't reach Stripe. ${nothing}` };
}

const CheckoutInput = z.object({
  plan: z.enum(PAID_PLANS),
});

/**
 * A Checkout Session for the signed-in user.
 *
 * The input carries a tier and nothing else — never a price. The price is read
 * from the environment, because a caller that names its own price is a caller
 * that sets its own price, and this action is reachable by anyone with an
 * account. The tier is validated against the plans that can actually be
 * bought.
 *
 * There is no interval to choose. Annual billing is deferred, and the way to
 * defer it is to have no code path that can open an annual checkout — not a
 * hidden control, which is one prop away from being visible again.
 */
export async function startCheckout(input: unknown): Promise<Result<{ url: string }>> {
  if (!isBillingConfigured()) {
    return { ok: false, error: "Billing isn't configured on this deployment." };
  }

  const parsed = CheckoutInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a plan." };

  const price = priceIdFor(parsed.data.plan);
  if (!price) return { ok: false, error: "That plan isn't available right now." };

  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You're signed out. Sign in again to continue." };

    const customer = await customerIdFor(user.id, user.email ?? undefined);
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      // Both, because the webhook reads whichever Stripe hands it.
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      allow_promotion_codes: true,
      success_url: `${site}/settings?checkout=success`,
      cancel_url: `${site}/settings?checkout=cancelled`,
    });

    if (!session.url) return { ok: false, error: "Couldn't start checkout. Nothing was charged." };
    return { ok: true, data: { url: session.url } };
  } catch (error) {
    return stripeFailure("billing.checkout", error, "Nothing was charged.");
  }
}

/**
 * A one-time Checkout Session for a top-up.
 *
 * `mode: "payment"`, not `subscription`: a top-up is a purchase, not a plan,
 * and billing it as a recurring price would charge somebody every month for a
 * balance they meant to buy once.
 *
 * Only for a paid plan. A top-up tops *up* an allowance, and offering one to a
 * free account is selling the wrong thing — the answer there is a subscription,
 * which is cheaper per presentation than credits are.
 *
 * Nothing is granted here. The credits appear when the webhook sees the payment
 * succeed, because a client that could tell the server a purchase happened is a
 * client that can grant itself the product.
 */
export async function startTopUp(): Promise<Result<{ url: string }>> {
  if (!isBillingConfigured()) {
    return { ok: false, error: "Billing isn't configured on this deployment." };
  }

  const price = topUpPriceId();
  if (!price) return { ok: false, error: "Top-ups aren't available right now." };

  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You're signed out. Sign in again to continue." };

    const plan = await currentPlan();
    if (plan === "free") {
      return { ok: false, error: "Top-ups are for paid plans. Choose Basic or Pro first." };
    }

    const customer = await customerIdFor(user.id, user.email ?? undefined);
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";

    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      metadata: { user_id: user.id, kind: "topup" },
      payment_intent_data: { metadata: { user_id: user.id, kind: "topup" } },
      success_url: `${site}/settings?topup=success`,
      cancel_url: `${site}/settings?topup=cancelled`,
    });

    if (!session.url) return { ok: false, error: "Couldn't start checkout. Nothing was charged." };
    return { ok: true, data: { url: session.url } };
  } catch (error) {
    return stripeFailure("billing.topup", error, "Nothing was charged.");
  }
}

/** The Billing Portal, for the caller's own customer and no other. */
export async function openBillingPortal(): Promise<Result<{ url: string }>> {
  if (!isBillingConfigured()) {
    return { ok: false, error: "Billing isn't configured on this deployment." };
  }

  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "You're signed out. Sign in again to continue." };

    // Resolved from the session, never from the request: a customer id in a
    // request body is a customer id somebody else can name.
    const { data } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!data) return { ok: false, error: "You don't have a subscription to manage yet." };

    const session = await stripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/settings`,
    });

    return { ok: true, data: { url: session.url } };
  } catch (error) {
    return stripeFailure("billing.portal", error, "Nothing was changed.");
  }
}

/**
 * This user's Stripe customer, created once and remembered.
 *
 * The mapping is written with the service role because `billing_customers`
 * offers no insert policy to anyone — the same reason the webhook writes that
 * way.
 */
async function customerIdFor(userId: string, email?: string): Promise<string> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data.stripe_customer_id;

  const customer = await stripe().customers.create({ email, metadata: { user_id: userId } });

  await supabaseAdmin()
    .from("billing_customers")
    .upsert({ user_id: userId, stripe_customer_id: customer.id } as never, {
      onConflict: "user_id",
    });

  return customer.id;
}
