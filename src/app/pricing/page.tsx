import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_BUDGETS, PRO_PRICING } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Captivate is free to use. Pro raises the AI limits and adds generated imagery.",
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
    <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
      <h1
        className="text-ink text-[30px] font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Simple pricing
      </h1>
      <p className="text-ink-2 mt-3 max-w-xl text-[15px] leading-relaxed">
        Captivate is free to use, and everything you make stays yours — editable, presentable and
        exportable — on either plan. Pro raises the AI limits and adds generated imagery.
      </p>

      <div className="mt-9 grid gap-4 sm:grid-cols-2">
        <div className="border-line-subtle bg-raised rounded-[var(--radius-lg)] border p-5">
          <h2 className="text-ink text-[15px] font-semibold">Free</h2>
          <p className="text-ink mt-1 text-[26px] font-semibold tracking-tight">$0</p>
          <p className="text-ink-3 mt-2 text-[13px] leading-relaxed">
            The whole product, with {free.deck.max} AI-generated presentations every 30 days.
          </p>
          <Link
            href="/sign-up"
            className="border-line hover:border-line-strong text-ink-2 hover:text-ink mt-4 inline-flex min-h-[32px] items-center rounded-[var(--radius-md)] border px-3 text-[13px] font-medium transition-colors"
          >
            Create an account
          </Link>
        </div>

        <div className="border-accent bg-raised rounded-[var(--radius-lg)] border p-5">
          <h2 className="text-ink text-[15px] font-semibold">Captivate Pro</h2>
          <p className="text-ink mt-1 text-[26px] font-semibold tracking-tight">
            {PRO_PRICING.monthly}
            <span className="text-ink-3 text-[14px] font-normal"> / month</span>
          </p>
          <p className="text-ink-3 mt-2 text-[13px] leading-relaxed">
            Or {PRO_PRICING.annual} a year — about {PRO_PRICING.annualSavingPercent}% less.
          </p>
          <Link
            href="/settings"
            className="bg-accent text-on-accent mt-4 inline-flex min-h-[32px] items-center rounded-[var(--radius-md)] px-3 text-[13px] font-medium transition-opacity hover:opacity-90"
          >
            Upgrade in settings
          </Link>
        </div>
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className="border-line-subtle border-b">
              <th className="text-ink-3 py-2 text-left font-medium">What you get</th>
              <th className="text-ink-3 py-2 text-left font-medium">Free</th>
              <th className="text-ink-3 py-2 text-left font-medium">Pro</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-line-subtle border-b">
                <td className="text-ink-2 py-2.5 pr-4">{row.label}</td>
                <td className="text-ink-2 py-2.5 pr-4">{row.free}</td>
                <td className="text-ink py-2.5">{row.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-ink-3 mt-6 text-[12.5px] leading-relaxed">
        Limits are counted over a rolling window — the last 30 days on Free, the last hour on Pro —
        not a calendar month. Cancelling keeps every presentation, asset and recording you have
        made; only future AI generations are limited.
      </p>
    </main>
  );
}
