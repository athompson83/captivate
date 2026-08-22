import { NextResponse } from "next/server";
import { z } from "zod";
import { buildScenesFromMap } from "@/lib/ai/service";
import { ProposedMap } from "@/lib/ai/schemas";
import { AudienceInput, guard, LIMITS } from "@/lib/ai/route-helpers";
import { briefsFor, draftFromProposal } from "@/lib/narrative/generate";
import { listEvidence } from "@/lib/data/evidence";
import { createPresentation } from "@/lib/data/actions";
import { supabaseServer } from "@/lib/supabase/server";
import { THEMES } from "@/lib/schema/theme";
import type { MomentRow, SceneRow } from "@/lib/supabase/database.types";

export const maxDuration = 120;

const Input = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    /** The map as the author edited it, still without ids. */
    map: ProposedMap,
    totalSeconds: z.number().int().min(60).max(14_400).default(900),
    themeId: z.string().max(64).optional(),
    folderId: z.string().uuid().nullable().default(null),
  })
  .merge(AudienceInput);

/**
 * An accepted narrative map → a real presentation.
 *
 * The map arrives without ids and leaves with them: identity is assigned here,
 * and evidence is verified here against what this user actually owns. Both
 * would be wrong to take from the request — a client that could name its own
 * evidence list is a client that could ground a claim in somebody else's
 * material.
 *
 * The map is written before the scenes, and the scenes are written one at a
 * time. A failure part-way through therefore leaves an author with their
 * argument intact and some of it rendered, which they can finish from the map
 * view — rather than with nothing.
 */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, LIMITS.heavy, ["map", "presentation"]);
  if (!guarded.ok) return guarded.response;

  const { prompt, map, totalSeconds, themeId, folderId, ...context } = guarded.input;

  const theme = THEMES.some((t) => t.id === themeId)
    ? themeId
    : THEMES.some((t) => t.id === map.suggestedThemeId)
      ? map.suggestedThemeId
      : "midnight";

  const created = await createPresentation({
    title: map.title,
    themeId: theme,
    aspectRatio: "16:9",
    folderId,
    // The running time the author asked for, kept on the presentation rather
    // than only spent distributing seconds across the map. Without it the
    // editor opened with no target: the duration warning had nothing to warn
    // about and rescaling had nothing to rescale to.
    targetSeconds: totalSeconds,
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 500 });

  const presentationId = created.data.id;
  const supabase = await supabaseServer();
  const available = await listEvidence();

  const { draft, droppedEvidence } = draftFromProposal(map, {
    presentationId,
    totalSeconds,
    available,
  });

  const { error: movementError } = await supabase.from("sections").insert(
    draft.movements.map((movement) => ({
      id: movement.id,
      presentation_id: presentationId,
      title: movement.title,
      label: movement.label,
      purpose: movement.purpose,
      position: movement.position,
    })),
  );

  const { error: momentError } = await supabase.from("moments").insert(
    draft.moments.map((moment) => ({
      id: moment.id,
      presentation_id: presentationId,
      movement_id: movementError ? null : moment.movementId,
      position: moment.position,
      title: moment.title,
      role: moment.role,
      purpose: moment.purpose,
      takeaway: moment.takeaway,
      estimated_seconds: moment.estimatedSeconds,
      evidence: moment.evidence as unknown as MomentRow["evidence"],
      visual_intent: moment.visualIntent,
      instructions: moment.instructions,
      locked: false,
    })),
  );

  // The map is the point of this route. Without it there is nothing to
  // generate from and nothing to come back and edit, so this is the one
  // failure that undoes the whole thing rather than degrading.
  if (momentError) {
    await supabase.from("presentations").delete().eq("id", presentationId);
    return NextResponse.json(
      { error: "Your narrative map couldn't be saved, so nothing was created." },
      { status: 500 },
    );
  }

  const built = await buildScenesFromMap(
    briefsFor(draft.movements, draft.moments),
    prompt,
    context,
    presentationId,
  );

  // The map survives a failed generation: the author lands in the map view
  // with their argument and generates the scenes when the model is available.
  if (!built.ok) {
    return NextResponse.json({
      id: presentationId,
      sceneCount: 0,
      source: "fallback" as const,
      droppedEvidence,
      notice: `Your narrative map was saved, but the scenes couldn't be written: ${built.error} Open the map and generate them again.`,
    });
  }

  // `createPresentation` seeded one placeholder scene; the first generated
  // scene replaces it so the presentation never opens on an empty one.
  const { data: seeded } = await supabase
    .from("scenes")
    .select("id")
    .eq("presentation_id", presentationId)
    .order("position")
    .limit(1);

  const seedId = seeded?.[0]?.id ?? null;
  const byMoment = new Map(draft.moments.map((moment) => [moment.id, moment]));
  const rows: Partial<SceneRow>[] = [];

  built.data.scenes.forEach((scene, index) => {
    const moment = byMoment.get(scene.momentId);
    rows.push({
      ...(index === 0 && seedId ? { id: seedId } : {}),
      presentation_id: presentationId,
      section_id: movementError ? null : (moment?.movementId ?? null),
      moment_id: scene.momentId,
      position: index,
      title: scene.title,
      content: scene.content as unknown as SceneRow["content"],
      speaker_notes: scene.speakerNotes,
      duration_seconds: moment?.estimatedSeconds ?? null,
    });
  });

  const { error: sceneError, count } = await supabase
    .from("scenes")
    .upsert(rows as never, { count: "exact" });

  if (sceneError) {
    return NextResponse.json({
      id: presentationId,
      sceneCount: 0,
      source: built.data.source,
      droppedEvidence,
      notice:
        "Your narrative map was saved, but the scenes couldn't be written. Open the map and generate them again.",
    });
  }

  return NextResponse.json({
    id: presentationId,
    sceneCount: count ?? rows.length,
    source: built.data.source,
    droppedEvidence,
    notice: built.data.notice,
  });
}
