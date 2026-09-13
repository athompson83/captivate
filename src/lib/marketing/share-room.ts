import { sniffImage } from "@/lib/ai/image-signature";

/**
 * The room behind the show, fetched for the card.
 *
 * The card is rasterised by Satori, which can draw a picture it is handed
 * but should not be left to fetch one: an unfurl is a chat waiting, and a
 * room that is slow to arrive would hold the whole card. So the picture is
 * fetched here under a deadline and handed over as bytes, and a room that
 * does not arrive in time — or is not a picture Satori can draw, or is
 * larger than a card has any use for — is simply not on the card. The card
 * without its room is the card every deck had until now, never an error.
 *
 * Only a room Captivate holds is carried. Every room the app makes, finds or
 * uploads is stored as an asset and addressed as `/api/assets/<id>/content`;
 * the card resolves that address the way the viewer's images are resolved
 * (`captivate_shared_asset`, gated on the deck being shared right now) and
 * reads the bytes from the deck's own storage. A room linked from elsewhere
 * by hand is the viewer's to load, in the browser, as it always was: the
 * server fetches nothing an author typed, so there is no address here that
 * could point it at a host of the author's choosing. Codex caught both
 * halves of this — the first draft refused the app's own addresses and
 * fetched everyone else's.
 */

/** How long an unfurl waits for the room before going without it. */
export const ROOM_FETCH_MS = 2500;
/** A picture larger than this is a download, not a card's background. */
export const ROOM_MAX_BYTES = 8_000_000;

/** What Satori's rasteriser draws; a WebP room is stored but not carried. */
const DRAWABLE = new Set(["image/jpeg", "image/png"]);

const ASSET_CONTENT =
  /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content$/i;

/** The asset an app-owned room address names, or `null` for any other address. */
export function roomAssetId(url: string): string | null {
  const match = ASSET_CONTENT.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Where a shared asset's bytes may be read from for a moment, and what they
 * are declared to be. `null` when the asset is not one a link-holder may
 * see. Supplied by the share module, which is the only place that may ask.
 */
export type RoomSource = (assetId: string) => Promise<{ url: string; type: string } | null>;

/** Reads a body up to the cap; `null` the moment it runs past. */
export async function readCapped(
  body: ReadableStream<Uint8Array>,
  cap: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    // Abandoned mid-stream rather than after: a body that never ends must
    // not hold memory until it does.
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The room's picture as a data URI Satori draws, or `null` to go without. */
export async function roomForCard(
  url: string,
  source: RoomSource,
  deadlineMs = ROOM_FETCH_MS,
): Promise<string | null> {
  const assetId = roomAssetId(url);
  if (!assetId) return null;
  const signal = AbortSignal.timeout(deadlineMs);
  try {
    const found = await Promise.race([
      source(assetId),
      new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null))),
    ]);
    if (!found || signal.aborted) return null;
    if (!DRAWABLE.has(found.type.split(";")[0].trim().toLowerCase())) return null;

    const response = await fetch(found.url, { signal, cache: "no-store" });
    if (!response.ok || !response.body) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > ROOM_MAX_BYTES) return null;
    const bytes = await readCapped(response.body, ROOM_MAX_BYTES);
    if (!bytes || bytes.byteLength === 0) return null;

    // The bytes say what they are; the row's type was a claim.
    const signature = sniffImage(bytes);
    if (!signature || !DRAWABLE.has(signature.mimeType)) return null;
    return `data:${signature.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}
