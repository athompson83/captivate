import "server-only";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import { IMAGE_PROVIDER, storeSourcedImage, type GeneratedImage } from "@/lib/ai/visual-sourcing";
import { sniffImage } from "@/lib/ai/image-signature";
import type { AssetResult } from "./assets";

/**
 * The server's own way of keeping a sourced image: bytes it already holds go
 * into the caller's storage prefix, and a row records where they came from.
 *
 * A plain `server-only` module rather than an action, deliberately. The
 * generated-image case used to be an action that took the preview data URL as
 * its input, and that made it reachable from the browser with a body a server
 * action stops reading at one megabyte — which is how the first production
 * save was lost. The browser now uploads the bytes itself and registers them
 * (`upload-generated.ts`, `registerGeneratedImage`); the fill pass, which runs
 * inside a route and has the bytes in hand, keeps them through here.
 */

export interface StoreGeneratedInput {
  altText: string;
  presentationId: string | null;
}

/** Stores a generated image the server itself produced, with what made it. */
export async function storeGeneratedImage(
  generated: GeneratedImage,
  { altText, presentationId }: StoreGeneratedInput,
): Promise<AssetResult<{ id: string; url: string }>> {
  const comma = generated.previewDataUrl.indexOf(",");
  const header = generated.previewDataUrl.slice(5, comma);
  if (comma < 0 || !header.endsWith(";base64")) {
    return { ok: false, error: "That image couldn't be read." };
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(generated.previewDataUrl.slice(comma + 1), "base64"));
  } catch {
    return { ok: false, error: "That image couldn't be read." };
  }
  // Read out of the bytes rather than trusted from the header, because which
  // model made a picture is a deployment setting and not all of them answer
  // in PNG.
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { ok: false, error: "That file isn't an image, whatever it claims to be." };

  const stored = await storeSourcedImage({ bytes, ...sniffed });
  if (!stored.ok) return { ok: false, error: "Couldn't save the image. Nothing was changed." };

  return insertSourced(stored.data.storagePath, sniffed.mimeType, bytes.length, {
    presentation_id: presentationId,
    alt_text: altText.slice(0, 600),
    original_filename: generated.prompt.slice(0, 200),
    source: "generated",
    provider: IMAGE_PROVIDER,
    model: generated.model,
    prompt: generated.prompt,
    quality: generated.quality,
    generation_ms: generated.generationMs,
  });
}

/** The row for an object already in storage; removes the object if it fails. */
export async function insertSourced(
  storagePath: string,
  mimeType: string,
  byteSize: number,
  provenance: Record<string, unknown>,
): Promise<AssetResult<{ id: string; url: string }>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("assets")
    .insert({
      storage_path: storagePath,
      mime_type: mimeType,
      byte_size: byteSize,
      kind: "image",
      ...provenance,
    } as never)
    .select("id")
    .single();

  if (error || !data) {
    // Orphaned object; remove it so storage does not accumulate junk.
    await supabase.storage.from(STORAGE_BUCKETS.assets).remove([storagePath]);
    return { ok: false, error: error?.message ?? "Could not save the image." };
  }

  revalidatePath("/assets");
  return { ok: true, data: { id: data.id, url: `/api/assets/${data.id}/content` } };
}
