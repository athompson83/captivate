"use client";

import { motion } from "motion/react";
import { ArrowRight, Play, Sparkles } from "lucide-react";

const modes = [
  { name: "Library", detail: "Organize presentations, lecture notes, media, and reusable assets." },
  { name: "Studio", detail: "Compose responsive scenes with AI, motion, media, and structured notes." },
  { name: "Presenter", detail: "Deliver with private notes, timers, annotation, spotlight, and recording." },
];

export function CaptivateShell() {
  return (
    <main className="min-h-screen overflow-hidden bg-[var(--surface)] text-[var(--ink)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_50%_0%,rgba(125,92,255,.18),transparent_62%)]" />
      <section className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 lg:px-10">
        <header className="flex items-center justify-between border-b border-black/5 pb-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-black text-white shadow-lg shadow-black/10">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">Captivate</p>
              <p className="text-xs text-black/45">Presentation journeys</p>
            </div>
          </div>
          <span className="rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-black/55 backdrop-blur">Foundation concept</span>
        </header>

        <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_.95fr]">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65 }}>
            <p className="mb-5 text-sm font-medium text-[var(--accent)]">The presentation should feel alive.</p>
            <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[.96] tracking-[-.055em] sm:text-6xl lg:text-7xl">
              Stop making slides. Build an experience.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-black/55">
              Captivate combines authoring, motion, lecture notes, AI assistance, presenter tools, and recording in one web-native workspace.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white shadow-xl shadow-black/10 transition-transform hover:-translate-y-0.5">
                Create a journey <ArrowRight className="size-4" />
              </button>
              <button className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-5 py-3 text-sm font-medium backdrop-blur transition-colors hover:bg-white">
                <Play className="size-4" /> Open presenter
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.7 }}
            className="relative rounded-[2rem] border border-white/80 bg-white/68 p-3 shadow-2xl shadow-violet-950/10 backdrop-blur-xl"
          >
            <div className="rounded-[1.55rem] border border-black/5 bg-[#111113] p-5 text-white shadow-inner">
              <div className="mb-16 flex items-center justify-between text-xs text-white/45">
                <span>Art of Resuscitation</span><span>Scene 04 / 18</span>
              </div>
              <div className="max-w-lg py-8">
                <p className="text-xs font-medium uppercase tracking-[.18em] text-violet-300">Interactive moment</p>
                <h2 className="mt-4 text-4xl font-medium tracking-[-.04em]">What happens in the first 180 seconds?</h2>
                <div className="mt-8 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[62%] rounded-full bg-white" /></div>
              </div>
              <div className="mt-14 grid grid-cols-3 gap-2">
                {modes.map((mode) => (
                  <div key={mode.name} className="rounded-2xl border border-white/10 bg-white/[.055] p-3">
                    <p className="text-xs font-medium">{mode.name}</p>
                    <p className="mt-1 hidden text-[11px] leading-4 text-white/40 sm:block">{mode.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
