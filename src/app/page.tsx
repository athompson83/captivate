import Link from "next/link";
import { redirect } from "next/navigation";
import { Highlighter, MonitorPlay, Pointer, Sparkles, Timer, Video } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function LandingPage() {
  if (isSupabaseConfigured) {
    const user = await getCurrentUser();
    if (user) redirect("/home");
  }

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-2.5">
          <span className="bg-accent flex size-8 items-center justify-center rounded-[var(--radius-md)]">
            <Sparkles className="size-4 text-[var(--accent-contrast)]" aria-hidden />
          </span>
          <span className="text-ink text-[15px] font-semibold tracking-tight">Captivate</span>
        </span>
        <nav className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="text-ink-2 hover:text-ink rounded-[var(--radius-md)] px-3.5 py-2 text-[13px] font-medium transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="bg-accent rounded-[var(--radius-md)] px-3.5 py-2 text-[13px] font-medium text-[var(--accent-contrast)] transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-16 pb-12 text-center sm:pt-24">
        <p className="text-accent-text text-[12px] font-medium tracking-[0.18em] uppercase">
          Present · Annotate · Record
        </p>
        <h1
          className="text-ink mt-5 text-[clamp(2.4rem,6vw,4rem)] leading-[1.04] font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Presentations that hold a room
        </h1>
        <p className="text-ink-2 mx-auto mt-5 max-w-xl text-[15px] leading-relaxed">
          Captivate is a presentation tool built around the moment you stand up to speak — a real
          presenter console, live annotation over your slides, and recording with your microphone
          and camera in one file.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/sign-up"
            className="bg-accent rounded-[var(--radius-lg)] px-6 py-3 text-[15px] font-medium text-[var(--accent-contrast)] shadow-[var(--shadow-sm)] transition-opacity hover:opacity-90"
          >
            Create your first deck
          </Link>
          <Link
            href="/sign-in"
            className="border-line text-ink-2 hover:border-line-strong hover:text-ink rounded-[var(--radius-lg)] border px-6 py-3 text-[15px] font-medium transition-colors"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [
              MonitorPlay,
              "A real stage",
              "Full-screen presentation with no editor chrome, no browser bars, and transitions that guide attention.",
            ],
            [
              Timer,
              "Presenter console",
              "Private notes, next-scene preview, total and per-scene timers on your screen only.",
            ],
            [
              Pointer,
              "Laser pointer",
              "Turn your cursor into a visible pointer the audience can follow, on either display.",
            ],
            [
              Highlighter,
              "Live highlight",
              "Drag to spotlight a phrase, a region of a chart, or part of an image. Clears in one key.",
            ],
            [
              Video,
              "Record it",
              "Screen, microphone and optional camera picture-in-picture, saved to your library.",
            ],
            [
              Sparkles,
              "AI that drafts, not decides",
              "Describe a topic, review the narrative map, then edit every word and every element.",
            ],
          ].map(([Icon, title, body]) => {
            const I = Icon as React.ComponentType<{ className?: string }>;
            return (
              <div
                key={title as string}
                className="border-line-subtle bg-raised rounded-[var(--radius-lg)] border p-5"
              >
                <I className="text-accent size-4" />
                <h2 className="text-ink mt-3 text-[14px] font-semibold">{title as string}</h2>
                <p className="text-ink-3 mt-1.5 text-[13px] leading-relaxed">{body as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="border-line-subtle border-t">
        <div className="text-ink-3 mx-auto max-w-5xl px-6 py-6 text-[12px]">
          Captivate — an open project for educators and presenters.
        </div>
      </footer>
    </main>
  );
}
