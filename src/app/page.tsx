import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Camera,
  Captions,
  FileDown,
  Map,
  MonitorPlay,
  Pointer,
  Sparkles,
  Video,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Hero } from "@/components/marketing/hero";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { FREE_ALLOWANCE_COPY, PRO_PRICING } from "@/lib/billing/plans";

/**
 * The one page whose canonical really is the origin.
 *
 * Stated here rather than in the root layout, where it was inherited by every
 * page that did not replace it and told a crawler that `/pricing` was a copy
 * of this one. `openGraph.url` travels with it for the same reason.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

/**
 * The front door.
 *
 * The hero shows the thesis instead of claiming it — a camera travelling over
 * one canvas of placed scenes — because "there is no slide reel" is better
 * demonstrated than asserted. Everything below it is the same discipline: what
 * the product does, in the order somebody actually does it, with no screenshot
 * of a feature that does not exist.
 *
 * The page is a night sky in every theme (`.marketing` in `globals.css`), and
 * it is the only surface in Captivate that ignores the visitor's colour
 * scheme. Past the sign-in the app is theme-aware exactly as before.
 */
export default async function LandingPage() {
  if (isSupabaseConfigured) {
    const user = await getCurrentUser();
    if (user) redirect("/home");
  }

  return (
    <main className="marketing relative min-h-screen overflow-x-hidden">
      <div className="aurora" aria-hidden />

      <div className="relative">
        <SiteHeader />

        {/* Hero: the claim on the left, the product proving it on the right.
            The two halves stack below `lg`, and the canvas takes the greater
            share above it because it is the argument. */}
        <section className="shell grid items-center gap-12 pt-12 pb-20 sm:pt-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 xl:gap-24">
          <div>
            <p className="text-[12px] font-medium tracking-[0.2em] text-[var(--sky-amber)] uppercase">
              Presentations for people with an argument
            </p>
            <h1
              className="mt-5 text-[clamp(2.7rem,6vw,5.5rem)] leading-[0.96] font-semibold tracking-tight text-[var(--sky-ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              There is no <span className="lit-text">slide&nbsp;reel</span>.
            </h1>
            <p className="mt-7 max-w-lg text-[clamp(15px,1.15vw,18px)] leading-relaxed text-[var(--sky-ink-2)]">
              A Captivate presentation is one canvas with every scene placed on it. Presenting moves
              a camera — the room sees each idea, and where it sits in the whole argument.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="rounded-[var(--radius-lg)] bg-[var(--sky-amber)] px-6 py-3.5 text-[15px] font-medium text-[oklch(0.18_0.03_60)] shadow-[0_10px_30px_oklch(0.7_0.15_70_/_0.25)] transition-opacity hover:opacity-90"
              >
                Start your first canvas
              </Link>
              <Link
                href="/pricing"
                className="rounded-[var(--radius-lg)] border border-[var(--sky-line-strong)] px-6 py-3.5 text-[15px] font-medium text-[var(--sky-ink-2)] transition-colors hover:border-[var(--sky-ink-3)] hover:text-[var(--sky-ink)]"
              >
                See pricing
              </Link>
            </div>
            <p className="mt-7 text-[13px] leading-relaxed text-[var(--sky-ink-3)]">
              {FREE_ALLOWANCE_COPY} on the free plan. Your words stay yours — AI drafts, you decide.
            </p>
          </div>

          <Hero />
        </section>

        {/* The sequence is real: this is genuinely the order of working. */}
        <section className="border-y border-[var(--sky-line)]/70 bg-[oklch(0.1_0.026_288_/_0.6)]">
          <div className="shell grid gap-10 py-16 sm:grid-cols-3">
            {(
              [
                [
                  "1",
                  "Say what you're arguing",
                  "Describe the talk. Captivate proposes a narrative map — movements and moments, each stating its purpose and what the audience leaves with.",
                ],
                [
                  "2",
                  "Shape the map",
                  "Reorder, rewrite, pin evidence from your own library. Nothing is rendered until the argument is one you'd stand behind.",
                ],
                [
                  "3",
                  "Generate and present",
                  "Scenes are written from the map — full content or just the frame, your call — placed on the canvas, ready to present.",
                ],
              ] as const
            ).map(([step, title, body]) => (
              <div key={step}>
                <span
                  className="text-[44px] leading-none font-semibold text-[var(--sky-amber)]/70"
                  style={{ fontFamily: "var(--font-display)" }}
                  aria-hidden
                >
                  {step}
                </span>
                <h2 className="mt-3 text-[15px] font-semibold text-[var(--sky-ink)]">{title}</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--sky-ink-3)]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="shell py-20">
          <h2 className="text-[13px] font-medium tracking-[0.16em] text-[var(--sky-ink-3)] uppercase">
            Built for the moment you stand up
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {(
              [
                [
                  Map,
                  "A narrative map, not an outline",
                  "Every beat states its purpose and takeaway before anything is drawn. Regenerate any part without losing the rest.",
                ],
                [
                  MonitorPlay,
                  "A camera, not a clicker",
                  "Scenes sit side by side, spiral outward, or nest inside one another. Advancing flies the room to the next idea — or dives into a detail.",
                ],
                [
                  Pointer,
                  "Present like you're in the room",
                  "Laser pointer, live highlight, freehand ink. A private console with notes and timers on your screen only.",
                ],
                [
                  Camera,
                  "You, on the stage",
                  "Put your camera feed anywhere over the canvas — background removed on your device, so only you float over the argument.",
                ],
                [
                  Video,
                  "Record the real thing",
                  "Screen, voice and camera composited into one file, scene markers included, saved to your library.",
                ],
                [
                  Captions,
                  "Subtitles write themselves",
                  "A live transcript as you speak — captions on playback, a .vtt file to keep, or burned into the video itself.",
                ],
                [
                  FileDown,
                  "Leaves in a format anyone opens",
                  "Export to PowerPoint or Keynote when the room needs a deck. Flattened to slides, notes intact — the journey stays here.",
                ],
                [
                  Sparkles,
                  "Your material, not the model's",
                  "Ground a talk in your own notes and files. Every claim the model makes about them is checked against what you actually gave it.",
                ],
              ] as const
            ).map(([Icon, title, body]) => (
              <div key={title} className="lit-card p-6">
                <Icon className="size-4 text-[var(--sky-amber)]" aria-hidden />
                <h3 className="mt-4 text-[14.5px] font-semibold text-[var(--sky-ink)]">{title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--sky-ink-3)]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="shell pb-24">
          <div className="lit-card flex flex-col items-start gap-8 p-8 sm:p-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <h2
                className="text-[clamp(1.7rem,2.6vw,2.6rem)] leading-tight font-semibold text-[var(--sky-ink)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Start free. Upgrade when the room gets bigger.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[var(--sky-ink-2)]">
                {FREE_ALLOWANCE_COPY}, every presenting and recording feature included. Captivate
                Pro is {PRO_PRICING.monthly} a month, or {PRO_PRICING.annual} a year — about{" "}
                {PRO_PRICING.annualSavingPercent}% less.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className="rounded-[var(--radius-lg)] bg-[var(--sky-amber)] px-6 py-3.5 text-[15px] font-medium text-[oklch(0.18_0.03_60)] transition-opacity hover:opacity-90"
              >
                Create an account
              </Link>
              <Link
                href="/pricing"
                className="rounded-[var(--radius-lg)] border border-[var(--sky-line-strong)] px-6 py-3.5 text-[15px] font-medium text-[var(--sky-ink-2)] transition-colors hover:text-[var(--sky-ink)]"
              >
                Compare plans
              </Link>
            </div>
          </div>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
