"use client";

import { useState, useTransition } from "react";
import { Check, Route, RotateCcw } from "lucide-react";
import type { ArrangePreset } from "@/lib/schema/presentation";
import { ARRANGEMENTS, arrange } from "@/lib/present/arrange";
import { stageSize } from "@/lib/present/stage";
import { setScenePlacements } from "@/lib/data/actions";
import {
  applyPlacements,
  updatePresentationMeta,
  updateSectionLocal,
  useEditor,
} from "@/lib/editor/store";
import { Field, Segmented, Slider, Toggle } from "@/components/ui/misc";
import { HealthPanel } from "./health-panel";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

/**
 * Journey settings.
 *
 * The right-hand panel while the journey map is open. Everything here is about
 * how the camera behaves across the whole presentation — there is deliberately
 * no per-scene transition control, because choosing a different wipe for slide
 * seven is the habit this tool exists to replace.
 */
export function JourneyPanel({ presentationId }: { presentationId: string }) {
  const { toast } = useToast();
  const scenes = useEditor((s) => s.document.scenes);
  const sections = useEditor((s) => s.document.sections);
  const presentation = useEditor((s) => s.document.presentation);
  const journey = presentation.journey;
  const [pending, start] = useTransition();
  const [applied, setApplied] = useState<ArrangePreset | null>(null);

  const applyArrangement = (preset: ArrangePreset) => {
    const stage = stageSize(presentation.aspectRatio);
    const placements = arrange(preset, scenes, stage);
    const entries = scenes.map((scene, i) => ({ id: scene.id, placement: placements[i] }));

    // Stamped locally first so the map moves immediately and the whole
    // rearrangement is one undo step; the write below is the same values.
    updatePresentationMeta({ journey: { ...journey, arrangement: preset } }, { label: "Arrange" });
    applyPlacements(entries);
    setApplied(preset);

    start(async () => {
      const result = await setScenePlacements({ presentationId, placements: entries });
      if (!result.ok) {
        toast({ tone: "error", title: "Positions not saved", description: result.error });
      }
    });
  };

  const resetPositions = () => {
    const entries = scenes.map((scene) => ({ id: scene.id, placement: null }));
    start(async () => {
      const result = await setScenePlacements({ presentationId, placements: entries });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't reset", description: result.error });
        return;
      }
      // Cleared on the server; mirror it locally so the preset shows through.
      applyPlacements([]);
      window.location.reload();
    });
  };

  return (
    <aside className="border-line-subtle bg-base hidden w-[272px] shrink-0 flex-col border-l lg:flex">
      <div className="border-line-subtle flex h-11 shrink-0 items-center gap-2 border-b px-3.5">
        <Route className="text-ink-3 size-3.5" aria-hidden />
        <h2 className="text-ink text-[12.5px] font-semibold tracking-tight">Journey</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3.5">
        <HealthPanel />

        <section>
          <h3 className="text-ink-3 mb-2 text-[11px] font-medium tracking-wide uppercase">
            Arrangement
          </h3>
          <div className="space-y-1.5">
            {ARRANGEMENTS.map((option) => {
              const active = journey.arrangement === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => applyArrangement(option.id)}
                  disabled={pending}
                  className={cn(
                    "w-full rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition-colors disabled:opacity-60",
                    active
                      ? "border-accent bg-[var(--accent-soft)]"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <span className="text-ink flex items-center gap-1.5 text-[12.5px] font-medium">
                    {option.label}
                    {active && applied === option.id && (
                      <Check className="text-accent size-3" aria-hidden />
                    )}
                  </span>
                  <span className="text-ink-3 mt-0.5 block text-[11px] leading-snug">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={resetPositions}
            disabled={pending}
            className="border-line text-ink-2 hover:border-line-strong hover:text-ink mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border py-1.5 text-[11.5px] transition-colors disabled:opacity-60"
          >
            <RotateCcw className="size-3" aria-hidden />
            Clear hand-placed positions
          </button>
        </section>

        {sections.length > 0 && (
          <section className="border-line-subtle space-y-2 border-t pt-4">
            <h3 className="text-ink-3 text-[11px] font-medium tracking-wide uppercase">
              Movements
            </h3>
            <p className="text-ink-3 text-[11px] leading-relaxed">
              One word for what each part of the argument does. The room sees these, so it always
              knows where it is.
            </p>
            {sections.map((section, index) => {
              const count = scenes.filter((scene) => scene.sectionId === section.id).length;
              return (
                <div key={section.id} className="flex items-center gap-2">
                  <span className="text-ink-3 w-4 shrink-0 text-[10px] tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={section.label}
                    onChange={(e) =>
                      updateSectionLocal(section.id, { label: e.target.value.slice(0, 24) })
                    }
                    placeholder={section.title}
                    aria-label={`Movement label for ${section.title}`}
                    className="border-line text-ink placeholder:text-ink-3 focus:border-accent min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-[var(--surface-inset)] px-2 py-1 text-[11.5px] font-medium tracking-wider uppercase outline-none"
                  />
                  <span className="text-ink-3 w-8 shrink-0 text-right text-[10px] tabular-nums">
                    {count}
                  </span>
                </div>
              );
            })}
          </section>
        )}

        <section className="border-line-subtle space-y-3 border-t pt-4">
          <h3 className="text-ink-3 text-[11px] font-medium tracking-wide uppercase">Camera</h3>

          <Field label="Travel">
            <Segmented<"fly" | "cut" | "dissolve">
              label="Travel"
              size="sm"
              value={journey.travel}
              onChange={(v) =>
                updatePresentationMeta(
                  { journey: { ...journey, travel: v } },
                  { label: "Change travel" },
                )
              }
              options={[
                { value: "fly", label: "Fly" },
                { value: "dissolve", label: "Dissolve" },
                { value: "cut", label: "Cut" },
              ]}
            />
          </Field>

          {journey.travel === "fly" && (
            <>
              <Slider
                label="Pace"
                value={journey.pace}
                min={0.4}
                max={3}
                step={0.05}
                format={(v) => `${v.toFixed(2)}s`}
                onChange={(v) =>
                  updatePresentationMeta(
                    { journey: { ...journey, pace: v } },
                    { label: "Change pace", coalesceKey: "journey-pace" },
                  )
                }
              />
              <Slider
                label="Depth"
                value={journey.depth}
                min={0}
                max={1}
                step={0.05}
                format={(v) => (v === 0 ? "Flat" : v.toFixed(2))}
                onChange={(v) =>
                  updatePresentationMeta(
                    { journey: { ...journey, depth: v } },
                    { label: "Change depth", coalesceKey: "journey-depth" },
                  )
                }
              />
            </>
          )}

          <Toggle
            label="Establish sections"
            hint="Pull back to show a whole section before diving into its first scene."
            checked={journey.establishSections}
            onChange={(v) =>
              updatePresentationMeta(
                { journey: { ...journey, establishSections: v } },
                { label: "Toggle section establish" },
              )
            }
          />

          <Toggle
            label="Show movements to the room"
            hint="A quiet index of the argument down the edge of the stage."
            checked={journey.showMovements}
            onChange={(v) =>
              updatePresentationMeta(
                { journey: { ...journey, showMovements: v } },
                { label: "Toggle movement rail" },
              )
            }
          />

          <Toggle
            label="Name the next movement"
            hint="Appears as one movement ends, so the argument reads as continuous."
            checked={journey.signpostNext}
            onChange={(v) =>
              updatePresentationMeta(
                { journey: { ...journey, signpostNext: v } },
                { label: "Toggle signpost" },
              )
            }
          />

          <Toggle
            label="Show the route"
            hint="Draw the path between scenes when the camera is pulled back."
            checked={journey.showPath}
            onChange={(v) =>
              updatePresentationMeta(
                { journey: { ...journey, showPath: v } },
                { label: "Toggle route" },
              )
            }
          />
        </section>

        <p className="text-ink-3 border-line-subtle border-t pt-4 text-[11px] leading-relaxed">
          Press <kbd className="text-ink-2">O</kbd> while presenting to pull the camera back over
          the whole world, then click any scene to fly to it.
        </p>
      </div>
    </aside>
  );
}
