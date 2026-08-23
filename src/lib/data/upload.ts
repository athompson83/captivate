"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import { registerAsset } from "./assets";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from "./upload-limits";

/**
 * Browser upload.
 *
 * The file goes directly from the browser to Supabase Storage, so large media
 * never passes through a serverless function body limit. Storage RLS requires
 * the object key to begin with the caller's user id, which is what makes the
 * client-chosen path safe.
 */

export interface UploadedAsset {
  id: string;
  url: string;
  alt: string;
  kind: "image" | "video" | "audio" | "file";
  width: number | null;
  height: number | null;
}

export interface UploadOptions {
  presentationId?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export type UploadResult = { ok: true; asset: UploadedAsset } | { ok: false; error: string };

export function validateFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return `“${file.name}” is a ${file.type || "unknown"} file, which isn't supported.`;
  }
  return null;
}

export async function uploadFile(file: File, options: UploadOptions = {}): Promise<UploadResult> {
  const validationError = validateFile(file);
  if (validationError) return { ok: false, error: validationError };

  const supabase = supabaseBrowser();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out. Sign in again to upload." };

  const extension = extensionFor(file);
  const path = `${user.id}/${crypto.randomUUID()}${extension}`;

  options.onProgress?.(0.05);

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKETS.assets)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { ok: false, error: friendlyStorageError(uploadError.message) };
  }

  options.onProgress?.(0.75);

  // Intrinsic dimensions let the editor place media at the right aspect ratio
  // instead of guessing a square.
  const dimensions = await readDimensions(file).catch(() => null);

  const registered = await registerAsset({
    storagePath: path,
    mimeType: file.type,
    byteSize: file.size,
    originalFilename: file.name.slice(0, 260),
    presentationId: options.presentationId ?? null,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    durationSeconds: dimensions?.duration ?? null,
    altText: "",
  });

  if (!registered.ok) {
    // Registration cleaned up the object already; report the real reason.
    return { ok: false, error: registered.error };
  }

  options.onProgress?.(1);

  return {
    ok: true,
    asset: {
      id: registered.data.id,
      url: registered.data.url,
      alt: "",
      kind: (file.type.split("/")[0] as UploadedAsset["kind"]) ?? "file",
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    },
  };
}

function extensionFor(file: File): string {
  const fromName = file.name.match(/\.[a-z0-9]{1,8}$/i)?.[0];
  if (fromName) return fromName.toLowerCase();
  const fromType = file.type.split("/")[1];
  return fromType ? `.${fromType.split("+")[0]}` : "";
}

function friendlyStorageError(message: string): string {
  if (/exceeded the maximum allowed size|payload too large/i.test(message)) {
    return "That file is larger than the storage limit allows.";
  }
  if (/mime type .* is not supported/i.test(message)) {
    return "That file type isn't allowed for uploads.";
  }
  if (/duplicate|already exists/i.test(message)) {
    return "A file with that name already exists. Try again.";
  }
  return `Upload failed: ${message}`;
}

async function readDimensions(
  file: File,
): Promise<{ width: number | null; height: number | null; duration: number | null } | null> {
  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return null;
    const result = { width: bitmap.width, height: bitmap.height, duration: null };
    bitmap.close();
    return result;
  }

  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
    return new Promise((resolve) => {
      const isVideo = file.type.startsWith("video/");
      const media = document.createElement(isVideo ? "video" : "audio");
      const url = URL.createObjectURL(file);
      const done = (
        value: { width: number | null; height: number | null; duration: number | null } | null,
      ) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      media.preload = "metadata";
      media.onloadedmetadata = () =>
        done({
          width: isVideo ? (media as HTMLVideoElement).videoWidth : null,
          height: isVideo ? (media as HTMLVideoElement).videoHeight : null,
          duration: Number.isFinite(media.duration) ? media.duration : null,
        });
      media.onerror = () => done(null);
      media.src = url;
    });
  }

  return null;
}

export { MAX_UPLOAD_BYTES, ALLOWED_MIME };
