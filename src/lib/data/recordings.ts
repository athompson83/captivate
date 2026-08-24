"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { STORAGE_BUCKETS, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/config";
import { parseCues } from "@/lib/record/transcript-core";

/**
 * Recording metadata.
 *
 * The file itself is uploaded from the browser straight into private storage;
 * these actions only manage the row that points at it. A recording row exists
 * from the moment capture stops, even if the upload then fails — the user can
 * see that something happened and retry, rather than losing the evidence.
 */

export type RecordingResult<T> = { ok: true; data: T } | { ok: false; error: string };

const Uuid = z.string().uuid();

export interface RecordingSummary {
  id: string;
  presentationId: string | null;
  presentationTitle: string | null;
  title: string;
  mimeType: string;
  byteSize: number;
  durationSeconds: number;
  status: "recording" | "uploading" | "ready" | "failed" | "local_only";
  hasCamera: boolean;
  hasMicrophone: boolean;
  timeline: { sceneId: string | null; sceneIndex: number; atMs: number }[];
  transcript: { startMs: number; endMs: number; text: string }[];
  errorMessage: string | null;
  createdAt: string;
}

const CreateInput = z.object({
  presentationId: Uuid.nullable().optional(),
  title: z.string().trim().max(240).default("Untitled recording"),
  mimeType: z.string().max(160).default("video/webm"),
  durationSeconds: z
    .number()
    .min(0)
    .max(60 * 60 * 12)
    .default(0),
  hasCamera: z.boolean().default(false),
  hasMicrophone: z.boolean().default(true),
  timeline: z
    .array(
      z.object({
        sceneId: Uuid.nullable(),
        sceneIndex: z.number().int().min(0).max(999),
        atMs: z.number().min(0),
      }),
    )
    .max(1000)
    .default([]),
  transcript: z
    .array(
      z
        .object({
          startMs: z.number().min(0),
          endMs: z.number().min(0),
          text: z.string().max(600),
        })
        // WebVTT requires an end strictly after the start, and the recorder
        // never produces anything else; a reversed cue here is a tampered
        // client, not a formatting choice.
        .refine((cue) => cue.endMs > cue.startMs, { message: "Cue must have positive duration" }),
    )
    .max(5000)
    .default([]),
  status: z.enum(["uploading", "local_only", "failed"]).default("uploading"),
});

export async function createRecording(input: unknown): Promise<RecordingResult<{ id: string }>> {
  const parsed = CreateInput.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "That recording couldn't be saved." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("recordings")
    .insert({
      presentation_id: parsed.data.presentationId ?? null,
      title: parsed.data.title || "Untitled recording",
      mime_type: parsed.data.mimeType,
      duration_seconds: parsed.data.durationSeconds,
      has_camera: parsed.data.hasCamera,
      has_microphone: parsed.data.hasMicrophone,
      scene_timeline: parsed.data.timeline as never,
      transcript: parsed.data.transcript as never,
      status: parsed.data.status,
    })
    .select("id")
    .single();

  if (error || !data)
    return { ok: false, error: error?.message ?? "Could not save the recording." };

  revalidatePath("/recordings");
  return { ok: true, data: { id: data.id } };
}

const FinaliseInput = z.object({
  id: Uuid,
  storagePath: z.string().max(400).nullable(),
  byteSize: z.number().int().min(0).default(0),
  status: z.enum(["ready", "failed", "local_only"]),
  errorMessage: z.string().max(500).nullable().optional(),
});

export async function finaliseRecording(input: unknown): Promise<RecordingResult<void>> {
  const parsed = FinaliseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid recording update." };

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  // As with assets, verify the client-supplied path really is this user's.
  if (parsed.data.storagePath && !parsed.data.storagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid upload path." };
  }

  const { error } = await supabase
    .from("recordings")
    .update({
      storage_path: parsed.data.storagePath,
      byte_size: parsed.data.byteSize,
      status: parsed.data.status,
      error_message: parsed.data.errorMessage ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/recordings");
  return { ok: true, data: undefined };
}

export async function renameRecording(id: string, title: string): Promise<RecordingResult<void>> {
  const parsed = z
    .object({ id: Uuid, title: z.string().trim().min(1).max(240) })
    .safeParse({ id, title });
  if (!parsed.success) return { ok: false, error: "Recording names can't be empty." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("recordings")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/recordings");
  return { ok: true, data: undefined };
}

export async function deleteRecording(id: string): Promise<RecordingResult<void>> {
  if (!Uuid.safeParse(id).success) return { ok: false, error: "Invalid recording." };

  const supabase = await supabaseServer();
  const { data: recording } = await supabase
    .from("recordings")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("recordings").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  if (recording?.storage_path) {
    await supabase.storage.from(STORAGE_BUCKETS.recordings).remove([recording.storage_path]);
  }

  revalidatePath("/recordings");
  return { ok: true, data: undefined };
}

export async function listRecordings(presentationId?: string): Promise<RecordingSummary[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("recordings")
    .select("*, presentations(title)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (presentationId) query = query.eq("presentation_id", presentationId);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      presentation_id: string | null;
      title: string;
      mime_type: string;
      byte_size: number;
      duration_seconds: number;
      status: RecordingSummary["status"];
      has_camera: boolean;
      has_microphone: boolean;
      scene_timeline: RecordingSummary["timeline"];
      transcript: RecordingSummary["transcript"];
      error_message: string | null;
      created_at: string;
      presentations: { title: string } | null;
    };
    return {
      id: row.id,
      presentationId: row.presentation_id,
      presentationTitle: row.presentations?.title ?? null,
      title: row.title,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      durationSeconds: Number(row.duration_seconds),
      status: row.status,
      hasCamera: row.has_camera,
      hasMicrophone: row.has_microphone,
      timeline: Array.isArray(row.scene_timeline) ? row.scene_timeline : [],
      transcript: parseCues(row.transcript),
      errorMessage: row.error_message,
      createdAt: row.created_at,
    };
  });
}

/** Short-lived playback URL, minted only for the owner. */
export async function getRecordingUrl(id: string): Promise<RecordingResult<{ url: string }>> {
  if (!Uuid.safeParse(id).success) return { ok: false, error: "Invalid recording." };

  const supabase = await supabaseServer();
  const { data: recording } = await supabase
    .from("recordings")
    .select("storage_path, status")
    .eq("id", id)
    .maybeSingle();

  if (!recording?.storage_path) {
    return {
      ok: false,
      error:
        recording?.status === "local_only"
          ? "This recording was only saved to your device — it was never uploaded."
          : "That recording has no file to play.",
    };
  }

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKETS.recordings)
    .createSignedUrl(recording.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) return { ok: false, error: "Couldn't open that recording." };
  return { ok: true, data: { url: data.signedUrl } };
}
