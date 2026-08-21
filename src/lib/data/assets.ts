"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "./upload-limits";

/**
 * Asset registration and deletion.
 *
 * Uploads go straight from the browser to Supabase Storage using the user's
 * own session — storage RLS requires the object path to start with their user
 * id, so a client cannot write into anyone else's prefix. This action then
 * records the metadata row, re-checking that the path really is theirs.
 */

export type AssetResult<T> = { ok: true; data: T } | { ok: false; error: string };

const KIND_BY_PREFIX: Record<string, "image" | "video" | "audio"> = {
  image: "image",
  video: "video",
  audio: "audio",
};

const RegisterInput = z.object({
  storagePath: z.string().min(1).max(400),
  mimeType: z.string().min(1).max(160),
  byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  originalFilename: z.string().max(260).default(""),
  presentationId: z.string().uuid().nullable().optional(),
  width: z.number().int().positive().max(20000).nullable().optional(),
  height: z.number().int().positive().max(20000).nullable().optional(),
  durationSeconds: z
    .number()
    .nonnegative()
    .max(60 * 60 * 12)
    .nullable()
    .optional(),
  altText: z.string().max(600).default(""),
});

export async function registerAsset(
  input: unknown,
): Promise<AssetResult<{ id: string; url: string }>> {
  const parsed = RegisterInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That file couldn't be registered." };

  if (!ALLOWED_MIME.has(parsed.data.mimeType)) {
    return { ok: false, error: "That file type isn't supported." };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  // The path is client-supplied, so verify it belongs to this user rather than
  // trusting it. Storage RLS also enforces this, but a mismatched metadata row
  // would still be a mess worth preventing.
  if (!parsed.data.storagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid upload path." };
  }

  const kind = KIND_BY_PREFIX[parsed.data.mimeType.split("/")[0]] ?? "file";

  const { data, error } = await supabase
    .from("assets")
    .insert({
      storage_path: parsed.data.storagePath,
      mime_type: parsed.data.mimeType,
      byte_size: parsed.data.byteSize,
      kind,
      original_filename: parsed.data.originalFilename,
      presentation_id: parsed.data.presentationId ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      duration_seconds: parsed.data.durationSeconds ?? null,
      alt_text: parsed.data.altText,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Orphaned object; remove it so storage does not accumulate junk.
    await supabase.storage.from(STORAGE_BUCKETS.assets).remove([parsed.data.storagePath]);
    return { ok: false, error: error?.message ?? "Could not save the file." };
  }

  revalidatePath("/assets");
  return { ok: true, data: { id: data.id, url: assetUrl(data.id) } };
}

export async function updateAssetAlt(id: string, altText: string): Promise<AssetResult<void>> {
  const parsed = z
    .object({ id: z.string().uuid(), altText: z.string().max(600) })
    .safeParse({ id, altText });
  if (!parsed.success) return { ok: false, error: "Invalid alt text." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("assets")
    .update({ alt_text: parsed.data.altText })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/assets");
  return { ok: true, data: undefined };
}

export async function deleteAsset(id: string): Promise<AssetResult<void>> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid asset." };

  const supabase = await supabaseServer();
  const { data: asset } = await supabase
    .from("assets")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!asset) return { ok: false, error: "That file no longer exists." };

  const { error } = await supabase.from("assets").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase.storage.from(STORAGE_BUCKETS.assets).remove([asset.storage_path]);
  revalidatePath("/assets");
  return { ok: true, data: undefined };
}

/**
 * Stable, permanent reference to an asset.
 *
 * Scene content stores this rather than a signed URL, because signed URLs
 * expire and a deck must still render a year later. The route behind it checks
 * ownership and redirects to a freshly signed URL on every request.
 */
function assetUrl(id: string): string {
  return `/api/assets/${id}/content`;
}
