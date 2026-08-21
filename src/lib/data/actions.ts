"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import {
  AspectRatio,
  SceneContent,
  SCENE_SCHEMA_VERSION,
  emptySceneContent,
} from "@/lib/schema/presentation";
import { DEFAULT_THEME_ID, THEMES } from "@/lib/schema/theme";
import { buildTemplateScenes, TEMPLATES } from "@/lib/templates/registry";
import type { FolderRow, PresentationRow, SceneRow } from "@/lib/supabase/database.types";

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

const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
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
    : [{ title: "Title", content: emptySceneContent("title"), speakerNotes: "" }];

  const { error: sceneError } = await supabase.from("scenes").insert(
    seedScenes.map((s, i) => ({
      presentation_id: data.id,
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

  if (Object.keys(patch).length === 0) return ok(undefined);

  const supabase = await client();
  const { error } = await supabase.from("presentations").update(patch).eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/home");
  revalidatePath("/presentations");
  revalidatePath(`/edit/${id}`);
  return ok(undefined);
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
  const { error } = await supabase
    .from("presentations")
    .update({ deleted_at: null })
    .eq("id", id);
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

  const [src, sections, scenes] = await Promise.all([
    supabase.from("presentations").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("sections").select("*").eq("presentation_id", id).order("position"),
    supabase.from("scenes").select("*").eq("presentation_id", id).order("position"),
  ]);

  if (src.error || !src.data) return fail("That presentation could not be found.");
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

  if (scenes.data?.length) {
    const { error: sceneErr } = await supabase.from("scenes").insert(
      scenes.data.map((s) => ({
        presentation_id: created.id,
        section_id: s.section_id ? (sectionIdMap.get(s.section_id) ?? null) : null,
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
});

/**
 * Persists a single scene. The editor calls this on a debounce; the payload is
 * one row, so a drag never fans out into dozens of writes.
 */
export async function saveScene(input: unknown): Promise<Result<{ updatedAt: string }>> {
  const parsed = SaveSceneInput.safeParse(input);
  if (!parsed.success) {
    return fail("This scene contains content Captivate can't store. Your last saved version is intact.");
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
      shifted.map((s) =>
        supabase.from("scenes").update({ position: s.position }).eq("id", s.id),
      ),
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
  if (known.size !== parsed.data.sceneIds.length || parsed.data.sceneIds.some((id) => !known.has(id))) {
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

export async function renameSection(input: unknown): Promise<Result<void>> {
  const parsed = z
    .object({ id: Uuid, title: z.string().trim().min(1).max(240) })
    .safeParse(input);
  if (!parsed.success) return fail("Section names can't be empty.");

  const supabase = await client();
  const { error } = await supabase
    .from("sections")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.id);
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
