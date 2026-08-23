/**
 * Upload constraints, shared by the browser uploader and the server action that
 * registers the result.
 *
 * These deliberately live outside the `"use server"` module: a server-actions
 * file may only export async functions, and exporting a constant from one makes
 * every action in it fail at runtime with a 500.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
