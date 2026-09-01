"use server";

import { z } from "zod";
import { isBillingConfigured, priceIdFor, stripe } from "@/lib/billing/stripe";
import { PAID_PLANS } from "@/lib/billing/plans";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
  } catch {
    return { ok: false, error: "Couldn't reach Stripe. Nothing was charged." };
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
  } catch {
    return { ok: false, error: "Couldn't reach Stripe. Nothing was changed." };
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
