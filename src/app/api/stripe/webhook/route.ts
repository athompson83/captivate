import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { isBillingConfigured, stripe } from "@/lib/billing/stripe";
import { shouldApply, subscriptionPatchFrom } from "@/lib/billing/webhook-events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logFailure } from "@/lib/observability";

/** Signature verification needs the raw body, which the Edge runtime cannot give us. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe's side of the subscription.
 *
 * This endpoint is public and unauthenticated, so **the signature is the
 * authentication**: an unverified body is a 400 and nothing else happens.
 *
 * It is the only writer of `subscriptions`, through the service-role client,
 * because RLS deliberately offers no write verb on that table to anybody else.
 *
 * Three properties it has to keep:
 *  - idempotent, because Stripe retries and a retry must not double-apply;
 *  - order-independent, because Stripe does not guarantee delivery order;
 *  - honest about failure — 200 for handled and ignored alike, 500 only when a
 *    write genuinely failed, so Stripe retries the ones worth retrying.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isBillingConfigured() || !secret) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Unsigned." }, { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (error) {
    // Either somebody is posting forgeries at the endpoint or the deployment's
    // signing secret no longer matches Stripe's. Both are worth knowing about,
    // and neither is distinguishable from the 400 alone.
    logFailure("stripe.webhook.signature", error);
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Idempotency first: a duplicate delivery stops here having changed nothing.
  const { error: seen } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type } as never);
  if (seen?.code === "23505") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      const userId = session.client_reference_id ?? session.metadata?.user_id ?? null;
      if (!subscriptionId || !userId) {
        // Somebody completed a checkout that cannot be attached to an account.
        // Answering 200 is right — retrying will not supply the missing id —
        // but dropping it in silence means a paid subscription simply never
        // arrives and nothing anywhere says so.
        logFailure(
          "stripe.webhook.unattributable",
          `${event.type} missing ${!subscriptionId ? "subscription" : "user"} id`,
        );
        break;
      }

      // Re-fetch rather than trusting the session's summary: the subscription
      // object is where status, price and period actually live.
      const subscription = await stripe().subscriptions.retrieve(subscriptionId);
      if (!(await applyPatch(admin, userId, subscription, event.created))) {
        logFailure("stripe.webhook.write", `${event.type} could not be applied`);
        return NextResponse.json({ error: "Write failed." }, { status: 500 });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      const { data: owner } = await admin
        .from("billing_customers")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      // No mapping yet means checkout has not completed for this customer; the
      // session event will establish it.
      if (!owner) break;

      if (!(await applyPatch(admin, owner.user_id, subscription, event.created))) {
        logFailure("stripe.webhook.write", `${event.type} could not be applied`);
        return NextResponse.json({ error: "Write failed." }, { status: 500 });
      }
      break;
    }

    default:
      // Everything else is recorded in `stripe_events` and deliberately
      // ignored — `invoice.payment_failed` included, because the status that
      // matters arrives on the subscription event.
      break;
  }

  return NextResponse.json({ received: true });
}

async function applyPatch(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  subscription: unknown,
  eventCreatedSeconds: number,
): Promise<boolean> {
  const patch = subscriptionPatchFrom(subscription, eventCreatedSeconds);
  // Nothing to write. Not a failure worth making Stripe retry.
  if (!patch) return true;

  const { data: stored } = await admin
    .from("subscriptions")
    .select("updated_from_event_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!shouldApply(stored?.updated_from_event_at ?? null, patch.updatedFromEventAt)) return true;

  // The mapping may not exist yet when checkout completes first.
  await admin
    .from("billing_customers")
    .upsert({ user_id: userId, stripe_customer_id: patch.stripeCustomerId } as never, {
      onConflict: "user_id",
    });

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: patch.stripeSubscriptionId,
      status: patch.status,
      price_id: patch.priceId,
      billing_interval: patch.billingInterval,
      current_period_end: patch.currentPeriodEnd,
      cancel_at_period_end: patch.cancelAtPeriodEnd,
      updated_from_event_at: patch.updatedFromEventAt,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "user_id" },
  );

  return !error;
}
