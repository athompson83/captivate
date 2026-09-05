"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { EXAMPLE_TITLE } from "@/lib/marketing/example-deck";

/**
 * The live demo's section, and the decision to load it.
 *
 * The stage is the whole presentation engine — the world, the atmosphere,
 * every element renderer — and none of that belongs in the first paint of a
 * marketing page. It is fetched when the section comes within a screen of
 * view, and until then the box that will hold it is already the right shape,
 * so nothing below it moves when it arrives.
 */
const LiveDemoStage = dynamic(() => import("./live-demo-stage").then((m) => m.LiveDemoStage), {
  ssr: false,
  loading: () => <StagePlaceholder />,
});

function StagePlaceholder() {
  return (
    <div
      className="grid aspect-[16/9] w-full place-items-center rounded-[var(--radius-xl)] bg-black"
      aria-hidden
    >
      {/* Legible, not decorative: the axe scan reads this before the stage
          loads, and 40% white on black is 3.65:1. */}
      <p className="text-[13px] text-white/65">{EXAMPLE_TITLE}</p>
    </div>
  );
}

export function LiveDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    // Nothing to observe with: load it. (Old browsers, and jsdom.)
    if (typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => setNear(true), 0);
      return () => clearTimeout(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "50% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="demo" className="shell py-20">
      <div className="rise-in max-w-2xl">
        <h2 className="text-[13px] font-medium tracking-[0.16em] text-[var(--sky-ink-3)] uppercase">
          See it move
        </h2>
        <p
          className="mt-3 text-[clamp(1.5rem,2.4vw,2.3rem)] leading-tight font-semibold text-[var(--sky-ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          This is the real engine, running the first deck every new account opens.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--sky-ink-2)]">
          Press → or tap the stage. The camera flies to each idea, the scene performs when it lands,
          and the last press pulls back to show the whole argument at once.
        </p>
      </div>
      <div ref={hostRef} className="rise-in mt-8">
        {near ? <LiveDemoStage /> : <StagePlaceholder />}
      </div>
    </section>
  );
}
