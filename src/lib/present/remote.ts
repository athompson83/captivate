import { z } from "zod";
import { PresentMessage, PROTOCOL_VERSION } from "./protocol";

/**
 * The phone remote's wire format.
 *
 * `PresentMessage` is reused unchanged as the payload — the phone sends the
 * same commands the console sends, and reads the same state the stage
 * publishes. What is new is the envelope around it, because this is the first
 * transport that leaves the browser and a network has failure modes
 * `BroadcastChannel` structurally cannot have: a message delivered twice, a
 * message delivered late, a client reconnecting with a backlog of sends
 * queued behind it.
 *
 * Each of those is a specific hazard rather than a theoretical one. A `command`
 * applied twice double-advances the scene in front of a room. A reconnect that
 * flushes thirty seconds of queued presses walks the deck forward while the
 * presenter watches. So the envelope carries what is needed to notice: an id
 * to deduplicate on, a timestamp to age out on, and the session it belongs to.
 */

/** The Realtime topic for a remote session. Derived from the session, never the deck. */
export function remoteTopic(sessionId: string): string {
  return `captivate-remote-${sessionId}`;
}

export const RemoteEnvelope = z.object({
  protocolVersion: z.number().int().min(0).max(9999),
  sessionId: z.string().uuid(),
  /** Random per connection, so a client can ignore the echo of its own sends. */
  clientId: z.string().min(1).max(64),
  /** Random per envelope. The deduplication key. */
  messageId: z.string().min(1).max(64),
  sentAt: z.number(),
  payload: PresentMessage,
});
export type RemoteEnvelope = z.infer<typeof RemoteEnvelope>;

/**
 * How far in the past an envelope may have been sent and still be acted on.
 *
 * A reconnect can flush a queue: without this, coming back from a lift with no
 * signal fires every press made in it, in order, against the current scene.
 */
export const STALE_AFTER_MS = 30_000;

/**
 * A backstop, not the eviction rule.
 *
 * Ids are forgotten by age, so that the memory and the staleness window line
 * up exactly: anything still young enough to be acted on is still remembered,
 * and a duplicate therefore cannot slip through by being crowded out. A count
 * limit alone would not hold that — pointer envelopes stream at frame rate, so
 * a few seconds of laser movement between a command and its duplicate is
 * enough to evict the original and let the second one advance the scene again.
 *
 * This number only bounds the pathological case (a peer flooding the channel),
 * at which point dropping the oldest is the least-bad option available.
 */
const SEEN_CEILING = 8000;

export type RejectReason =
  "malformed" | "wrong-session" | "wrong-version" | "own-echo" | "duplicate" | "stale";

export type Accepted = { ok: true; envelope: RemoteEnvelope };
export type Rejected = { ok: false; reason: RejectReason };

/**
 * Decides whether an inbound envelope should be acted on.
 *
 * Deliberately not a filter on the transport: the checks are here, in one
 * testable place, because "the channel only carries our messages" is exactly
 * the assumption that stops being true the moment something is misconfigured.
 * RLS on the channel should already prevent a foreign session's message from
 * arriving; this checks anyway.
 */
export class RemoteInbox {
  /** Message id → the time it was accepted, so ids age out with the window. */
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly sessionId: string,
    private readonly clientId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** How many ids are being remembered. Exposed so a test can pin the bound. */
  get size(): number {
    return this.seen.size;
  }

  accept(raw: unknown): Accepted | Rejected {
    const parsed = RemoteEnvelope.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "malformed" };
    const envelope = parsed.data;

    if (envelope.sessionId !== this.sessionId) return { ok: false, reason: "wrong-session" };

    // Ignore rather than crash: a peer on a newer build is a deploy mid-talk,
    // not an attack, and the right behaviour is to keep working with the peers
    // that still speak this version.
    if (envelope.protocolVersion !== PROTOCOL_VERSION) {
      return { ok: false, reason: "wrong-version" };
    }

    // Broadcast echoes a sender its own message; acting on it would apply
    // every command twice on the device that sent it.
    if (envelope.clientId === this.clientId) return { ok: false, reason: "own-echo" };

    const now = this.now();
    this.forgetOlderThan(now);
    if (this.seen.has(envelope.messageId)) return { ok: false, reason: "duplicate" };

    // Only the past is stale. A phone whose clock runs fast would otherwise
    // have every message it sends rejected, which is worse than acting on one
    // that claims to be from the future.
    if (now - envelope.sentAt > STALE_AFTER_MS) return { ok: false, reason: "stale" };

    this.seen.set(envelope.messageId, now);
    return { ok: true, envelope };
  }

  private forgetOlderThan(now: number): void {
    // Map iterates in insertion order and `now` never goes backwards, so the
    // oldest entries are at the front and the walk stops at the first live one.
    for (const [id, at] of this.seen) {
      if (now - at <= STALE_AFTER_MS) break;
      this.seen.delete(id);
    }
    while (this.seen.size > SEEN_CEILING) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
  }
}

/** A connection's own identity. Random per connection, not per device. */
export function newClientId(): string {
  return crypto.randomUUID();
}

export function seal(
  sessionId: string,
  clientId: string,
  payload: PresentMessage,
  now: () => number = Date.now,
): RemoteEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    clientId,
    messageId: crypto.randomUUID(),
    sentAt: now(),
    payload,
  };
}

/**
 * What the phone shows about the link.
 *
 * Five states rather than one spinner, because they mean different things to
 * someone standing in front of a room: nothing is connected, something is
 * being retried, the link is live, a press is in flight, and a press was seen.
 * "Sent" resolving to "confirmed" is the only honest acknowledgement available
 * — the transport confirming delivery proves the message reached the service,
 * not that the stage acted on it. The stage's next `state` broadcast is what
 * proves that, and it already flows.
 */
export type RemoteStatus = "disconnected" | "reconnecting" | "connected" | "sent" | "confirmed";

/** How long a press may stay unconfirmed before the phone stops claiming it worked. */
export const CONFIRM_TIMEOUT_MS = 4000;
