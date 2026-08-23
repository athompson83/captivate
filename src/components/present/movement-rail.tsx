"use client";

import { memo, useMemo } from "react";
import type { Scene, Section } from "@/lib/schema/presentation";

/**
 * The movement rail.
 *
 * A quiet index of the argument down the edge of the stage, with the movement
 * the room is currently in lit and the ones behind it dimmed. It is shown to
 * the *audience*, deliberately, and it is the one thing a stack of slides can
 * never tell them: where they are, how far in, and how much is left.
 *
 * It is not navigation and it is not chrome to be read. It occupies a sliver of
 * the frame, carries no interaction, and is legible in peripheral vision — the
 * job is to be answerable at a glance when someone's attention drifts, not to
 * compete with the thing being said.
 */

export interface Movement {
  id: string;
  label: string;
  /** Index of the first scene in this movement. */
  start: number;
  /** Index after the last scene in this movement. */
  end: number;
}

/**
 * Groups scenes into movements.
 *
 * Scenes with no section form their own leading movement rather than being
 * dropped: a presentation half-organised into sections is a normal state to be
 * in, and hiding the loose scenes would make the rail lie about the length of
 * the thing.
 */
export function movementsOf(scenes: Scene[], sections: Section[]): Movement[] {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const movements: Movement[] = [];

  scenes.forEach((scene, index) => {
    const current = movements[movements.length - 1];
    const id = scene.sectionId ?? "";

    if (current && current.id === id) {
      current.end = index + 1;
      return;
    }

    const section = scene.sectionId ? byId.get(scene.sectionId) : undefined;
    movements.push({
      id,
      // The short label where one is authored, the section's own title where
      // not, and nothing to invent when a scene belongs to no section.
      label: section ? section.label.trim() || section.title.trim() : "",
      start: index,
      end: index + 1,
    });
  });

  return movements;
}

/** The movement containing a scene index, if any. */
export function movementAt(movements: Movement[], sceneIndex: number): Movement | null {
  return movements.find((m) => sceneIndex >= m.start && sceneIndex < m.end) ?? null;
}

/**
 * The movement after the current one, but only when the current scene is its
 * last. A signpost means something at the end of a movement and nothing in the
 * middle of one.
 */
export function nextMovement(movements: Movement[], sceneIndex: number): Movement | null {
  const index = movements.findIndex((m) => sceneIndex >= m.start && sceneIndex < m.end);
  if (index === -1) return null;
  if (sceneIndex !== movements[index].end - 1) return null;
  return movements[index + 1] ?? null;
}

export const MovementRail = memo(function MovementRail({
  movements,
  sceneIndex,
  totalScenes,
}: {
  movements: Movement[];
  sceneIndex: number;
  totalScenes: number;
}) {
  // One movement is not a structure, and a rail describing it says nothing.
  const meaningful = useMemo(() => movements.filter((m) => m.label.length > 0), [movements]);
  if (meaningful.length < 2 || totalScenes === 0) return null;

  const activeIndex = movements.findIndex((m) => sceneIndex >= m.start && sceneIndex < m.end);
  const progress = Math.min(1, Math.max(0, (sceneIndex + 1) / totalScenes));

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-[132px] sm:block"
      aria-hidden
    >
      <div className="relative flex h-full flex-col justify-between py-[7vh] pl-[3.2vw]">
        {/* The spine, filled to how far through the whole thing the room is. */}
        <div className="absolute top-[7vh] bottom-[7vh] left-[3.2vw] w-px bg-white/12">
          <div
            className="w-px bg-[var(--stage-accent)] transition-[height] duration-700 ease-[var(--ease-out-quint)]"
            style={{ height: `${progress * 100}%` }}
          />
        </div>

        {movements.map((movement, index) => {
          const active = index === activeIndex;
          const passed = index < activeIndex;
          if (!movement.label) return <span key={`${movement.id}-${index}`} />;

          return (
            <div key={`${movement.id}-${index}`} className="relative flex items-center gap-3">
              <span
                className="relative z-10 block size-[7px] shrink-0 rounded-full transition-colors duration-500"
                style={{
                  background: active
                    ? "var(--stage-accent)"
                    : passed
                      ? "color-mix(in oklab, var(--stage-accent) 45%, transparent)"
                      : "color-mix(in oklab, var(--stage-ink) 26%, transparent)",
                  marginLeft: "-3px",
                }}
              />
              <span
                className="truncate text-[10.5px] font-medium tracking-[0.16em] uppercase transition-colors duration-500"
                style={{
                  color: active
                    ? "var(--stage-ink)"
                    : "color-mix(in oklab, var(--stage-ink) 38%, transparent)",
                }}
              >
                {movement.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * The signpost at the end of a movement.
 *
 * Names what comes next and says the argument is continuous. It is not a
 * spoiler — the room is about to see it anyway — it is the difference between
 * "another slide happened" and "we are moving on to the next thing".
 */
export function MovementSignpost({
  movement,
  index,
  sceneTitle,
}: {
  movement: Movement;
  index: number;
  sceneTitle: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[3.4vh] z-10 text-center"
      aria-hidden
    >
      <p className="text-[10px] font-medium tracking-[0.2em] text-[var(--stage-accent)] uppercase">
        Next movement · {String(index + 1).padStart(2, "0")}
      </p>
      <p
        className="mt-1.5 text-[1.4vw] leading-tight font-medium"
        style={{ color: "var(--stage-ink)" }}
      >
        {movement.label}
        {sceneTitle && movement.label !== sceneTitle ? ` — ${sceneTitle}` : ""}
      </p>
      <p
        className="mt-1 text-[0.72vw]"
        style={{ color: "color-mix(in oklab, var(--stage-ink) 42%, transparent)" }}
      >
        The narrative continues without a break.
      </p>
    </div>
  );
}
