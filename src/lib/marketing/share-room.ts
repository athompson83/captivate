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
 */

/** How long an unfurl waits for the room before going without it. */
export const ROOM_FETCH_MS = 2500;
/** A picture larger than this is a download, not a card's background. */
export const ROOM_MAX_BYTES = 8_000_000;

const DRAWABLE = /^image\/(jpeg|png)$/;

/** The room's picture as a data URI Satori draws, or `null` to go without. */
export async function roomForCard(url: string, deadlineMs = ROOM_FETCH_MS): Promise<string | null> {
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(deadlineMs),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!DRAWABLE.test(type)) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > ROOM_MAX_BYTES) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}
