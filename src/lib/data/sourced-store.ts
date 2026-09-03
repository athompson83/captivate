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

/**
 * The row for an object already in storage.
 *
 * On failure it removes the object — but only after establishing that no row
 * owns it. The two are not the same question: an insert can fail because the
 * path is already recorded (a concurrent registration won the race, or a
 * retried one arrived twice), and removing then deletes the picture the
 * winning row points at, which is a broken image in somebody's library rather
 * than the tidy-up it looks like. So a path that turns out to be owned is
 * returned as the success it effectively is, and the object is left alone.
 */
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

  if (data) {
    revalidatePath("/assets");
    return { ok: true, data: { id: data.id, url: assetContentUrl(data.id) } };
  }

  // Owned by a row already — this insert lost a race with one that wrote the
  // same path, or is the same registration arriving twice. Either way the
  // picture is kept and its own row is what the caller wanted.
  const owner = await ownerRowFor(storagePath);
  if (owner) {
    revalidatePath("/assets");
    return { ok: true, data: { id: owner, url: assetContentUrl(owner) } };
  }

  // Nothing owns it, so it is this operation's orphan to clear.
  await supabase.storage.from(STORAGE_BUCKETS.assets).remove([storagePath]);
  return { ok: false, error: error?.message ?? "Could not save the image." };
}

/** The id of the row that owns this path, as the caller can see it. */
export async function ownerRowFor(storagePath: string): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("assets")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();
  return data?.id ?? null;
}

const assetContentUrl = (id: string) => `/api/assets/${id}/content`;
