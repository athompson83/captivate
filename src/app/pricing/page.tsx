import type { Metadata } from "next";
import Link from "next/link";
import {
  PRESENTATIONS,
  PRICING,
  TOPUP,
  limitFor,
  money,
  type BudgetGroup,
} from "@/lib/billing/plans";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { topUpPriceId } from "@/lib/billing/stripe";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Captivate is free to use. Pro raises the AI limits and adds generated imagery.",
  alternates: { canonical: "/pricing" },
};

/**
 * What the three plans cost, built from the same budgets the gate enforces.
 *
 * Reading `PLAN_BUDGETS` rather than restating the numbers means this page
 * cannot drift from what a user actually gets — the failure mode of every
 * hand-written pricing table. Every allowance below is a 30-day one, so the
 * column says so once in its header rather than on every cell.
 */
const allowance = (plan: "free" | "basic" | "pro", group: BudgetGroup) =>
  String(limitFor(plan, group).max);

const ROWS: { label: string; free: string; basic: string; pro: string }[] = [
  {
    label: "Editor, world canvas, presenting, recording, sharing, exports",
    free: "Everything",
    basic: "Everything",
    pro: "Everything",
  },
  {
    label: "Presentations generated with AI",
    free: allowance("free", "deck"),
    basic: allowance("basic", "deck"),
    pro: allowance("pro", "deck"),
  },
  {
    label: "Narrative maps and single scenes",
    free: allowance("free", "draft"),
    basic: allowance("basic", "draft"),
    pro: allowance("pro", "draft"),
  },
  {
    label: "Staged drawings",
    free: allowance("free", "drawing"),
    basic: allowance("basic", "drawing"),
    pro: allowance("pro", "drawing"),
  },
  {
    label: "Rewriting, speaker notes, suggestions",
    free: allowance("free", "light"),
    basic: allowance("basic", "light"),
    pro: allowance("pro", "light"),
  },
  { label: "Stock cover photography", free: "Included", basic: "Included", pro: "Included" },
  { label: "AI image generation", free: "—", basic: "Included", pro: "Included" },
];

/**
 * The top-up row, only where a top-up can actually be bought.
 *
 * `STRIPE_PRICE_TOPUP` is optional and settings already hides the buy control
 * without it. A public page promising a purchase the deployment cannot take is
 * the same defect one surface further out.
 */
const TOPUP_ROW = {
  label: `Top up when you run out (${money(TOPUP.cents)} for ${TOPUP.presentations} more presentations)`,
  free: "—",
  basic: "Yes",
  pro: "Yes",
};

const topUpAvailable = topUpPriceId() !== null;
const rows = topUpAvailable ? [...ROWS, TOPUP_ROW] : ROWS;

const freeDecks = PRESENTATIONS.free;
const basicDecks = PRESENTATIONS.basic;
const proDecks = PRESENTATIONS.pro;

export default function PricingPage() {
  return (
    <main className="marketing relative min-h-screen overflow-x-hidden">
      <div className="aurora" aria-hidden />
      <div className="relative">
        <SiteHeader />

        <section className="shell py-16 sm:py-20">
          <h1
            className="text-[clamp(2.2rem,4vw,3.6rem)] leading-tight font-semibold tracking-tight text-[var(--sky-ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Simple pricing
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-[var(--sky-ink-2)]">
            Captivate is free to use, and everything you make stays yours — editable, presentable
            and exportable — on every plan. Paid tiers raise the AI allowance and add generated
            imagery. Every allowance below is counted over any 30 days
            {topUpAvailable ? ", and a paid plan can top up if it runs out" : ""}.
          </p>

          <div className="mt-12 grid gap-5 lg:grid-cols-3 2xl:gap-8">
            <div className="lit-card p-7 sm:p-9">
              <h2 className="text-[15px] font-semibold text-[var(--sky-ink)]">Free</h2>
              <p className="mt-2 text-[40px] leading-none font-semibold tracking-tight text-[var(--sky-ink)]">
                $0
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-[var(--sky-ink-3)]">
                The whole product, with {freeDecks} AI-generated presentations every 30 days.
              </p>
              <Link
                href="/sign-up"
                className="mt-7 inline-flex items-center rounded-[var(--radius-lg)] border border-[var(--sky-line-strong)] px-5 py-3 text-[14px] font-medium text-[var(--sky-ink-2)] transition-colors hover:text-[var(--sky-ink)]"
              >
                Create an account
              </Link>
            </div>

            <div className="lit-card p-7 sm:p-9">
              <h2 className="text-[15px] font-semibold text-[var(--sky-ink)]">Captivate Basic</h2>
              <p className="mt-2 text-[40px] leading-none font-semibold tracking-tight text-[var(--sky-ink)]">
                {PRICING.basic.monthly}
                <span className="text-[16px] font-normal text-[var(--sky-ink-3)]"> / month</span>
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-[var(--sky-ink-3)]">
                {basicDecks} AI-generated presentations every 30 days, generated imagery included.
              </p>
              <Link
                href="/settings"
                className="mt-7 inline-flex items-center rounded-[var(--radius-lg)] border border-[var(--sky-line-strong)] px-5 py-3 text-[14px] font-medium text-[var(--sky-ink-2)] transition-colors hover:text-[var(--sky-ink)]"
              >
                Choose in settings
              </Link>
            </div>

            <div className="lit-card border-[var(--sky-action)]/55 p-7 sm:p-9">
              <h2 className="text-[15px] font-semibold text-[var(--sky-action-text)]">
                Captivate Pro
              </h2>
              <p className="mt-2 text-[40px] leading-none font-semibold tracking-tight text-[var(--sky-ink)]">
                {PRICING.pro.monthly}
                <span className="text-[16px] font-normal text-[var(--sky-ink-3)]"> / month</span>
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-[var(--sky-ink-3)]">
                {proDecks} every 30 days — the allowance for somebody presenting every week, at
                better value per presentation.
              </p>
              <Link
                href="/settings"
                className="mt-7 inline-flex items-center rounded-[var(--radius-lg)] bg-[var(--sky-action)] px-5 py-3 text-[14px] font-medium text-[var(--sky-action-ink)] transition-colors hover:bg-[var(--sky-action-hover)]"
              >
                Upgrade in settings
              </Link>
            </div>
          </div>

          {/* The table is wider than a phone, so this scrolls — and a region
              that scrolls by drag alone is unreachable to anyone navigating by
              keyboard, who would simply never see the Pro column. Focusable and
              named, it scrolls with the arrow keys and announces what it is.
              The global :focus-visible ring makes the stop visible. */}
          <div
            className="mt-14 overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Plan comparison"
          >
            <table className="w-full min-w-[680px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-[var(--sky-line)]">
                  <th className="py-3 text-left font-medium text-[var(--sky-ink-3)]">
                    What you get
                  </th>
                  <th className="py-3 text-left font-medium text-[var(--sky-ink-3)]">
                    Free <span className="font-normal">/ 30 days</span>
                  </th>
                  <th className="py-3 text-left font-medium text-[var(--sky-ink-3)]">
                    Basic <span className="font-normal">/ 30 days</span>
                  </th>
                  <th className="py-3 text-left font-medium text-[var(--sky-ink-3)]">
                    Pro <span className="font-normal">/ 30 days</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-[var(--sky-line)]/60">
                    <td className="py-3.5 pr-6 text-[var(--sky-ink-2)]">{row.label}</td>
                    <td className="py-3.5 pr-6 text-[var(--sky-ink-2)]">{row.free}</td>
                    <td className="py-3.5 pr-6 text-[var(--sky-ink-2)]">{row.basic}</td>
                    <td className="py-3.5 text-[var(--sky-ink)]">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-8 max-w-3xl text-[13px] leading-relaxed text-[var(--sky-ink-3)]">
            Your allowance is counted over a rolling 30 days on every plan, not a calendar month:
            what you generated 31 days ago is back. Paid plans also carry an hourly ceiling well
            above ordinary use, which exists to stop a runaway script spending a month’s allowance
            in an afternoon. Cancelling keeps every presentation, asset and recording you have made;
            only future AI generations are limited.
          </p>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
