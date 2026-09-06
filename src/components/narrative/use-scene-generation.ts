"use client";

import { useCallback, useState } from "react";
import { briefsFor } from "@/lib/narrative/generate";
import { composeScene } from "@/lib/editor/layouts";
import { duplicatePresentation } from "@/lib/data/actions";
import { useEditor } from "@/lib/editor/store";
import { useToast } from "@/components/ui/toast";
import { SceneWriteOutcome } from "@/lib/ai/schemas";
import type { SceneContent } from "@/lib/schema/presentation";

/**
 * Generating scenes from an accepted map.
 *
 * The map is the input, not a suggestion alongside one: every request carries
 * the moment's role, purpose, takeaway, evidence, duration, visual intent and
 * its neighbours in the argument.
 *
 * Two rules the implementation exists to hold:
 *
 *  - **A locked moment is never regenerated.** Its scenes are left exactly as
 *    they are, and it is excluded from the request rather than generated and
 *    then discarded.
 *  - **Nothing is destroyed silently.** The caller is told how many scenes will
 *    be replaced before this runs, and scenes belonging to no moment — anything
 *    hand-made — are never touched.
 */
export interface GenerationPlan {
  /** Moments that will be generated. */
  moments: number;
  /** Existing scenes that will be replaced. */
  replacing: number;
  /** Moments skipped because they are locked. */
  locked: number;
  /** Hand-made scenes that will be left alone. */
  untouched: number;
}

export function useSceneGeneration(presentationId: string, prompt: string) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  const plan = useCallback((): GenerationPlan => {
    const { moments, scenes } = useEditor.getState().document;
    const unlocked = moments.filter((moment) => !moment.locked);
    const unlockedIds = new Set(unlocked.map((moment) => moment.id));

    return {
      moments: unlocked.length,
      replacing: scenes.filter((scene) => scene.momentId && unlockedIds.has(scene.momentId)).length,
      locked: moments.length - unlocked.length,
      untouched: scenes.filter((scene) => !scene.momentId).length,
    };
  }, []);

  /**
   * @param keepCopy Duplicate the deck as it stands before replacing anything.
   *
   * The upgrade path for a deck that already exists. A generator fix does not
   * reach stored scenes — the composition a deck was built with is written
   * down — so the only way an existing deck gets the better one is to write it
   * again, and writing it again is destructive by definition. A copy taken
   * first makes it reversible: the author compares the two and keeps whichever
   * is better, rather than deciding in advance and living with it.
   *
   * Taken *before* the model call rather than after, so a generation that
   * half-succeeds cannot leave the author with neither version intact.
   */
  const generate = useCallback(
    async (
      depth: "outline" | "full" = "full",
      { keepCopy = false }: { keepCopy?: boolean } = {},
    ) => {
      const state = useEditor.getState();
      const { sections, moments } = state.document;
      const unlocked = moments.filter((moment) => !moment.locked);

      if (unlocked.length === 0) {
        toast({
          tone: "info",
          title: "Nothing to generate",
          description: "Every moment is locked, so there is nothing for Captivate to write.",
        });
        return;
      }

      setGenerating(true);
      try {
        if (keepCopy) {
          const copied = await duplicatePresentation(presentationId);
          if (!copied.ok) {
            // Not a warning to carry on past: the author asked for the old
            // deck to survive and it would not have.
            toast({
              tone: "error",
              title: "Nothing was regenerated",
              description: `The copy could not be made, so the deck was left alone. ${copied.error}`,
            });
            return;
          }
          toast({
            tone: "info",
            title: "Copy saved",
            description: "The deck as it was is on your dashboard. Writing the new one now.",
          });
        }

        const briefs = briefsFor(sections, moments).filter((brief) =>
          unlocked.some((moment) => moment.id === brief.momentId),
        );

        const response = await fetch("/api/ai/scenes-from-map", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: prompt || "Generate this presentation.",
            presentationId,
            briefs,
            depth,
          }),
        });
        const body: unknown = await response.json();
        // The route streams heartbeats while the model writes, so a failure
        // can arrive on a 200 as an `error` field rather than as a status.
        const reported =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : null;
        if (!response.ok || reported) {
          throw new Error(reported ?? "Couldn't generate scenes.");
        }

        // The scenes are already written. The route saves them itself now —
        // this used to be a loop here, which put a five-minute job behind the
        // phone staying awake, and a lock screen between the answer arriving
        // and the last save left a deck half rewritten and looking finished.
        const outcome = SceneWriteOutcome.safeParse(body);
        if (!outcome.success) {
          throw new Error("The generated scenes came back in a shape this editor cannot read.");
        }
        const { saved, unplaceable, notice } = outcome.data;

        toast({
          tone: "success",
          title: `${saved} ${saved === 1 ? "scene" : "scenes"} generated`,
          description:
            notice ??
            (unplaceable
              ? `Generated from your narrative map. ${unplaceable} ${unplaceable === 1 ? "scene" : "scenes"} named a moment this deck no longer has and ${unplaceable === 1 ? "was" : "were"} left out.`
              : "Generated from your narrative map."),
        });

        // The document has changed underneath the store; a reload is the honest
        // way to show it rather than reconstructing state that the server owns.
        window.location.reload();
      } catch (error) {
        toast({
          tone: "error",
          title: "Couldn't generate scenes",
          description: error instanceof Error ? error.message : "Try again in a moment.",
        });
      } finally {
        setGenerating(false);
      }
    },
    [presentationId, prompt, toast],
  );

  return { generate, generating, plan };
}

/** Composes a scene without a model, from a moment's own definition. */
export function structuralScene(title: string, purpose: string): SceneContent {
  return composeScene("statement", { heading: title, subheading: purpose });
}
