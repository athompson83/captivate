import "server-only";

import {
  generateImage,
  isImageGenerationConfigured,
  isStockSearchConfigured,
  searchStockPhotos,
} from "./visual-sourcing";
import { saveStockPhoto } from "@/lib/data/sourced-assets";
import { storeGeneratedImage } from "@/lib/data/sourced-store";

/**
 * Filling a generated deck's media slots with real photographs.
 *
 * Every picture goes through the same boundary a hand-picked one does:
 * `searchStockPhotos` / `generateImage` choose it, `saveStockPhoto` /
 * `storeGeneratedImage` fetch, verify and re-host the bytes into the caller's
 * own storage with provenance. Nothing here hotlinks a provider's CDN into a
 * document, and the paid path reserves budget before spending exactly as the
 * picker does.
 */

export interface FilledPhoto {
  /** The app-served asset URL, never the provider's. */
  url: string;
  assetId: string;
  alt: string;
}

export function isPhotoFillConfigured(): boolean {
  return isStockSearchConfigured() || isImageGenerationConfigured();
}

/**
 * Finds and re-hosts one stock photo for a scene.
 *
 * The query is the model's own few search words, falling back to the richer
 * image prompt — Pexels copes with a sentence, it just ranks words better.
 */
export async function fillWithStockPhoto(
  query: string,
  fallbackPrompt: string,
  presentationId: string | null,
): Promise<FilledPhoto | null> {
  if (!isStockSearchConfigured()) return null;
  const term = query.trim() || fallbackPrompt.trim();
  if (!term) return null;

  const found = await searchStockPhotos(term);
  if (!found.ok || found.data.length === 0) return null;

  // The first result at the largest usable size; landscape orientation is
  // already requested at the search.
  const photo = found.data[0];
  const saved = await saveStockPhoto({
    fullUrl: photo.fullUrl,
    providerAssetId: photo.providerAssetId,
    originalPageUrl: photo.originalPageUrl,
    creatorName: photo.creatorName,
    creatorPageUrl: photo.creatorPageUrl,
    licenseRef: photo.licenseRef,
    altText: photo.altText,
    presentationId,
  });
  if (!saved.ok) return null;

  return { url: saved.data.url, assetId: saved.data.id, alt: photo.altText };
}

/**
 * Generates and stores one image — the cover's fallback when there is no
 * stock key. Deliberately the only auto-spending image in a whole deck
 * generation: it goes through the same reserve-before-spend budget gate as
 * the picker, so the owner's ceilings hold.
 */
export async function fillWithGeneratedImage(
  prompt: string,
  presentationId: string | null,
): Promise<FilledPhoto | null> {
  if (!isImageGenerationConfigured()) return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const generated = await generateImage(
    `${trimmed}. Cinematic, photographic, no text or lettering anywhere in the image.`,
    presentationId,
  );
  if (!generated.ok) return null;

  const saved = await storeGeneratedImage(generated.data, { altText: trimmed, presentationId });
  if (!saved.ok) return null;

  return { url: saved.data.url, assetId: saved.data.id, alt: trimmed };
}
