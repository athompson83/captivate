"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import {
  AspectRatio,
  JourneyConfig,
  SceneContent,
  ScenePlacement,
  SCENE_SCHEMA_VERSION,
  emptySceneContent,
} from "@/lib/schema/presentation";
import { Moment } from "@/lib/schema/narrative";
import { applyShape } from "@/lib/narrative/map";
import { DEFAULT_THEME_ID, THEMES } from "@/lib/schema/theme";
import { buildTemplateScenes, templateMovements, TEMPLATES } from "@/lib/templates/registry";
import type {
  FolderRow,
  MomentRow,
  PresentationRow,
  SceneRow,
  SectionRow,
} from "@/lib/supabase/database.types";

/** Assumed running length when a template's shape is first applied. */
const DEFAULT_TEMPLATE_SECONDS = 15 * 60;

/**
 * Write-side actions.
 *
 * Rules that hold for every action in this file:
 *   1. Input is validated with Zod before it reaches the database.
 *   2. Ownership is never accepted from the client; RLS enforces it and the
 *      `owner_id` column defaults to auth.uid().
 *   3. Actions return a result object instead of throwing, so the editor can
 *      surface a save error without unmounting the user's work.
 */

export type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

const Uuid = z.string().uuid();

async function client() {
  return supabaseServer();
}

/* -------------------------------------------------------------------------- */
/* Presentations                                                               */
/* -------------------------------------------------------------------------- */

const CreateInput = z.object({
  title: z.string().trim().max(240).default("Untitled presentation"),
  themeId: z.string().max(64).default(DEFAULT_THEME_ID),
  aspectRatio: AspectRatio.default("16:9"),
  templateId: z.string().max(64).optional(),
  folderId: Uuid.nullable().optional(),
  /** Running time the author asked for. 0 means they did not ask for one. */
  targetSeconds: z.number().int().min(0).max(86_400).default(0),
});

export async function createPresentation(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateInput.safeParse(input ?? {});
  if (!parsed.success) return fail("That presentation couldn't be created — check the details.");

  const themeId = THEMES.some((t) => t.id === parsed.data.themeId)
    ? parsed.data.themeId
    : DEFAULT_THEME_ID;

  const supabase = await client();
  const { data, error } = await supabase
    .from("presentations")
    .insert({
      title: parsed.data.title || "Untitled presentation",
      theme_id: themeId,
      aspect_ratio: parsed.data.aspectRatio,
      folder_id: parsed.data.folderId ?? null,
      target_seconds: parsed.data.targetSeconds,
      schema_version: 1,
      last_opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not create the presentation.");

  // Seed content: either a curated template or one empty title scene, so the
  // editor is never a blank void on first open.
  const template = parsed.data.templateId
    ? TEMPLATES.find((t) => t.id === parsed.data.templateId)
    : undefined;

  const seedScenes = template
    ? buildTemplateScenes(template, parsed.data.title)
    : [{ title: "Title", content: emptySceneContent("title"), speakerNotes: "", movement: "" }];

  /**
   * Movements first.
   *
   * A template carries the shape of its argument, not just its scenes, and the
   * movement rail is only worth anything if a new presentation arrives with one.
   * Sections are created before the scenes so each scene can be filed into its
   * movement in the same insert.
   */
  const movements = template ? templateMovements(seedScenes) : [];
  const sectionIdByScene = new Map<number, string>();
  const createdSections: { id: string; label: string }[] = [];

  if (movements.length > 1) {
    const { data: sectionRows } = await supabase
      .from("sections")
      .insert(
        movements.map((movement, i) => ({
          presentation_id: data.id,
          title: movement.label,
          label: movement.label,
          position: i,
        })),
      )
      .select("id, position");

    // Sections are a nicety: a deck without them is still a working deck, so a
    // failure here does not fail the creation.
    for (const row of sectionRows ?? []) {
      const movement = movements[row.position];
      if (!movement) continue;
      for (let i = movement.start; i < movement.end; i += 1) sectionIdByScene.set(i, row.id);
      createdSections.push({ id: row.id, label: movement.label });
    }
  }

  /**
   * The argument, not just the scenes.
   *
   * A template that only carries scenes leaves the author with a deck and no
   * plan. Where a template declares a recommended shape, the movements it
   * names are matched to the sections just created — by label, creating any it
   * needs — and its moments are written as a real, editable narrative map.
   *
   * Fifteen minutes is the assumed running length. It is a starting point the
   * author changes on the map, and every duration shown is labelled estimated.
   */
  if (template?.shape) {
    const shaped = applyShape(template.shape, DEFAULT_TEMPLATE_SECONDS);
    const sectionByLabel = new Map<string, string>();
    for (const row of createdSections) sectionByLabel.set(row.label.toLowerCase(), row.id);

    const extraSections = shaped
      .filter((movement) => !sectionByLabel.has(movement.label.toLowerCase()))
      .map((movement, index) => ({
        presentation_id: data.id,
        title: movement.title,
        label: movement.label,
        purpose: movement.purpose,
        position: movements.length + index,
      }));

    if (extraSections.length) {
      const { data: extra } = await supabase
        .from("sections")
        .insert(extraSections)
        .select("id, label");
      for (const row of extra ?? []) sectionByLabel.set(row.label.toLowerCase(), row.id);
    }

    // The shape's purposes belong on the movements it names.
    await Promise.all(
      shaped.map((movement) => {
        const id = sectionByLabel.get(movement.label.toLowerCase());
        if (!id) return Promise.resolve();
        return supabase
          .from("sections")
          .update({ purpose: movement.purpose, title: movement.title })
          .eq("id", id)
          .then(() => undefined);
      }),
    );

    const momentRows = shaped.flatMap((movement) =>
      movement.moments.map((moment, index) => ({
        presentation_id: data.id,
        movement_id: sectionByLabel.get(movement.label.toLowerCase()) ?? null,
        position: index,
        title: moment.title,
        role: moment.role,
        purpose: moment.purpose,
        takeaway: moment.takeaway,
        estimated_seconds: moment.estimatedSeconds,
        evidence: [] as unknown as MomentRow["evidence"],
        visual_intent: moment.visualIntent,
        instructions: "",
        locked: false,
      })),
    );

    // A map is a nicety on top of a working deck: a failure here must not fail
    // the creation, and the author can still generate one from the map view.
    if (momentRows.length) await supabase.from("moments").insert(momentRows);
  }

  const { error: sceneError } = await supabase.from("scenes").insert(
    seedScenes.map((s, i) => ({
      presentation_id: data.id,
      section_id: sectionIdByScene.get(i) ?? null,
      position: i,
      title: s.title,
      content: s.content as never,
      speaker_notes: s.speakerNotes,
      schema_version: SCENE_SCHEMA_VERSION,
    })),
  );

  if (sceneError) {
    // Roll back so the dashboard never shows a deck that cannot be opened.
    await supabase.from("presentations").delete().eq("id", data.id);
    return fail("Could not create the presentation's first scene.");
  }

  revalidatePath("/home");
  revalidatePath("/presentations");
  return ok({ id: data.id });
}

const UpdateInput = z.object({
  id: Uuid,
  title: z.string().trim().max(240).optional(),
  description: z.string().max(2000).optional(),
  themeId: z.string().max(64).optional(),
  aspectRatio: AspectRatio.optional(),
  folderId: Uuid.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  isFavorite: z.boolean().optional(),
  journey: JourneyConfig.optional(),
  targetSeconds: z.number().int().min(0).max(14_400).optional(),
});

export async function updatePresentation(input: unknown): Promise<Result<void>> {
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) return fail("Invalid update.");

  const { id, ...rest } = parsed.data;
  const patch: Partial<PresentationRow> = {};
  if (rest.title !== undefined) patch.title = rest.title || "Untitled presentation";
  if (rest.description !== undefined) patch.description = rest.description;
  if (rest.themeId !== undefined && THEMES.some((t) => t.id === rest.themeId)) {
    patch.theme_id = rest.themeId;
  }
  if (rest.aspectRatio !== undefined) patch.aspect_ratio = rest.aspectRatio;
  if (rest.folderId !== undefined) patch.folder_id = rest.folderId;
  if (rest.tags !== undefined) patch.tags = [...new Set(rest.tags)];
  if (rest.isFavorite !== undefined) patch.is_favorite = rest.isFavorite;
  if (rest.journey !== undefined)
    patch.journey = rest.journey as unknown as PresentationRow["journey"];
  if (rest.targetSeconds !== undefined) patch.target_seconds = rest.targetSeconds;

  if (Object.keys(patch).length === 0) return ok(undefined);

  const supabase = await client();
  const { error } = await supabase.from("presentations").update(patch).eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/home");
  revalidatePath("/presentations");
  revalidatePath(`/edit/${id}`);
  return ok(undefined);
}

const SharingInput = z.object({ id: Uuid, enabled: z.boolean() });

/**
 * Turns the view-only link on or off.
 *
 * The token is generated here, never accepted from the client — a chosen
 * token would let a caller point their deck at a guessable URL. Enabling an
 * already-shared deck keeps its token, so "copy link" never silently breaks
 * the copies already sent; revoking nulls it, which kills every copy at once.
 *
 * Enabling writes with a `share_token IS NULL` condition rather than
 * read-then-write: two concurrent enables would otherwise each read null,
 * each write a different token, and one caller would copy a link the other
 * write had already killed. With the condition, exactly one write claims the
 * slot and the other caller is handed the token that actually stuck.
 */
export async function setSharing(
  input: unknown,
): Promise<Result<{ shareToken: string | null }>> {
  const parsed = SharingInput.safeParse(input);
  if (!parsed.success) return fail("Invalid sharing request.");
  const supabase = await client();

  if (!parsed.data.enabled) {
    const { data: revoked, error } = await supabase
      .from("presentations")
      .update({ share_token: null })
      .eq("id", parsed.data.id)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message);
    if (!revoked) return fail("Presentation not found.");
    revalidatePath(`/edit/${parsed.data.id}`);
    return ok({ shareToken: null });
  }

  const { data: claimed, error } = await supabase
    .from("presentations")
    .update({ share_token: randomUUID() })
    .eq("id", parsed.data.id)
    .is("share_token", null)
    .is("deleted_at", null)
    .select("share_token")
    .maybeSingle();
  if (error) return fail(error.message);
  if (claimed) {
    revalidatePath(`/edit/${parsed.data.id}`);
    return ok({ shareToken: claimed.share_token });
  }

  // No row claimed: either the deck is already shared — return the token that
  // is genuinely stored — or it isn't ours to share at all.
  const { data: current, error: readError } = await supabase
    .from("presentations")
    .select("share_token")
    .eq("id", parsed.data.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) return fail(readError.message);
  if (!current) return fail("Presentation not found.");
  if (current.share_token) return ok({ shareToken: current.share_token });
  return fail("Sharing changed while enabling — try again.");
}

export async function markPresentationOpened(id: string): Promise<Result<void>> {
  if (!Uuid.safeParse(id).success) return fail("Invalid id.");
  const supabase = await client();
  await supabase
    .from("presentations")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", id);
  return ok(undefined);
}

/** Soft delete — recoverable from Recently deleted. */
export async function deletePresentation(id: string): Promise<Result<void>> {
  if (!Uuid.safeParse(id).success) return fail("Invalid id.");
  const supabase = await client();
  const { error } = await supabase
    .from("presentations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/home");
  revalidatePath("/presentations");
  return ok(undefined);
}

export async function restorePresentation(id: string): Promise<Result<void>> {
  if (!Uuid.safeParse(id).success) return fail("Invalid id.");
  const supabase = await client();
  const { error } = await supabase.from("presentations").update({ deleted_at: null }).eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/presentations");
  return ok(undefined);
}

/** Irreversible. Only reachable from Recently deleted, behind a confirmation. */
export async function purgePresentation(id: string): Promise<Result<void>> {
  if (!Uuid.safeParse(id).success) return fail("Invalid id.");
  const supabase = await client();
  const { error } = await supabase
    .from("presentations")
    .delete()
    .eq("id", id)
    .not("deleted_at", "is", null);
  if (error) return fail(error.message);

  revalidatePath("/presentations");
  return ok(undefined);
}

export async function duplicatePresentation(id: string): Promise<Result<{ id: string }>> {
  if (!Uuid.safeParse(id).success) return fail("Invalid id.");
  const supabase = await client();

  const [src, sections, scenes, moments] = await Promise.all([
    supabase.from("presentations").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("sections").select("*").eq("presentation_id", id).order("position"),
    supabase.from("scenes").select("*").eq("presentation_id", id).order("position"),
    supabase.from("moments").select("*").eq("presentation_id", id).order("position"),
  ]);

  if (src.error || !src.data) return fail("That presentation could not be found.");

  // A failed read leaves `data` null, which is indistinguishable further down
  // from a presentation that genuinely has no movements, scenes or moments — so
  // a transient error would have produced a copy quietly missing most of the
  // original, reported as a success.
  if (sections.error || scenes.error || moments.error) {
    return fail("That presentation could not be read in full, so it was not duplicated.");
  }

  const source = src.data;

  const { data: created, error } = await supabase
    .from("presentations")
    .insert({
      title: `${source.title} copy`,
      description: source.description,
      theme_id: source.theme_id,
      theme_overrides: source.theme_overrides,
      aspect_ratio: source.aspect_ratio,
      folder_id: source.folder_id,
      tags: source.tags,
      // The journey is how the copy is arranged on the canvas and how the
      // camera travels through it; the target is the running time it was
      // planned against. Both are the presentation, not decoration.
      journey: source.journey,
      target_seconds: source.target_seconds,
      schema_version: source.schema_version,
      last_opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !created) return fail(error?.message ?? "Could not duplicate.");

  // Recreate sections first so scenes can point at the *new* section ids.
  const sectionIdMap = new Map<string, string>();
  if (sections.data?.length) {
    const { data: newSections, error: secErr } = await supabase
      .from("sections")
      .insert(
        sections.data.map((s) => ({
          presentation_id: created.id,
          title: s.title,
          // A movement's label is the one-word name the room is shown, and its
          // purpose is what that stretch of the argument does. Copying a
          // presentation without them copies the filing and not the argument.
          label: s.label,
          purpose: s.purpose,
          position: s.position,
        })),
      )
      .select("id, position");

    if (secErr) {
      await supabase.from("presentations").delete().eq("id", created.id);
      return fail("Could not duplicate the presentation's sections.");
    }
    const byPosition = new Map((newSections ?? []).map((s) => [s.position, s.id]));
    for (const old of sections.data) {
      const mapped = byPosition.get(old.position);
      if (mapped) sectionIdMap.set(old.id, mapped);
    }
  }

  // The map, before the scenes, so a scene can point at the moment it came
  // from. Without this a copy of a planned presentation opened with a *derived*
  // map — the authored purposes, takeaways, evidence and locks silently
  // replaced by an inference from the scenes, which is the one thing the map
  // exists not to be.
  const momentIdMap = new Map<string, string>();
  if (moments.data?.length) {
    const rows = moments.data.map((m) => {
      // Ids are assigned here rather than read back, because moments are
      // matched to scenes by id and `position` is not unique across movements.
      const nextId = randomUUID();
      momentIdMap.set(m.id, nextId);
      return {
        id: nextId,
        presentation_id: created.id,
        movement_id: m.movement_id ? (sectionIdMap.get(m.movement_id) ?? null) : null,
        position: m.position,
        title: m.title,
        role: m.role,
        purpose: m.purpose,
        takeaway: m.takeaway,
        estimated_seconds: m.estimated_seconds,
        evidence: m.evidence,
        visual_intent: m.visual_intent,
        instructions: m.instructions,
        locked: m.locked,
      };
    });

    const { error: momentErr } = await supabase.from("moments").insert(rows);
    if (momentErr) {
      await supabase.from("presentations").delete().eq("id", created.id);
      return fail("Could not duplicate the presentation's narrative map.");
    }
  }

  if (scenes.data?.length) {
    const { error: sceneErr } = await supabase.from("scenes").insert(
      scenes.data.map((s) => ({
        presentation_id: created.id,
        section_id: s.section_id ? (sectionIdMap.get(s.section_id) ?? null) : null,
        // Where the scene sits on the world canvas. Omitted, every copied row
        // came back null and was re-placed from its ordinal, so a hand-arranged
        // world was silently flattened back into a row.
        placement: s.placement,
        moment_id: s.moment_id ? (momentIdMap.get(s.moment_id) ?? null) : null,
        position: s.position,
        title: s.title,
        content: s.content,
        speaker_notes: s.speaker_notes,
        duration_seconds: s.duration_seconds,
        schema_version: s.schema_version,
      })),
    );
    if (sceneErr) {
      await supabase.from("presentations").delete().eq("id", created.id);
      return fail("Could not duplicate the presentation's scenes.");
    }
  }

  revalidatePath("/home");
  revalidatePath("/presentations");
  return ok({ id: created.id });
}

/* -------------------------------------------------------------------------- */
/* Scenes                                                                      */
/* -------------------------------------------------------------------------- */

const SaveSceneInput = z.object({
  id: Uuid,
  presentationId: Uuid,
  title: z.string().max(240).optional(),
  content: SceneContent.optional(),
  speakerNotes: z.string().max(20000).optional(),
  durationSeconds: z.number().int().min(0).max(7200).nullable().optional(),
  sectionId: Uuid.nullable().optional(),
  placement: ScenePlacement.nullable().optional(),
  flowRole: z.enum(["main", "detail"]).optional(),
});

/**
 * Persists a single scene. The editor calls this on a debounce; the payload is
 * one row, so a drag never fans out into dozens of writes.
 */
export async function saveScene(input: unknown): Promise<Result<{ updatedAt: string }>> {
  const parsed = SaveSceneInput.safeParse(input);
  if (!parsed.success) {
    return fail(
      "This scene contains content Captivate can't store. Your last saved version is intact.",
    );
  }

  const { id, presentationId, ...rest } = parsed.data;
  const patch: Partial<SceneRow> = {};
  if (rest.title !== undefined) patch.title = rest.title;
  if (rest.content !== undefined) {
    patch.content = rest.content as unknown as SceneRow["content"];
    patch.schema_version = SCENE_SCHEMA_VERSION;
  }
  if (rest.speakerNotes !== undefined) patch.speaker_notes = rest.speakerNotes;
  if (rest.durationSeconds !== undefined) patch.duration_seconds = rest.durationSeconds;
  if (rest.sectionId !== undefined) patch.section_id = rest.sectionId;
  if (rest.flowRole !== undefined) patch.flow_role = rest.flowRole;
  if (rest.placement !== undefined) {
    patch.placement = rest.placement as unknown as SceneRow["placement"];
  }

  if (Object.keys(patch).length === 0) {
    return ok({ updatedAt: new Date().toISOString() });
  }

  const supabase = await client();
  const { data, error } = await supabase
    .from("scenes")
    .update(patch)
    .eq("id", id)
    .eq("presentation_id", presentationId)
    .select("updated_at")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("That scene no longer exists. It may have been deleted in another tab.");

  return ok({ updatedAt: data.updated_at });
}

/**
 * Rewrites the world placement of every scene in a presentation.
 *
 * Applying an arrangement is one statement, not one write per scene: a partial
 * apply would leave a deck scattered between two layouts, which is worse than
 * either. The RPC runs as the caller, so the same RLS policy that guards a
 * single-scene save guards this.
 */
const SetPlacementsInput = z.object({
  presentationId: Uuid,
  placements: z.array(z.object({ id: Uuid, placement: ScenePlacement.nullable() })).max(400),
});

export async function setScenePlacements(input: unknown): Promise<Result<{ updated: number }>> {
  const parsed = SetPlacementsInput.safeParse(input);
  if (!parsed.success) return fail("Those positions aren't valid.");

  const { presentationId, placements } = parsed.data;
  if (placements.length === 0) return ok({ updated: 0 });

  const supabase = await client();
  const { data, error } = await supabase.rpc("captivate_set_scene_placements", {
    p_presentation_id: presentationId,
    p_placements: placements as unknown as never,
  });

  if (error) return fail(error.message);
  return ok({ updated: data ?? 0 });
}

/* -------------------------------------------------------------------------- */
/* The narrative map                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Writes the whole map in one statement.
 *
 * Accepting a map, applying a template, reordering, reassigning — all of it
 * rewrites positions across movements, and a half-applied argument is worse
 * than either whole one. The RPC runs as the caller, so the same owner-scoped
 * policy that guards a single moment guards this, and it refuses to overwrite
 * a locked moment even when one is in the payload.
 */
const SaveMomentsInput = z.object({
  presentationId: Uuid,
  moments: z
    .array(Moment.omit({ presentationId: true, createdAt: true, updatedAt: true }))
    .max(400),
});

export async function saveMoments(input: unknown): Promise<Result<{ written: number }>> {
  const parsed = SaveMomentsInput.safeParse(input);
  if (!parsed.success) {
    return fail("That narrative map contains something Captivate can't store.");
  }

  const { presentationId, moments } = parsed.data;
  const supabase = await client();
  const { data, error } = await supabase.rpc("captivate_replace_moments", {
    p_presentation_id: presentationId,
    p_moments: moments as unknown as never,
  });

  if (error) return fail(error.message);
  return ok({ written: data ?? 0 });
}

/** Attaches generated scenes to the moments that produced them. */
const LinkScenesInput = z.object({
  presentationId: Uuid,
  links: z.array(z.object({ sceneId: Uuid, momentId: Uuid.nullable() })).max(400),
});

export async function linkScenesToMoments(input: unknown): Promise<Result<void>> {
  const parsed = LinkScenesInput.safeParse(input);
  if (!parsed.success) return fail("Invalid scene links.");

  const supabase = await client();
  const results = await Promise.all(
    parsed.data.links.map(({ sceneId, momentId }) =>
      supabase
        .from("scenes")
        .update({ moment_id: momentId })
        .eq("id", sceneId)
        .eq("presentation_id", parsed.data.presentationId),
    ),
  );

  const failure = results.find((result) => result.error);
  if (failure?.error) return fail(failure.error.message);
  return ok(undefined);
}

const AddSceneInput = z.object({
  presentationId: Uuid,
  /** Insert directly after this scene; appended to the end when omitted. */
  afterSceneId: Uuid.nullable().optional(),
  sectionId: Uuid.nullable().optional(),
  title: z.string().max(240).default(""),
  content: SceneContent.optional(),
  speakerNotes: z.string().max(20000).default(""),
});

export async function addScene(input: unknown): Promise<Result<{ id: string; position: number }>> {
  const parsed = AddSceneInput.safeParse(input);
  if (!parsed.success) return fail("Could not add that scene.");

  const supabase = await client();
  const { data: existing, error: readErr } = await supabase
    .from("scenes")
    .select("id, position, section_id")
    .eq("presentation_id", parsed.data.presentationId)
    .order("position");

  if (readErr) return fail(readErr.message);

  const scenes = existing ?? [];
  const anchorIndex = parsed.data.afterSceneId
    ? scenes.findIndex((s) => s.id === parsed.data.afterSceneId)
    : scenes.length - 1;
  const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : scenes.length;

  // Inherit the anchor's section so inserting inside a section keeps it there.
  const inheritedSection =
    parsed.data.sectionId !== undefined
      ? parsed.data.sectionId
      : (scenes[anchorIndex]?.section_id ?? null);

  const { data: created, error } = await supabase
    .from("scenes")
    .insert({
      presentation_id: parsed.data.presentationId,
      section_id: inheritedSection,
      position: insertAt,
      title: parsed.data.title,
      content: (parsed.data.content ?? emptySceneContent()) as never,
      speaker_notes: parsed.data.speakerNotes,
      schema_version: SCENE_SCHEMA_VERSION,
    })
    .select("id")
    .single();

  if (error || !created) return fail(error?.message ?? "Could not add that scene.");

  // Shift everything at or after the insertion point down by one.
  const shifted = scenes.slice(insertAt).map((s, i) => ({ id: s.id, position: insertAt + i + 1 }));
  if (shifted.length) {
    await Promise.all(
      shifted.map((s) => supabase.from("scenes").update({ position: s.position }).eq("id", s.id)),
    );
  }

  return ok({ id: created.id, position: insertAt });
}

export async function deleteScene(input: unknown): Promise<Result<void>> {
  const parsed = z.object({ id: Uuid, presentationId: Uuid }).safeParse(input);
  if (!parsed.success) return fail("Invalid scene.");

  const supabase = await client();

  // Never leave a deck with zero scenes — there would be nothing to present.
  const { count } = await supabase
    .from("scenes")
    .select("id", { count: "exact", head: true })
    .eq("presentation_id", parsed.data.presentationId);

  if ((count ?? 0) <= 1) {
    return fail("A presentation needs at least one scene.");
  }

  const { error } = await supabase
    .from("scenes")
    .delete()
    .eq("id", parsed.data.id)
    .eq("presentation_id", parsed.data.presentationId);
  if (error) return fail(error.message);

  await compactScenePositions(parsed.data.presentationId);
  return ok(undefined);
}

export async function duplicateScene(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = z.object({ id: Uuid, presentationId: Uuid }).safeParse(input);
  if (!parsed.success) return fail("Invalid scene.");

  const supabase = await client();
  const { data: source, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("id", parsed.data.id)
    .eq("presentation_id", parsed.data.presentationId)
    .maybeSingle();

  if (error || !source) return fail("That scene could not be found.");

  const created = await addScene({
    presentationId: parsed.data.presentationId,
    afterSceneId: parsed.data.id,
    sectionId: source.section_id,
    title: source.title,
    content: source.content,
    speakerNotes: source.speaker_notes,
  });

  if (!created.ok) return created;
  return ok({ id: created.data.id });
}

const ReorderInput = z.object({
  presentationId: Uuid,
  /** Complete ordered list of scene ids after the move. */
  sceneIds: z.array(Uuid).max(500),
  /** Optional section reassignment applied at the same time. */
  sectionAssignments: z.record(Uuid, Uuid.nullable()).optional(),
});

export async function reorderScenes(input: unknown): Promise<Result<void>> {
  const parsed = ReorderInput.safeParse(input);
  if (!parsed.success) return fail("Invalid reorder request.");

  const supabase = await client();

  // Verify the payload covers exactly the deck's scenes; a partial list would
  // silently corrupt ordering.
  const { data: existing, error: readErr } = await supabase
    .from("scenes")
    .select("id")
    .eq("presentation_id", parsed.data.presentationId);
  if (readErr) return fail(readErr.message);

  const known = new Set((existing ?? []).map((s) => s.id));
  if (
    known.size !== parsed.data.sceneIds.length ||
    parsed.data.sceneIds.some((id) => !known.has(id))
  ) {
    return fail("The scene order is out of date. Reload the presentation and try again.");
  }

  const assignments = parsed.data.sectionAssignments ?? {};
  const results = await Promise.all(
    parsed.data.sceneIds.map((id, index) => {
      const patch: Partial<SceneRow> = { position: index };
      if (id in assignments) patch.section_id = assignments[id];
      return supabase
        .from("scenes")
        .update(patch)
        .eq("id", id)
        .eq("presentation_id", parsed.data.presentationId);
    }),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) return fail(failed.error.message);

  return ok(undefined);
}

async function compactScenePositions(presentationId: string) {
  const supabase = await client();
  const { data } = await supabase
    .from("scenes")
    .select("id, position")
    .eq("presentation_id", presentationId)
    .order("position");

  await Promise.all(
    (data ?? []).map((s, i) =>
      s.position === i
        ? Promise.resolve()
        : supabase.from("scenes").update({ position: i }).eq("id", s.id),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

export async function addSection(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = z
    .object({ presentationId: Uuid, title: z.string().trim().max(240).default("New section") })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid section.");

  const supabase = await client();
  const { count } = await supabase
    .from("sections")
    .select("id", { count: "exact", head: true })
    .eq("presentation_id", parsed.data.presentationId);

  const { data, error } = await supabase
    .from("sections")
    .insert({
      presentation_id: parsed.data.presentationId,
      title: parsed.data.title || "New section",
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not add that section.");
  return ok({ id: data.id });
}

const UpdateSectionInput = z.object({
  id: Uuid,
  title: z.string().trim().min(1).max(240).optional(),
  /** The short movement name shown to the audience. May be cleared. */
  label: z.string().trim().max(24).optional(),
  /** What this stretch of the argument accomplishes. */
  purpose: z.string().trim().max(600).optional(),
});

export async function updateSection(input: unknown): Promise<Result<void>> {
  const parsed = UpdateSectionInput.safeParse(input);
  if (!parsed.success) return fail("Section names can't be empty.");

  const { id, ...rest } = parsed.data;
  const patch: Partial<SectionRow> = {};
  if (rest.title !== undefined) patch.title = rest.title;
  if (rest.label !== undefined) patch.label = rest.label;
  if (rest.purpose !== undefined) patch.purpose = rest.purpose;
  if (Object.keys(patch).length === 0) return ok(undefined);

  const supabase = await client();
  const { error } = await supabase.from("sections").update(patch).eq("id", id);
  if (error) return fail(error.message);
  return ok(undefined);
}

/** Deletes a section but keeps its scenes — they become unsectioned. */
export async function deleteSection(input: unknown): Promise<Result<void>> {
  const parsed = z.object({ id: Uuid }).safeParse(input);
  if (!parsed.success) return fail("Invalid section.");

  const supabase = await client();
  const { error } = await supabase.from("sections").delete().eq("id", parsed.data.id);
  if (error) return fail(error.message);
  return ok(undefined);
}

export async function reorderSections(input: unknown): Promise<Result<void>> {
  const parsed = z
    .object({ presentationId: Uuid, sectionIds: z.array(Uuid).max(200) })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid reorder request.");

  const supabase = await client();
  const results = await Promise.all(
    parsed.data.sectionIds.map((id, index) =>
      supabase
        .from("sections")
        .update({ position: index })
        .eq("id", id)
        .eq("presentation_id", parsed.data.presentationId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return fail(failed.error.message);
  return ok(undefined);
}

/* -------------------------------------------------------------------------- */
/* Folders                                                                     */
/* -------------------------------------------------------------------------- */

const FolderColor = z.enum(["neutral", "gold", "orchid", "teal", "rose", "blue", "green"]);

export async function createFolder(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Give the folder a name").max(120),
      color: FolderColor.default("neutral"),
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const supabase = await client();
  const { count } = await supabase.from("folders").select("id", { count: "exact", head: true });
  const { data, error } = await supabase
    .from("folders")
    .insert({ name: parsed.data.name, color: parsed.data.color, position: count ?? 0 })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not create the folder.");
  revalidatePath("/presentations");
  return ok({ id: data.id });
}

export async function renameFolder(input: unknown): Promise<Result<void>> {
  const parsed = z
    .object({ id: Uuid, name: z.string().trim().min(1).max(120), color: FolderColor.optional() })
    .safeParse(input);
  if (!parsed.success) return fail("Folder names can't be empty.");

  const supabase = await client();
  const patch: Partial<FolderRow> = { name: parsed.data.name };
  if (parsed.data.color) patch.color = parsed.data.color;
  const { error } = await supabase.from("folders").update(patch).eq("id", parsed.data.id);
  if (error) return fail(error.message);
  revalidatePath("/presentations");
  return ok(undefined);
}

/** Deleting a folder never deletes its presentations; they move to All. */
export async function deleteFolder(id: string): Promise<Result<void>> {
  if (!Uuid.safeParse(id).success) return fail("Invalid folder.");
  const supabase = await client();
  const { error } = await supabase.from("folders").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/presentations");
  return ok(undefined);
}
