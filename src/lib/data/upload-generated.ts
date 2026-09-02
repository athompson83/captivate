"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import { sniffImage } from "@/lib/ai/image-signature";
import { registerGeneratedImage } from "./sourced-assets";
import { MAX_UPLOAD_BYTES } from "./upload-limits";

/**
 * Keeps a generated image the author has accepted.
 *
 * The preview is a data URL held in memory, and the first version handed that
 * whole string to a server action to decode and store. On production the
 * picture previewed and then never saved: a 1536x1024 PNG is a few megabytes
 * of base64, a server action stops reading its body at one, and the action
 * threw before its first line ran — so the caller's `await` never settled, the
 * button spun, and no sentence was shown. The route that already carries big
 * files is the browser writing straight into its own storage prefix and then
 * registering what it wrote, which is what uploads do; this does the same.
 *
 * The bytes are read back out of the data URL by hand rather than through
 * `fetch(dataUrl)`, because the page's `connect-src` does not list `data:` and
 * a fetch of one is refused by the browser before it starts.
 */

export interface GeneratedPreview {
  previewDataUrl: string;
  model: string;
  prompt: string;
  quality: string;
  generationMs: number;
}

export interface KeptImage {
  id: string;
  url: string;
  alt: string;
}

export type KeepResult = { ok: true; asset: KeptImage } | { ok: false; error: string };

/** The bytes behind a base64 data URL, or null when it is not one. */
export function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  if (!dataUrl.slice(5, comma).endsWith(";base64")) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function keepGeneratedImage(
  preview: GeneratedPreview,
  options: { altText: string; presentationId: string | null },
): Promise<KeepResult> {
  const bytes = decodeDataUrl(preview.previewDataUrl);
  if (!bytes) return { ok: false, error: "That image couldn't be read." };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That image is larger than the upload limit." };
  }

  // What the bytes are, not what the preview said. The server checks the same
  // claim against its own list, but the content type the object is stored
  // under is decided here, and a WebP filed as a PNG renders nowhere.
  const signature = sniffImage(bytes);
  if (!signature)
    return { ok: false, error: "That file isn't an image, whatever it claims to be." };

  const supabase = supabaseBrowser();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out. Sign in again to keep it." };

  const storagePath = `${user.id}/${crypto.randomUUID()}.${signature.extension}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKETS.assets)
    .upload(storagePath, bytes, { contentType: signature.mimeType, upsert: false });
  if (error) return { ok: false, error: "Couldn't save the image. Nothing was changed." };

  const registered = await registerGeneratedImage({
    storagePath,
    mimeType: signature.mimeType,
    byteSize: bytes.byteLength,
    prompt: preview.prompt,
    model: preview.model,
    quality: preview.quality,
    generationMs: preview.generationMs,
    altText: options.altText,
    presentationId: options.presentationId,
  });
  // Registration removes the object when the row cannot be written, so a
  // failure here leaves nothing behind to report on.
  if (!registered.ok) return { ok: false, error: registered.error };

  return {
    ok: true,
    asset: { id: registered.data.id, url: registered.data.url, alt: options.altText },
  };
}
