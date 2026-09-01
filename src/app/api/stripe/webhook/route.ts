import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { isBillingConfigured, planForPriceId, stripe } from "@/lib/billing/stripe";
import { shouldApply, subscriptionPatchFrom } from "@/lib/billing/webhook-events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TOPUP } from "@/lib/billing/plans";
import { logFailure, logFailureSampled } from "@/lib/observability";

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
    //
    // Sampled because this is the one logging site here that an unauthenticated
    // caller can reach at will: a bot with a junk signature header could
    // otherwise mint lines without limit and bury everything else in them.
    logFailureSampled("stripe.webhook.signature", error);
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Idempotency first: a duplicate delivery stops here having changed nothing.
  //
  // Claiming the event before doing the work is what makes a retry safe, and it
  // is also what makes a *failed* attempt unsafe: Stripe retries, the retry
  // sees the claim, and the mutation that failed never happens again — a
  // customer charged with no credits. So a handler that fails releases the
  // claim on its way out, and `handled` is the flag that says whether it got
  // that far. Releasing is best-effort: if it fails too, the retry is a no-op
  // rather than a double-grant, because every mutation below is idempotent in
  // its own right.
  const { error: seen } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type } as never);
  if (seen?.code === "23505") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const release = async () => {
    await admin.from("stripe_events").delete().eq("id", event.id);
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id ?? session.metadata?.user_id ?? null;

      // A one-time payment is a top-up, not a plan. Two different products
      // arrive on this one event type, and telling them apart by `mode` rather
      // than by the metadata is deliberate: `mode` is Stripe's own record of
      // what was actually bought, and metadata is whatever the session was
      // created with.
      if (session.mode === "payment") {
        if (!userId) {
          logFailure("stripe.webhook.unattributable", `${event.type} top-up missing user id`);
          break;
        }
        // Only a session that is actually paid grants anything. An unpaid one
        // arrives for asynchronous methods that may still fail.
        if (session.payment_status !== "paid") break;
        if (!(await grantTopUp(admin, userId, session, event.id))) {
          logFailure("stripe.webhook.write", `${event.type} top-up could not be granted`);
          await release();
          return NextResponse.json({ error: "Write failed." }, { status: 500 });
        }
        break;
      }

      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
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
        await release();
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
        await release();
        return NextResponse.json({ error: "Write failed." }, { status: 500 });
      }
      break;
    }

    case "charge.refunded":
    case "charge.dispute.created": {
      // Money taken back takes the credits back. A balance that survives a
      // refund is a product given away, and one that survives a chargeback is
      // a product given away to somebody who said they never bought it.
      //
      // Revoked rather than deleted: the row is the history of a purchase, and
      // a support conversation about a disputed balance starts from it.
      const charge = event.data.object as Stripe.Charge & { payment_intent?: string | null };
      const paymentIntent =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : ((charge.payment_intent as { id?: string } | null)?.id ?? null);
      if (!paymentIntent) break;

      // `charge.refunded` fires for a *partial* refund too, and `charge.refunded`
      // the boolean is what tells them apart — true only when the whole charge
      // has been returned. Revoking the balance on a partial refund would take
      // back ten presentations for a dollar returned, which is worse than not
      // handling refunds at all.
      //
      // A partial refund of a top-up is not something the product can produce —
      // one price, quantity bought whole — so it is logged rather than guessed
      // at. Somebody deciding to return half of a five-dollar purchase should
      // reach a person, not an algorithm dividing credits.
      if (event.type === "charge.refunded" && charge.refunded !== true) {
        logFailure(
          "stripe.webhook.partial-refund",
          `${event.type} for ${paymentIntent} refunded ${charge.amount_refunded} of ${charge.amount}; credits left intact`,
        );
        break;
      }

      const { error } = await admin
        .from("generation_credits")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_reason: event.type === "charge.refunded" ? "refund" : "dispute",
          updated_at: new Date().toISOString(),
        } as never)
        .eq("stripe_payment_intent_id", paymentIntent)
        .is("revoked_at", null);

      if (error) {
        logFailure("stripe.webhook.write", `${event.type} could not revoke credits`);
        await release();
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

/**
 * Grants the credits a paid top-up bought.
 *
 * Idempotent by construction rather than by checking first: the Checkout
 * Session id is unique on the table, so a retry — or two deliveries of one
 * event racing each other — collides instead of granting a second balance.
 * A duplicate is success, because the credits are already there.
 *
 * The quantity comes from the *line item*, so buying two top-ups in one session
 * grants twenty presentations rather than ten. Falling back to one is the safe
 * direction: it grants less than was bought, which a person can report, rather
 * than more, which nobody does.
 */
async function grantTopUp(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<boolean> {
  let quantity = 1;
  try {
    const items = await stripe().checkout.sessions.listLineItems(session.id, { limit: 1 });
    quantity = items.data[0]?.quantity ?? 1;
  } catch {
    // Keep the fallback rather than failing: the payment succeeded, and
    // granting the base quantity beats granting nothing.
  }

  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : ((session.payment_intent as { id?: string } | null)?.id ?? null);

  const presentations = TOPUP.presentations * Math.max(1, quantity);
  const expiresAt = new Date(Date.now() + TOPUP.validDays * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await admin.from("generation_credits").insert({
    user_id: userId,
    presentations_granted: presentations,
    presentations_remaining: presentations,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntent,
    stripe_event_id: eventId,
    expires_at: expiresAt,
  } as never);

  // 23505 is the unique violation on the session id: already granted.
  return !error || error.code === "23505";
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
      // Resolved once, here, and kept. Everything downstream reads the stored
      // answer, so a price this deployment later stops naming — a rotation, a
      // withdrawn annual plan — cannot change what somebody already bought.
      // Null when the price is not recognised at all, which entitlement reads
      // as the *lowest* paid tier rather than the highest.
      plan: planForPriceId(patch.priceId),
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
