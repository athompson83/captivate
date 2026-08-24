import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Camera,
  Captions,
  Map,
  MonitorPlay,
  Pointer,
  Sparkles,
  Video,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * The landing page shows the thesis instead of claiming it: the hero is a
 * miniature presentation world with a camera travelling between scenes,
 * because "there is no slide reel" is better demonstrated than asserted.
 */
export default async function LandingPage() {
  if (isSupabaseConfigured) {
    const user = await getCurrentUser();
    if (user) redirect("/home");
  }

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
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

      {/* Hero: the claim on the left, the product proving it on the right. */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pt-10 pb-16 sm:pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div>
          <p className="text-accent-text text-[12px] font-medium tracking-[0.18em] uppercase">
            Presentations for people with an argument
          </p>
          <h1
            className="text-ink mt-5 text-[clamp(2.6rem,5.5vw,4.2rem)] leading-[0.98] font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            There is no slide&nbsp;reel.
          </h1>
          <p className="text-ink-2 mt-6 max-w-md text-[15.5px] leading-relaxed">
            A Captivate presentation is one canvas with every scene placed on it. Presenting moves
            a camera — the room sees each idea, and where it sits in the whole argument.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-up"
              className="bg-accent rounded-[var(--radius-lg)] px-6 py-3 text-[15px] font-medium text-[var(--accent-contrast)] shadow-[var(--shadow-sm)] transition-opacity hover:opacity-90"
            >
              Start your first canvas
            </Link>
            <Link
              href="/sign-in"
              className="border-line text-ink-2 hover:border-line-strong hover:text-ink rounded-[var(--radius-lg)] border px-6 py-3 text-[15px] font-medium transition-colors"
            >
              Sign in
            </Link>
          </div>
          <p className="text-ink-3 mt-6 text-[12.5px] leading-relaxed">
            Free while in development. Your words stay yours — AI drafts, you decide.
          </p>
        </div>

        <MiniatureWorld />
      </section>

      {/* The sequence is real: this is genuinely the order of working. */}
      <section className="border-line-subtle border-y bg-[var(--surface-inset)]/50">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-3">
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
            <div key={step} className="relative">
              <span
                className="text-accent-text/70 text-[38px] leading-none font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
                aria-hidden
              >
                {step}
              </span>
              <h2 className="text-ink mt-2 text-[14.5px] font-semibold">{title}</h2>
              <p className="text-ink-3 mt-1.5 text-[13px] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-ink text-[13px] font-medium tracking-[0.14em] uppercase">
          Built for the moment you stand up
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            ] as const
          ).map(([Icon, title, body]) => (
            <div
              key={title}
              className="group border-line-subtle bg-raised hover:border-line rounded-[var(--radius-lg)] border p-5 transition-[border-color,transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
            >
              <Icon className="text-accent size-4" aria-hidden />
              <h3 className="text-ink mt-3 text-[14px] font-semibold">{title}</h3>
              <p className="text-ink-3 mt-1.5 text-[13px] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-line-subtle border-t">
        <div className="text-ink-3 mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-[12px]">
          <span>Captivate — an open project for educators and presenters.</span>
          <Link href="/sign-up" className="text-accent-text font-medium hover:underline">
            Get started
          </Link>
        </div>
      </footer>
    </main>
  );
}

/**
 * The product in one glance: six scenes on one dark canvas, a dotted flight
 * path, and a viewfinder gliding between them — including one dive into a
 * scene nested inside another, which no slide reel can do. Decorative to a
 * screen reader; the copy beside it says the same thing in words.
 */
function MiniatureWorld() {
  return (
    <div aria-hidden className="lw-panel aspect-[16/10.5] w-full select-none">
      {/* Flight path through the scene centres, in canvas coordinates. */}
      <svg className="lw-path" viewBox="0 0 100 66" preserveAspectRatio="none">
        <polyline
          points="14,19 37,12 55,21 56,27 20,48 46,45"
          fill="none"
          stroke="oklch(0.85 0.08 75 / 0.28)"
          strokeWidth="0.5"
          strokeDasharray="1.6 2.2"
          strokeLinecap="round"
        />
      </svg>

      {/* Title scene */}
      <div className="lw-scene" style={{ left: "6%", top: "10%", width: "30%", height: "38%" }}>
        <p
          className="m-0 text-[clamp(10px,1.6vw,19px)] leading-[1.05] font-semibold tracking-tight text-[oklch(0.95_0.02_80)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Hold the room
        </p>
        <div className="lw-bar" style={{ width: "62%" }} />
        <div className="lw-bar" style={{ width: "40%" }} />
      </div>

      {/* Bullets scene */}
      <div className="lw-scene" style={{ left: "44%", top: "4%", width: "24%", height: "30%" }}>
        <div className="lw-bar lw-bar--bright" style={{ width: "70%" }} />
        <div className="lw-bar" style={{ width: "88%" }} />
        <div className="lw-bar" style={{ width: "74%" }} />
        <div className="lw-bar lw-bar--accent" style={{ width: "52%" }} />
      </div>

      {/* Chart scene, with a tiny nested detail scene — the dive. */}
      <div
        className="lw-scene"
        style={{ left: "72.5%", top: "14%", width: "21%", height: "35%" }}
      >
        <div className="lw-bar lw-bar--bright" style={{ width: "58%" }} />
        <div className="lw-col">
          <i style={{ height: "42%" }} />
          <i style={{ height: "68%" }} />
          <i style={{ height: "30%" }} />
          <i style={{ height: "88%" }} />
        </div>
      </div>
      <div
        className="lw-scene"
        style={{ left: "80.5%", top: "35.5%", width: "7.5%", height: "11%", padding: "2% 1.5%" }}
      >
        <div className="lw-bar lw-bar--accent" style={{ width: "80%" }} />
        <div className="lw-bar" style={{ width: "60%" }} />
      </div>

      {/* Quote scene */}
      <div className="lw-scene" style={{ left: "17%", top: "56%", width: "26%", height: "33%" }}>
        <p
          className="m-0 text-[clamp(14px,2.2vw,28px)] leading-none text-[var(--accent)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          „
        </p>
        <div className="lw-bar" style={{ width: "84%" }} />
        <div className="lw-bar" style={{ width: "66%" }} />
        <div className="lw-bar lw-bar--bright" style={{ width: "36%" }} />
      </div>

      {/* Media scene */}
      <div className="lw-scene" style={{ left: "55%", top: "50%", width: "31%", height: "40%" }}>
        <div
          className="flex-1 rounded-[4px]"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.4 0.09 62 / 0.75), oklch(0.28 0.06 285 / 0.8))",
          }}
        />
        <div className="lw-bar" style={{ width: "48%" }} />
      </div>

      {/* The camera */}
      <div className="lw-cam" />
    </div>
  );
}
