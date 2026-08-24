"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import type { PresentationRecord, Scene, Section } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { StageThumbnail } from "@/components/stage/stage";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";

/**
 * Every scene, one to a page, through the same renderer the room saw.
 *
 * The width is a constant rather than a measurement: print has no resize
 * events, and a deterministic scale means the PDF that comes out of the print
 * dialog is identical on every machine. 660px is chosen to sit inside both
 * A4 and Letter once the page margins are taken off.
 */
const PAGE_STAGE_WIDTH = 660;

export function HandoutView({
  presentation,
  scenes,
  sections,
}: {
  presentation: PresentationRecord;
  scenes: Scene[];
  sections: Section[];
}) {
  const [withNotes, setWithNotes] = useState(false);
  const theme = getTheme(presentation.themeId);
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  return (
    <div className="handout bg-base min-h-screen print:bg-white">
      {/* Screen-only controls; the printed page carries none of this. */}
      <header className="border-line-subtle bg-base sticky top-0 z-10 border-b print:hidden">
        <div className="mx-auto flex max-w-[740px] items-center gap-3 px-6 py-3">
          <Link
            href={`/edit/${presentation.id}`}
            aria-label="Back to editor"
            className="text-ink-3 hover:text-ink flex size-8 items-center justify-center rounded-[var(--radius-md)] transition-colors hover:bg-[var(--surface-inset)]"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <p className="text-ink min-w-0 flex-1 truncate text-[13.5px] font-medium">
            {presentation.title} — handout
          </p>
          <Toggle label="Speaker notes" checked={withNotes} onChange={setWithNotes} />
          <Button variant="primary" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" aria-hidden />
            Print or save PDF
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[740px] px-6 py-10 print:max-w-none print:p-0">
        {/* Cover: the argument at a glance. */}
        <section className="handout-page mb-12 print:mb-0">
          <p className="text-ink-3 text-[11px] font-medium tracking-[0.16em] uppercase">
            Presentation handout
          </p>
          <h1
            className="text-ink mt-3 text-[34px] leading-tight font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {presentation.title}
          </h1>
          {presentation.description && (
            <p className="text-ink-2 mt-3 max-w-[52ch] text-[14px] leading-relaxed">
              {presentation.description}
            </p>
          )}

          {sections.length > 0 && (
            <ol className="mt-8 space-y-2">
              {sections.map((section, i) => (
                <li key={section.id} className="flex items-baseline gap-3">
                  <span className="text-ink-3 w-5 text-right text-[12px] tabular-nums">
                    {i + 1}
                  </span>
                  {section.label && (
                    <span className="text-accent-text text-[10.5px] font-medium tracking-[0.14em] uppercase">
                      {section.label}
                    </span>
                  )}
                  <span className="text-ink text-[13.5px] font-medium">{section.title}</span>
                </li>
              ))}
            </ol>
          )}

          <p className="text-ink-3 mt-8 text-[12px]">
            {scenes.length} scene{scenes.length === 1 ? "" : "s"} · made with Captivate
          </p>
        </section>

        {scenes.map((scene, index) => {
          const section = scene.sectionId ? sectionById.get(scene.sectionId) : null;
          return (
            <section key={scene.id} className="handout-page mb-12 print:mb-0">
              <div className="mb-3 flex items-baseline gap-3">
                <span className="text-ink-3 text-[12px] tabular-nums">
                  {index + 1} / {scenes.length}
                </span>
                {section?.label && (
                  <span className="text-accent-text text-[10.5px] font-medium tracking-[0.14em] uppercase">
                    {section.label}
                  </span>
                )}
                {scene.title && (
                  <span className="text-ink min-w-0 truncate text-[13.5px] font-medium">
                    {scene.title}
                  </span>
                )}
              </div>

              <div className="border-line-subtle overflow-x-auto overflow-y-hidden rounded-[var(--radius-md)] border print:rounded-none">
                <StageThumbnail
                  content={scene.content}
                  theme={theme}
                  aspect={presentation.aspectRatio}
                  width={PAGE_STAGE_WIDTH}
                  className="mx-auto"
                />
              </div>

              {withNotes && scene.speakerNotes.trim() && (
                <div className={cn("mt-4", "print:mt-3")}>
                  <p className="text-ink-3 text-[10.5px] font-medium tracking-[0.14em] uppercase">
                    Speaker notes
                  </p>
                  <p className="text-ink-2 mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap">
                    {scene.speakerNotes}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}
