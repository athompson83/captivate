"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import type { LectureNoteRow } from "@/lib/supabase/database.types";

/**
 * Lecture notes.
 *
 * Deliberately separate from `scenes.speaker_notes`. Speaker notes are the
 * short prompts a presenter glances at mid-sentence; lecture notes are the
 * long-form research, references and teaching material behind a deck. They can
 * outlive any single scene, which is why they are their own table and can be
 * attached to a presentation, a section, a scene, or nothing at all.
 */

export type NoteResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface LectureNote {
  id: string;
  presentationId: string | null;
  sectionId: string | null;
  sceneId: string | null;
  title: string;
  body: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

const Uuid = z.string().uuid();

export async function listNotes(presentationId?: string | null): Promise<LectureNote[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("lecture_notes")
    .select("*")
    .order("position")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (presentationId) query = query.eq("presentation_id", presentationId);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? []).map((n) => ({
    id: n.id,
    presentationId: n.presentation_id,
    sectionId: n.section_id,
    sceneId: n.scene_id,
    title: n.title,
    body: n.body,
    position: n.position,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }));
}

const CreateNote = z.object({
  presentationId: Uuid.nullable().optional(),
  sectionId: Uuid.nullable().optional(),
  sceneId: Uuid.nullable().optional(),
  title: z.string().trim().max(240).default("Untitled note"),
  body: z.string().max(500000).default(""),
});

export async function createNote(input: unknown): Promise<NoteResult<LectureNote>> {
  const parsed = CreateNote.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Could not create that note." };

  const supabase = await supabaseServer();
  const countQuery = supabase.from("lecture_notes").select("id", { count: "exact", head: true });
  const { count } = await (parsed.data.presentationId
    ? countQuery.eq("presentation_id", parsed.data.presentationId)
    : countQuery.is("presentation_id", null));

  const { data, error } = await supabase
    .from("lecture_notes")
    .insert({
      presentation_id: parsed.data.presentationId ?? null,
      section_id: parsed.data.sectionId ?? null,
      scene_id: parsed.data.sceneId ?? null,
      title: parsed.data.title || "Untitled note",
      body: parsed.data.body,
      position: count ?? 0,
    })
    .select("*")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create that note." };

  revalidatePath("/notes");
  return {
    ok: true,
    data: {
      id: data.id,
      presentationId: data.presentation_id,
      sectionId: data.section_id,
      sceneId: data.scene_id,
      title: data.title,
      body: data.body,
      position: data.position,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  };
}

const UpdateNote = z.object({
  id: Uuid,
  title: z.string().trim().max(240).optional(),
  body: z.string().max(500000).optional(),
  sceneId: Uuid.nullable().optional(),
  sectionId: Uuid.nullable().optional(),
});

export async function updateNote(input: unknown): Promise<NoteResult<{ updatedAt: string }>> {
  const parsed = UpdateNote.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That note couldn't be saved." };

  const { id, ...rest } = parsed.data;
  const patch: Partial<LectureNoteRow> = {};
  if (rest.title !== undefined) patch.title = rest.title || "Untitled note";
  if (rest.body !== undefined) patch.body = rest.body;
  if (rest.sceneId !== undefined) patch.scene_id = rest.sceneId;
  if (rest.sectionId !== undefined) patch.section_id = rest.sectionId;
  if (!Object.keys(patch).length)
    return { ok: true, data: { updatedAt: new Date().toISOString() } };

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("lecture_notes")
    .update(patch)
    .eq("id", id)
    .select("updated_at")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That note no longer exists." };

  revalidatePath("/notes");
  return { ok: true, data: { updatedAt: data.updated_at } };
}

export async function deleteNote(id: string): Promise<NoteResult<void>> {
  if (!Uuid.safeParse(id).success) return { ok: false, error: "Invalid note." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("lecture_notes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/notes");
  return { ok: true, data: undefined };
}

/** Full-text-ish search across the caller's notes. */
export async function searchNotes(query: string): Promise<LectureNote[]> {
  const safe = query
    .trim()
    .replace(/[,()\\*]/g, " ")
    .slice(0, 120);
  if (safe.length < 2) return [];

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("lecture_notes")
    .select("*")
    .or(`title.ilike.%${safe}%,body.ilike.%${safe}%`)
    .order("updated_at", { ascending: false })
    .limit(40);

  return (data ?? []).map((n) => ({
    id: n.id,
    presentationId: n.presentation_id,
    sectionId: n.section_id,
    sceneId: n.scene_id,
    title: n.title,
    body: n.body,
    position: n.position,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }));
}
