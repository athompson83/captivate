"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { openBillingPortal, startCheckout, startTopUp } from "@/lib/data/billing";
import type { GrantSummary, GroupUsage, SubscriptionSummary } from "@/lib/billing/entitlement";
import { PRICING, TOPUP, money, planLabel, type PaidPlan, type Plan } from "@/lib/billing/plans";
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
  credits,
  sellable,
  topUpAvailable,
}: {
  configured: boolean;
  testMode: boolean;
  summary: SubscriptionSummary | null;
  /** An entitlement granted rather than bought. Outranks the subscription. */
  grant: GrantSummary | null;
  /** Every allowance this account has, and how much of each is spent. */
  usage: { plan: Plan; groups: GroupUsage[] };
  /** Presentations bought outright and not yet spent. */
  credits: number;
  /**
   * The tiers this deployment has a price for.
   *
   * `isBillingConfigured()` only checks the secret key, so a deployment with
   * Stripe but no Basic price would otherwise offer Basic, take the click, and
   * answer with an error toast — a control that looks functional and is not.
   */
  sellable: PaidPlan[];
  /** False when no top-up price is configured, so the buy control is absent. */
  topUpAvailable: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const paid = summary?.plan === "pro" || summary?.plan === "basic";
  const [tier, setTier] = useState<PaidPlan>("pro");
  // The chosen tier, unless this deployment cannot sell it. Derived rather than
  // corrected in an effect: a selection that has become invalid is a render
  // concern, and writing it back to state would loop.
  const offered: PaidPlan = sellable.includes(tier) ? tier : (sellable[0] ?? "pro");

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
      ) : paid ? (
        <>
          <p className="text-ink-2 mt-1 text-[13px]">
            <span className="text-ink font-medium">{planLabel(summary!.plan)}</span>
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
              Your last payment didn&rsquo;t go through. Update your card to keep your plan past the
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
            <span className="text-ink font-medium">Free</span>
          </p>
          <p className="text-ink-3 mt-1 text-[13px]">
            Everything you make stays yours to edit, present, record and share on every plan. Paid
            tiers raise the allowance and add generated imagery.
          </p>
          {sellable.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* Only the tiers this deployment can actually sell. A picker
                  between two options is worth showing only when there are two. */}
              {sellable.length > 1 ? (
                <Segmented
                  label="Plan"
                  size="sm"
                  value={offered}
                  onChange={setTier}
                  options={sellable.map((plan) => ({
                    value: plan,
                    label: plan === "pro" ? "Pro" : "Basic",
                  }))}
                />
              ) : (
                <span className="text-ink-2 text-[13px] font-medium">{planLabel(offered)}</span>
              )}
              {/* Monthly only. An annual selector would be a control that looks
                  functional and is not: there is no annual price to check out
                  against, and annual billing is held until measured cost per
                  presentation says a year-long commitment is a safe one. */}
              <span className="text-ink-3 text-[13px]">{PRICING[offered].monthly}/mo</span>
              <Button
                variant="primary"
                size="sm"
                loading={pending}
                onClick={() =>
                  go(() => startCheckout({ plan: offered }), "Couldn't start checkout")
                }
              >
                Upgrade to {offered === "pro" ? "Pro" : "Basic"}
              </Button>
            </div>
          )}
        </>
      )}

      {/*
       * What is left, on every allowance rather than only decks.
       *
       * An author refused a rewrite while this showed a deck count had no way
       * to find out why — the same complaint the deck counter was added to
       * answer, one group along. Shown on every plan, because "how much have
       * I got left" is not a question only Free accounts ask.
       */}
      <ul className="border-line-subtle mt-4 space-y-2 border-t pt-4">
        {usage.groups.map((group) => {
          const left = Math.max(0, group.allowance - group.used);
          const spent = group.allowance > 0 ? Math.min(1, group.used / group.allowance) : 0;
          return (
            <li key={group.group}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-ink-2 text-[13px]">{group.label}</span>
                <span className="text-ink-3 text-[12px] tabular-nums">
                  {group.used} of {group.allowance}
                </span>
              </div>
              <div
                className="bg-inset mt-1 h-1.5 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={group.allowance}
                // Clamped, because credits raise the effective ceiling: an author who
                // has bought a top-up genuinely uses more than their allowance, and a
                // progressbar whose value exceeds its own maximum is malformed. The
                // real number stays in the label below.
                aria-valuenow={Math.min(group.used, group.allowance)}
                aria-label={`${group.label}: ${group.used} of ${group.allowance} used, ${left} left`}
              >
                <div
                  className="bg-accent h-full rounded-full"
                  style={{ width: `${Math.round(spent * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-ink-3 mt-2 text-[12px]">Counted over any 30 days, not a calendar month.</p>

      {/*
       * Credits are shown beside the allowance, never folded into it. They are
       * different things to an author — the allowance renews, credits do not
       * and expire — and one blended number could not say which is about to
       * run out. The buy control appears only where it can actually work: a
       * paid plan, on a deployment that has a top-up price. A button that
       * looks functional and is not is worse than its absence.
       */}
      {paid && (
        <div className="border-line-subtle mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div>
            <p className="text-ink-2 text-[13px]">
              Extra presentations{" "}
              <span className="text-ink font-medium tabular-nums">{credits}</span>
            </p>
            <p className="text-ink-3 mt-0.5 text-[12px]">
              Bought on top of your allowance, and used only once it runs out. Each one covers a
              whole presentation — the map, the scenes and its drawings.
            </p>
          </div>
          {topUpAvailable && (
            <Button
              variant="secondary"
              size="sm"
              loading={pending}
              onClick={() => go(startTopUp, "Couldn't start checkout")}
            >
              Buy {TOPUP.presentations} more for {money(TOPUP.cents)}
            </Button>
          )}
        </div>
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
