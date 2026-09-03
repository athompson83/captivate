/**
 * What image bytes actually are, as opposed to what anything says they are.
 *
 * A plain module with no `server-only` import, because the question is asked
 * in two places now: on the server, for bytes a provider or a stock host
 * returned, and in the browser, for a generated preview the author has chosen
 * to keep. The browser case exists because the accepted bytes go straight to
 * storage from there — a data URL for a 1536x1024 picture is several megabytes,
 * and a server action stops reading at one.
 *
 * The rule the first version got wrong: test for a PNG signature and store
 * `image/png`. Right while exactly one model could produce a generated image,
 * and silently wrong the moment another could — a WebP stored under a PNG
 * content type renders nowhere, and the check meant to catch a lie rejected a
 * perfectly good picture. Reading the type *out of* the bytes answers both
 * questions at once: is this an image at all, and which one.
 */

export interface ImageSignature {
  mimeType: string;
  extension: string;
}

/** Image types this deployment will store, and what to call the file. */
export const STORABLE_IMAGE: Record<string, ImageSignature> = {
  "image/png": { mimeType: "image/png", extension: "png" },
  "image/jpeg": { mimeType: "image/jpeg", extension: "jpg" },
  "image/webp": { mimeType: "image/webp", extension: "webp" },
};

/**
 * The type these bytes actually are, or null if they are not one this
 * deployment keeps.
 *
 * Answers both questions at once — is this an image, and which one — so no
 * caller has to trust a declared content type. Null is a real answer and the
 * callers act on it: nothing is uploaded, stored or recorded for bytes that do
 * not identify themselves.
 */
export function sniffImage(bytes: Uint8Array): ImageSignature | null {
  const at = (i: number) => bytes[i] ?? -1;
  // All eight bytes of the PNG signature, not the four that spell "PNG": the
  // trailing CR LF SUB LF is what tells a real file from a payload that merely
  // begins with the letters, and a browser given the latter renders nothing.
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return STORABLE_IMAGE["image/png"];
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return STORABLE_IMAGE["image/jpeg"];
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return STORABLE_IMAGE["image/webp"];
  }
  return null;
}
