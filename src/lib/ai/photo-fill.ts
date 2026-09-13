import "server-only";

import {
  generateImage,
  isImageGenerationConfigured,
  isStockSearchConfigured,
  searchStockPhotos,
  type ImageShape,
} from "./visual-sourcing";
import { chooseStockPhoto } from "./choose-photo";
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

export interface StockFillOptions {
  /**
   * The rendered shape of the slot this fills — see `chooseStockPhoto`. A
   * split scene's tall half and a full-bleed cover want opposite pictures, and
   * taking the provider's first result gave them the same one.
   */
  slotAspect: number;
  /**
   * Provider asset ids already used elsewhere in this deck, so the same
   * photograph does not arrive on two scenes. Mutated as pictures are chosen.
   */
  taken?: Set<string>;
  /**
   * When the caller stops waiting, as a clock time. The search has its own
   * twelve-second timeout and the download its twenty; checked between them,
   * so a deadline that passes during the search stores nothing, and the most
   * a caller can overrun by is one of the two.
   */
  deadline?: number;
}

/**
 * Finds and re-hosts one stock photo for a scene.
 *
 * The query is the model's own few search words, falling back to the richer
 * image prompt — Pexels copes with a sentence, it just ranks words better.
 * Which of the twenty-four results actually lands is a real decision and is
 * made in `chooseStockPhoto`, from the slot's shape, the picture's resolution,
 * the scene's own vocabulary and what the rest of the deck has already used.
 */
export async function fillWithStockPhoto(
  query: string,
  fallbackPrompt: string,
  presentationId: string | null,
  options: StockFillOptions = { slotAspect: 16 / 9 },
): Promise<FilledPhoto | null> {
  if (!isStockSearchConfigured()) return null;
  const term = query.trim() || fallbackPrompt.trim();
  if (!term) return null;
  const late = () => options.deadline !== undefined && Date.now() >= options.deadline;
  if (late()) return null;

  const found = await searchStockPhotos(term);
  if (!found.ok || found.data.length === 0) return null;
  if (late()) return null;

  const photo = chooseStockPhoto(found.data, {
    slotAspect: options.slotAspect,
    terms: `${query} ${fallbackPrompt}`,
    taken: options.taken,
  });
  if (!photo) return null;
  // Claimed before the bytes are fetched, so two scenes racing the same search
  // cannot both take it.
  options.taken?.add(photo.providerAssetId);
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
  { shape = "wide", alt }: { shape?: ImageShape; alt?: string } = {},
): Promise<FilledPhoto | null> {
  if (!isImageGenerationConfigured()) return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  // The prompt arrives composed — the scene's picture, the deck's look and
  // its palette (`lib/ai/look.ts`) — so nothing is appended here.
  const generated = await generateImage(trimmed, presentationId, { shape });
  if (!generated.ok) return null;

  const altText = (alt ?? trimmed).slice(0, 600);
  const saved = await storeGeneratedImage(generated.data, { altText, presentationId });
  if (!saved.ok) return null;

  return { url: saved.data.url, assetId: saved.data.id, alt: altText };
}
