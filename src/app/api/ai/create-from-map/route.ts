import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildScenesFromMap } from "@/lib/ai/service";
import { ProposedMap } from "@/lib/ai/schemas";
import { AudienceInput, guard } from "@/lib/ai/route-helpers";
import { briefsFor, draftFromProposal } from "@/lib/narrative/generate";
import { weaveAsides } from "@/lib/ai/weave-asides";
import { listEvidence } from "@/lib/data/evidence";
import { createPresentation } from "@/lib/data/actions";
import { supabaseServer } from "@/lib/supabase/server";
import { THEMES } from "@/lib/schema/theme";
import type { MomentRow, SceneRow } from "@/lib/supabase/database.types";

// The platform ceiling: one scenes call at full depth plus the parallel
// drawing pass is minutes of model time, and a duration cap that fires
// mid-generation bills the tokens and saves nothing.
export const maxDuration = 300;

const Input = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    /** The map as the author edited it, still without ids. */
    map: ProposedMap,
    totalSeconds: z.number().int().min(60).max(14_400).default(900),
    /** How much writing to do: the full talk, or a frame the author fills in. */
    depth: z.enum(["outline", "full"]).default("full"),
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
 * time, so a failure while rendering leaves an author with their argument
 * intact and some of it rendered, which they can finish from the map view.
 * A failure writing the map itself is different: half a map is not a map the
 * author can come back to, so it is rolled back rather than degraded.
 */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, "deck", ["map", "presentation"]);
  if (!guarded.ok) return guarded.response;

  const { prompt, map, totalSeconds, depth, themeId, folderId, ...context } = guarded.input;

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

  // Carrying on with `movement_id: null` wrote every beat unplaced and called
  // it a success — a map with no structure at all, which is worse than none.
  if (movementError) {
    await supabase.from("presentations").delete().eq("id", presentationId);
    return NextResponse.json(
      { error: "Your narrative map couldn't be saved, so nothing was created." },
      { status: 500 },
    );
  }

  const { error: momentError } = await supabase.from("moments").insert(
    draft.moments.map((moment) => ({
      id: moment.id,
      presentation_id: presentationId,
      movement_id: moment.movementId,
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

  // Same reason: the map is the point of this route, and without its beats
  // there is nothing to generate from and nothing to come back and edit.
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
    depth,
    totalSeconds,
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

  // Asides become real detail scenes here, after identity exists: the weave
  // assigns every row's id and wires each parent's hotspot to its detail
  // scene's id in the same payload, so a dangling reference cannot be
  // written. Row 0 is always a main scene (details follow their parents), so
  // reusing the seeded scene's id for it never breaks a hotspot target.
  const woven = weaveAsides(
    built.data.scenes.map((scene) => ({
      momentId: scene.momentId,
      title: scene.title,
      content: scene.content,
      speakerNotes: scene.speakerNotes,
      detail: scene.detail,
    })),
    randomUUID,
  );

  // Every row carries an id, including the ones being created.
  //
  // A bulk insert is one statement, so PostgREST needs one column list:
  // postgrest-js takes the union of the objects' keys and sends missing
  // ones as NULL. Giving only row 0 an `id` therefore did not mean "let
  // the database default the rest" — it meant `id = NULL` on every other
  // row, which the primary key rejects. The whole write failed, and since
  // `createPresentation` always seeds a scene there was always a row 0
  // with an id: the AI path could not write scenes at all.
  const rows: Partial<SceneRow>[] = woven.map((row, index) => {
    const moment = byMoment.get(row.filedUnder);
    return {
      id: index === 0 && seedId ? seedId : row.id,
      presentation_id: presentationId,
      section_id: moment?.movementId ?? null,
      moment_id: row.momentId,
      position: index,
      title: row.title,
      content: row.content as unknown as SceneRow["content"],
      speaker_notes: row.speakerNotes,
      // A detail scene is an aside; it has no place in the running time.
      duration_seconds: row.flowRole === "main" ? (moment?.estimatedSeconds ?? null) : null,
      flow_role: row.flowRole,
    };
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
