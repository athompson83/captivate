"use server";

import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchImageBytes, storeSourcedImage, IMAGE_PROVIDER } from "@/lib/ai/visual-sourcing";
import { insertSourced } from "./sourced-store";
import { sniffImage } from "@/lib/ai/image-signature";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import { MAX_UPLOAD_BYTES } from "./upload-limits";
import type { AssetResult } from "./assets";

/**
 * Committing a searched or generated image.
 *
 * The result of a search is a URL on someone else's CDN and the result of a
 * generation is a preview in memory; neither is an asset until the author says
 * so. When they do, the *server* fetches and re-hosts the bytes, because every
 * other image in Captivate is served from its own private storage through a
 * signed URL, and a permanent hotlink into a provider's CDN would be the one
 * picture in a deck that stops working a year from now.
 *
 * The fetch is a real boundary rather than a convenience: host allowlist, byte
 * ceiling enforced while reading, and the format taken from the bytes rather
 * than from the provider's headers. See `visual-sourcing.ts`.
 */

const StockInput = z.object({
  fullUrl: z.url(),
  providerAssetId: z.string().max(120),
  originalPageUrl: z.url(),
  creatorName: z.string().max(200),
  creatorPageUrl: z.url(),
  licenseRef: z.string().max(120),
  altText: z.string().max(600).default(""),
  presentationId: z.string().uuid().nullable().optional(),
});

const GeneratedInput = z.object({
  /** Where the browser put the bytes: the caller's own prefix, checked below. */
  storagePath: z.string().min(1).max(400),
  prompt: z.string().max(1000),
  model: z.string().max(120),
  quality: z.string().max(40),
  generationMs: z.number().int().min(0).max(600_000),
  altText: z.string().max(600).default(""),
  presentationId: z.string().uuid().nullable().optional(),
});

const INGEST_MESSAGES: Record<string, string> = {
  "host-not-allowed": "That image isn't from a source this deployment fetches from.",
  unreachable: "Couldn't fetch that image. Nothing was saved.",
  "too-large": "That image is larger than the upload limit.",
  "not-an-image": "That file isn't an image, whatever it claims to be.",
  storage: "Couldn't save the image. Nothing was changed.",
};

const say = (code: string) => INGEST_MESSAGES[code] ?? "Couldn't save that image.";

/** Re-hosts a chosen stock photo and records who took it and under what terms. */
export async function saveStockPhoto(
  input: unknown,
): Promise<AssetResult<{ id: string; url: string }>> {
  const parsed = StockInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That image couldn't be saved." };

  const fetched = await fetchImageBytes(parsed.data.fullUrl);
  if (!fetched.ok) return { ok: false, error: say(fetched.error) };

  const stored = await storeSourcedImage(fetched.data);
  if (!stored.ok) return { ok: false, error: say(stored.error) };

  return insertSourced(stored.data.storagePath, fetched.data.mimeType, fetched.data.bytes.length, {
    presentation_id: parsed.data.presentationId ?? null,
    alt_text: parsed.data.altText,
    original_filename: `${parsed.data.creatorName} on Pexels`,
    source: "stock",
    provider: "pexels",
    provider_asset_id: parsed.data.providerAssetId,
    original_page_url: parsed.data.originalPageUrl,
    creator_name: parsed.data.creatorName,
    creator_page_url: parsed.data.creatorPageUrl,
    license_ref: parsed.data.licenseRef,
    // When these terms were last confirmed against the provider, so a future
    // licence change has something to check existing rows against.
    verified_at: new Date().toISOString(),
  });
}

/**
 * Records an accepted generated image the browser has already put in storage.
 *
 * The bytes do not come through here. They did once — the preview data URL was
 * the action's input — and a 1536x1024 picture is several megabytes of base64,
 * which a server action stops reading at one. On production the first real
 * generation previewed perfectly and then never saved: the action threw before
 * running, the button spun, and nothing said why. So the accept path now goes
 * the way every upload already does — straight from the browser into the
 * caller's own storage prefix — and this action writes the row that says what
 * the picture is and what made it.
 *
 * What the row says about the object is read from the object, not from the
 * caller. The path has to be under the caller's own id; then the stored bytes
 * are fetched back and sniffed, and their length is what is recorded. A
 * caller can put anything under their own prefix — the bucket allows it — but
 * cannot have this action call it a PNG, or a picture at all, or a size it is
 * not. An object that is not an image this deployment keeps is removed rather
 * than left as an orphan.
 */
export async function registerGeneratedImage(
  input: unknown,
): Promise<AssetResult<{ id: string; url: string }>> {
  const parsed = GeneratedInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That image couldn't be saved." };

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  // Client-supplied, so proved rather than trusted. Storage RLS refuses a
  // write outside the caller's prefix too; a row pointing into somebody else's
  // is still a mess worth preventing.
  const { storagePath } = parsed.data;
  if (!storagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid upload path." };
  }

  // A path already recorded belongs to the row that recorded it. Registering
  // it again would fail on the unique key and then remove the object out from
  // under that row — so it is refused before anything is read or removed.
  const { data: existing } = await supabase
    .from("assets")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (existing) return { ok: false, error: "That image is already in your library." };

  const bucket = supabase.storage.from(STORAGE_BUCKETS.assets);
  const { data: object, error: readError } = await bucket.download(storagePath);
  if (readError || !object) {
    return { ok: false, error: "Couldn't read the uploaded image. Nothing was saved." };
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed || bytes.byteLength > MAX_UPLOAD_BYTES) {
    await bucket.remove([storagePath]);
    return {
      ok: false,
      error: sniffed
        ? "That image is larger than the upload limit."
        : "That file isn't an image, whatever it claims to be.",
    };
  }

  return insertSourced(storagePath, sniffed.mimeType, bytes.byteLength, {
    presentation_id: parsed.data.presentationId ?? null,
    alt_text: parsed.data.altText,
    original_filename: parsed.data.prompt.slice(0, 200),
    source: "generated",
    // The gateway that actually made it, not a constant. A deployment can
    // generate through OpenRouter, and a provenance column that says otherwise
    // is worse than an empty one — it is the row somebody would reconcile a
    // bill against.
    provider: IMAGE_PROVIDER,
    model: parsed.data.model,
    prompt: parsed.data.prompt,
    quality: parsed.data.quality,
    generation_ms: parsed.data.generationMs,
  });
}
