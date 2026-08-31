"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { openBillingPortal, startCheckout } from "@/lib/data/billing";
import type { GrantSummary, SubscriptionSummary } from "@/lib/billing/entitlement";
import { PRO_PRICING, planLabel } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils/format";

/**
 * The plan, what it costs, and how much of it is left.
 *
 * Two rules shape the copy. The allowance is counted over a *rolling* thirty
 * days, so it never says "this month" — a window described wrongly is a lie
 * about billing. And when billing is unconfigured there are no controls at
 * all, because an unbuilt path is absent rather than disabled with a tooltip.
 */
export function BillingSection({
  configured,
  testMode,
  summary,
  grant,
  usage,
}: {
  configured: boolean;
  testMode: boolean;
  summary: SubscriptionSummary | null;
  /** An entitlement granted rather than bought. Outranks the subscription. */
  grant: GrantSummary | null;
  usage: { decksUsed: number; deckAllowance: number };
}) {
  const { toast } = useToast();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [pending, startTransition] = useTransition();

  const isPro = summary?.plan === "pro";

  // Both controls leave the app for a Stripe-hosted page, so a failure has to
  // say so rather than silently doing nothing.
  const go = (
    run: () => Promise<{ ok: true; data: { url: string } } | { ok: false; error: string }>,
    failure: string,
  ) =>
    startTransition(async () => {
      const result = await run();
      if (result.ok) window.location.href = result.data.url;
      else toast({ tone: "error", title: failure, description: result.error });
    });

  return (
    <section className="mt-10" aria-labelledby="billing-heading">
      <h2 id="billing-heading" className="text-ink text-[14px] font-semibold">
        Plan
      </h2>

      {!configured ? (
        <p className="text-ink-3 mt-1 text-[13px]">
          Billing isn&rsquo;t configured on this deployment, so every feature is available without a
          subscription.
        </p>
      ) : grant ? (
        <>
          <p className="text-ink-2 mt-1 text-[13px]">
            <span className="text-ink font-medium">{planLabel(grant.plan)}</span> &middot; granted,
            not billed
            {grant.expiresAt ? <> &middot; until {formatDate(grant.expiresAt)}</> : null}
          </p>
          <p className="text-ink-3 mt-1 text-[13px]">
            {grant.note || "This account was granted its plan. There is nothing to pay."}
          </p>
        </>
      ) : isPro ? (
        <>
          <p className="text-ink-2 mt-1 text-[13px]">
            <span className="text-ink font-medium">Captivate Pro</span>
            {summary?.currentPeriodEnd ? (
              summary.cancelAtPeriodEnd ? (
                <> &middot; ends {formatDate(summary.currentPeriodEnd)}</>
              ) : (
                <> &middot; renews {formatDate(summary.currentPeriodEnd)}</>
              )
            ) : null}
          </p>
          {summary?.status === "past_due" && (
            <p className="text-ink-3 mt-1 text-[13px]">
              Your last payment didn&rsquo;t go through. Update your card to keep Pro past the
              current period.
            </p>
          )}
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              loading={pending}
              onClick={() => go(openBillingPortal, "Couldn't open billing")}
            >
              Manage billing
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-ink-2 mt-1 text-[13px]">
            <span className="text-ink font-medium">Free</span> &middot; {usage.decksUsed} of{" "}
            {usage.deckAllowance} presentations generated in the last 30 days
          </p>
          <p className="text-ink-3 mt-1 text-[13px]">
            Everything you make stays yours to edit, present, record and share on either plan. Pro
            raises the AI limits and adds generated imagery.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Segmented
              label="Billing interval"
              size="sm"
              value={interval}
              onChange={setInterval}
              options={[
                { value: "month", label: `${PRO_PRICING.monthly}/mo` },
                { value: "year", label: `${PRO_PRICING.annual}/yr` },
              ]}
            />
            <Button
              variant="primary"
              size="sm"
              loading={pending}
              onClick={() => go(() => startCheckout({ interval }), "Couldn't start checkout")}
            >
              Upgrade to Pro
            </Button>
          </div>
        </>
      )}

      {configured && testMode && (
        <p className="text-ink-3 mt-2 text-[12px]">
          This deployment is pointed at Stripe test mode, so no real charge is possible.
        </p>
      )}

      <p className="mt-2 text-[12.5px]">
        <Link href="/pricing" className="text-accent-text hover:underline">
          See what Pro includes
        </Link>
      </p>
    </section>
  );
}
