"use client";

import { useCallback, useState } from "react";
import { briefsFor } from "@/lib/narrative/generate";
import { composeScene } from "@/lib/editor/layouts";
import { addScene, linkScenesToMoments, saveScene } from "@/lib/data/actions";
import { useEditor } from "@/lib/editor/store";
import { useToast } from "@/components/ui/toast";
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

  const generate = useCallback(async () => {
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
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Couldn't generate scenes.");

      const written: {
        momentId: string;
        title: string;
        content: SceneContent;
        speakerNotes: string;
      }[] = body.scenes ?? [];

      // Reuse the scene a moment already owns rather than deleting and
      // recreating it: the scene's own id is what recordings, thumbnails and
      // any future note anchor already point at.
      const links: { sceneId: string; momentId: string | null }[] = [];
      for (const generated of written) {
        const existing = useEditor
          .getState()
          .document.scenes.find((scene) => scene.momentId === generated.momentId);

        if (existing) {
          await saveScene({
            id: existing.id,
            presentationId,
            title: generated.title,
            content: generated.content,
            speakerNotes: generated.speakerNotes,
          });
          continue;
        }

        const moment = moments.find((m) => m.id === generated.momentId);
        const created = await addScene({
          presentationId,
          sectionId: moment?.movementId ?? null,
          title: generated.title,
          content: generated.content,
          speakerNotes: generated.speakerNotes,
        });
        if (created.ok) links.push({ sceneId: created.data.id, momentId: generated.momentId });
      }

      if (links.length) await linkScenesToMoments({ presentationId, links });

      toast({
        tone: "success",
        title: `${written.length} ${written.length === 1 ? "scene" : "scenes"} generated`,
        description: body.notice ?? "Generated from your narrative map.",
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
  }, [presentationId, prompt, toast]);

  return { generate, generating, plan };
}

/** Composes a scene without a model, from a moment's own definition. */
export function structuralScene(title: string, purpose: string): SceneContent {
  return composeScene("statement", { heading: title, subheading: purpose });
}
