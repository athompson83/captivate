import { getTheme } from "@/lib/schema/theme";

/**
 * The card a share link shows before it is opened.
 *
 * A link pasted into a chat is unfurled by the chat, and until now every
 * deck unfurled as the site's own card: the product's name where the
 * presentation's should be. This is the deck's card — its title in its own
 * theme, with the shape of the thing beneath — built as the plain markup
 * `next/og` rasterises. It is a pure function of the fields a link-holder
 * may already see, so it can never show more than the viewer would.
 *
 * Satori, the rasteriser, understands a subset of CSS: flex layout, plain
 * colours and gradients, no OKLCH and no custom properties. Theme tokens are
 * hex, so they pass straight through.
 */

export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

export interface ShareCardDeck {
  title: string;
  description: string;
  themeId: string;
  /** Scenes in the running order (asides excluded). */
  scenes: number;
  /** Movements: the deck's sections. */
  movements: number;
  /**
   * The room behind the show, when the deck has one and it arrived in time
   * (`roomForCard`): the picture, and the author's dim to lay the canvas
   * over it — the veil the stage draws on a scene, since a card is read up
   * close.
   */
  room?: { src: string; dim: number } | null;
}

/** The generic card, for a link that resolves to nothing a stranger may see. */
const FALLBACK: ShareCardDeck = {
  title: "A shared presentation",
  description: "A presentation made with Captivate.",
  themeId: "midnight",
  scenes: 0,
  movements: 0,
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What the bottom row says about the deck's shape; empty when there is none. */
export function shapeLine(deck: ShareCardDeck): string {
  if (deck.scenes <= 0) return "";
  const parts = [plural(deck.scenes, "scene")];
  if (deck.movements > 1) parts.push(plural(deck.movements, "movement"));
  return parts.join(" · ");
}

/** A title too long for one card is cut on a word, never mid-word. */
export function cardTitle(title: string, max = 90): string {
  const trimmed = title.trim();
  if (!trimmed) return FALLBACK.title;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max).replace(/\s+\S*$/, "");
  return `${cut}…`;
}

export function shareCard(deck: ShareCardDeck | null) {
  const card = deck ?? FALLBACK;
  const theme = getTheme(card.themeId);
  const { canvas, ink, inkMuted, accent, line } = theme.tokens;
  const title = cardTitle(card.title);
  const description = card.description.trim().slice(0, 160);
  const shape = shapeLine(card);
  const long = title.length > 48;
  const room = card.room ?? null;

  // The room's layers are placed against an unpadded root: Satori lays an
  // absolute child out from its parent's padding edge, and a room placed
  // inside the padding started eighty pixels in, a picture in a frame.
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        background: `radial-gradient(circle at 85% 15%, ${accent}33 0%, ${canvas} 55%)`,
        backgroundColor: canvas,
        color: ink,
        fontFamily: "sans-serif",
      }}
    >
      {room && (
        <>
          {/* The room, whole, with the veil the stage lays on a scene and
              the canvas rising behind the words so they read over any
              photograph. Satori has no colour matrix, so the room is as
              shot under the deck's canvas rather than graded to it. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori markup, not a page: it draws the element it is given */}
          <img
            src={room.src}
            alt=""
            width={SHARE_CARD_SIZE.width}
            height={SHARE_CARD_SIZE.height}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: SHARE_CARD_SIZE.width,
              height: SHARE_CARD_SIZE.height,
              objectFit: "cover",
            }}
          />
          <div
            data-room-veil
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: SHARE_CARD_SIZE.width,
              height: SHARE_CARD_SIZE.height,
              backgroundColor: canvas,
              opacity: Math.min(1, Math.max(0, room.dim)),
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: SHARE_CARD_SIZE.width,
              height: SHARE_CARD_SIZE.height,
              background: `linear-gradient(to bottom, ${canvas}00 25%, ${canvas}e6 100%)`,
            }}
          />
        </>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 14, color: inkMuted, fontSize: 26 }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: accent }} />
          <span>Captivate</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: long ? 64 : 84,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: ink,
            }}
          >
            {title}
          </div>
          {description && (
            <div style={{ fontSize: 30, lineHeight: 1.35, color: inkMuted }}>{description}</div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 28,
            borderTop: `2px solid ${line}`,
            fontSize: 26,
            color: inkMuted,
          }}
        >
          <span>{shape}</span>
          <span>Open to walk through it</span>
        </div>
      </div>
    </div>
  );
}
