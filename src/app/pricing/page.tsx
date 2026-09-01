import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_BUDGETS, PRO_PRICING } from "@/lib/billing/plans";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Captivate is free to use. Pro raises the AI limits and adds generated imagery.",
  alternates: { canonical: "/pricing" },
};

/**
 * What the two plans cost, built from the same budgets the gate enforces.
 *
 * Reading `PLAN_BUDGETS` rather than restating the numbers means this page
 * cannot drift from what a user actually gets — the failure mode of every
 * hand-written pricing table.
 */
const free = PLAN_BUDGETS.free;
const pro = PLAN_BUDGETS.pro;

const ROWS: { label: string; free: string; pro: string }[] = [
  {
    label: "Editor, world canvas, presenting, recording, sharing, exports",
    free: "Everything",
    pro: "Everything",
  },
  {
    label: "Presentations generated with AI",
    free: `${free.deck.max} per 30 days`,
    pro: `${pro.deck.max} per hour`,
  },
  {
    label: "Narrative maps and single scenes",
    free: `${free.draft.max} per 30 days`,
    pro: `${pro.draft.max} per hour`,
  },
  {
    label: "Staged drawings",
    free: `${free.drawing.max} per 30 days`,
    pro: `${pro.drawing.max} per hour`,
  },
  {
    label: "Rewriting, speaker notes, suggestions",
    free: `${free.light.max} per 30 days`,
    pro: `${pro.light.max} per hour`,
  },
  { label: "Stock cover photography", free: "Included", pro: "Included" },
  { label: "AI image generation", free: "—", pro: "Included" },
];

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
            and exportable — on either plan. Pro raises the AI limits and adds generated imagery.
          </p>

          <div className="mt-12 grid gap-5 lg:grid-cols-2 2xl:gap-8">
            <div className="lit-card p-7 sm:p-9">
              <h2 className="text-[15px] font-semibold text-[var(--sky-ink)]">Free</h2>
              <p className="mt-2 text-[40px] leading-none font-semibold tracking-tight text-[var(--sky-ink)]">
                $0
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-[var(--sky-ink-3)]">
                The whole product, with {free.deck.max} AI-generated presentations every 30 days.
              </p>
              <Link
                href="/sign-up"
                className="mt-7 inline-flex items-center rounded-[var(--radius-lg)] border border-[var(--sky-line-strong)] px-5 py-3 text-[14px] font-medium text-[var(--sky-ink-2)] transition-colors hover:text-[var(--sky-ink)]"
              >
                Create an account
              </Link>
            </div>

            <div className="lit-card border-[var(--sky-amber)]/45 p-7 sm:p-9">
              <h2 className="text-[15px] font-semibold text-[var(--sky-amber)]">Captivate Pro</h2>
              <p className="mt-2 text-[40px] leading-none font-semibold tracking-tight text-[var(--sky-ink)]">
                {PRO_PRICING.monthly}
                <span className="text-[16px] font-normal text-[var(--sky-ink-3)]"> / month</span>
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-[var(--sky-ink-3)]">
                Or {PRO_PRICING.annual} a year — about {PRO_PRICING.annualSavingPercent}% less.
              </p>
              <Link
                href="/settings"
                className="mt-7 inline-flex items-center rounded-[var(--radius-lg)] bg-[var(--sky-amber)] px-5 py-3 text-[14px] font-medium text-[var(--sky-amber-ink)] transition-opacity hover:opacity-90"
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
            <table className="w-full min-w-[560px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-[var(--sky-line)]">
                  <th className="py-3 text-left font-medium text-[var(--sky-ink-3)]">
                    What you get
                  </th>
                  <th className="py-3 text-left font-medium text-[var(--sky-ink-3)]">Free</th>
                  <th className="py-3 text-left font-medium text-[var(--sky-ink-3)]">Pro</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-[var(--sky-line)]/60">
                    <td className="py-3.5 pr-6 text-[var(--sky-ink-2)]">{row.label}</td>
                    <td className="py-3.5 pr-6 text-[var(--sky-ink-2)]">{row.free}</td>
                    <td className="py-3.5 text-[var(--sky-ink)]">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-8 max-w-3xl text-[13px] leading-relaxed text-[var(--sky-ink-3)]">
            Limits are counted over a rolling window — the last 30 days on Free, the last hour on
            Pro — not a calendar month. Cancelling keeps every presentation, asset and recording you
            have made; only future AI generations are limited.
          </p>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
