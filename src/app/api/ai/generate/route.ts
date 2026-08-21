import { NextResponse } from "next/server";
import { z } from "zod";
import { buildScenes } from "@/lib/ai/service";
import { PresentationOutline } from "@/lib/ai/schemas";
import { AudienceInput, guard, LIMITS } from "@/lib/ai/route-helpers";
import { addScene, addSection, createPresentation, saveScene } from "@/lib/data/actions";
import { supabaseServer } from "@/lib/supabase/server";
import { THEMES } from "@/lib/schema/theme";

export const maxDuration = 120;

const Input = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    outline: PresentationOutline,
    themeId: z.string().max(64).optional(),
  })
  .merge(AudienceInput);

/**
 * Approved outline → a real presentation.
 *
 * The deck is created first and scenes are written into it one at a time, so a
 * failure part-way through leaves the user with a usable partial deck rather
 * than nothing. Content is validated before it is persisted, never after.
 */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, LIMITS.heavy, ["presentation"]);
  if (!guarded.ok) return guarded.response;

  const { prompt, outline, themeId, ...context } = guarded.input;

  const built = await buildScenes(outline, prompt, context, null);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 502 });

  const theme = THEMES.some((t) => t.id === themeId)
    ? themeId
    : THEMES.some((t) => t.id === outline.suggestedThemeId)
      ? outline.suggestedThemeId
      : "midnight";

  const created = await createPresentation({
    title: outline.title,
    themeId: theme,
    aspectRatio: "16:9",
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 500 });

  const presentationId = created.data.id;
  const supabase = await supabaseServer();

  // Sections, in outline order.
  const sectionIds: (string | null)[] = [];
  for (const section of outline.sections) {
    const result = await addSection({ presentationId, title: section.title });
    sectionIds.push(result.ok ? result.data.id : null);
  }

  // Map each generated scene back to the section it came from.
  const sectionForScene: (string | null)[] = [];
  outline.sections.forEach((section, sectionIndex) => {
    for (let i = 0; i < section.scenes.length; i += 1)
      sectionForScene.push(sectionIds[sectionIndex]);
  });

  // `createPresentation` seeded one placeholder scene; the first generated
  // scene replaces it so the deck never opens with an empty first slide.
  const { data: seeded } = await supabase
    .from("scenes")
    .select("id")
    .eq("presentation_id", presentationId)
    .order("position")
    .limit(1);

  const seedId = seeded?.[0]?.id ?? null;
  let written = 0;
  let previousId: string | null = null;

  for (const [index, scene] of built.data.scenes.entries()) {
    if (index === 0 && seedId) {
      const saved = await saveScene({
        id: seedId,
        presentationId,
        title: scene.title,
        content: scene.content,
        speakerNotes: scene.speakerNotes,
        sectionId: sectionForScene[index] ?? null,
      });
      if (saved.ok) {
        written += 1;
        previousId = seedId;
      }
      continue;
    }

    const added = await addScene({
      presentationId,
      afterSceneId: previousId,
      sectionId: sectionForScene[index] ?? null,
      title: scene.title,
      content: scene.content,
      speakerNotes: scene.speakerNotes,
    });
    if (added.ok) {
      written += 1;
      previousId = added.data.id;
    }
  }

  if (written === 0) {
    return NextResponse.json(
      { error: "The presentation couldn't be written. Nothing was created." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: presentationId,
    sceneCount: written,
    source: built.data.source,
    notice: built.data.notice,
  });
}
