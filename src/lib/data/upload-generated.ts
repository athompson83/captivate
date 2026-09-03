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
 *
 * Cleanup is deliberately asymmetric. A refusal the server returned means
 * nothing committed, so the uploaded object is this operation's to remove; a
 * call that threw means nobody knows, so the object stays. Getting that
 * backwards deletes a picture out from under a row that already points at it.
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

  // The row, from the object's own bytes: the action reads them back and
  // sniffs them, so nothing here is asked to be believed.
  //
  // Registering is idempotent, which is what makes the retry below safe and
  // what makes it worth doing. A call that *throws* is ambiguous — the row may
  // have committed and the response been lost — so it is retried rather than
  // treated as a failure, and the retry answers with the committed row if
  // there is one.
  const register = () =>
    registerGeneratedImage({
      storagePath,
      prompt: preview.prompt,
      model: preview.model,
      quality: preview.quality,
      generationMs: preview.generationMs,
      altText: options.altText,
      presentationId: options.presentationId,
    });

  let registered: Awaited<ReturnType<typeof registerGeneratedImage>> | null = null;
  let ambiguous = false;
  for (let attempt = 0; attempt < 2 && !registered; attempt += 1) {
    try {
      registered = await register();
    } catch {
      ambiguous = true;
    }
  }

  if (registered?.ok) {
    return {
      ok: true,
      asset: { id: registered.data.id, url: registered.data.url, alt: options.altText },
    };
  }

  // Removed only when the server answered and said no: then nothing committed,
  // and the object is this operation's orphan. After a throw that survived the
  // retry, nothing is removed — an orphan in a private bucket is invisible and
  // costs storage, while deleting an object a committed row points at is a
  // broken picture in somebody's library, which is worse and is not undoable.
  if (!ambiguous) {
    await supabase.storage
      .from(STORAGE_BUCKETS.assets)
      .remove([storagePath])
      .catch(() => undefined);
  }
  return {
    ok: false,
    error: registered?.ok === false ? registered.error : "Couldn't save the image. Try again.",
  };
}
