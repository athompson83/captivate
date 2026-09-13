import { ImageResponse } from "next/og";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSharedDeck } from "@/lib/data/shared";
import { SHARE_CARD_SIZE, shareCard } from "@/lib/marketing/share-card";
import { roomForCard } from "@/lib/marketing/share-room";

/**
 * The deck's own card, for the chat a share link is pasted into.
 *
 * Resolved through the same function the viewer uses, so a revoked or
 * mistyped link unfurls as the generic card and never as a deck. The
 * request-time read keeps this dynamic: nothing is cached past the moment
 * the owner turns the link off.
 */
export const alt = "A shared presentation";
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deck = isSupabaseConfigured ? await getSharedDeck(token).catch(() => null) : null;
  // The room behind the show, under a deadline: a chat is waiting on this.
  const backdrop = deck?.journey.backdrop;
  const room = backdrop?.url ? await roomForCard(backdrop.url) : null;
  return new ImageResponse(
    shareCard(
      deck
        ? {
            title: deck.title,
            description: deck.description,
            themeId: deck.themeId,
            scenes: deck.scenes.filter((scene) => scene.flowRole !== "detail").length,
            movements: deck.sections.length,
            room: room && backdrop ? { src: room, dim: backdrop.dim } : null,
          }
        : null,
    ),
    size,
  );
}
