import { describe, expect, it } from "vitest";
import { RemoteInbox, STALE_AFTER_MS, remoteTopic, seal } from "@/lib/present/remote";
import { PROTOCOL_VERSION } from "@/lib/present/protocol";

/**
 * The inbox is where a network transport stops being a BroadcastChannel.
 *
 * Every rejection below corresponds to something that would be visible from
 * the back of a room: a command applied twice advances two scenes, a flushed
 * reconnect backlog walks the deck forward on its own, and a message from
 * another session should not be able to arrive at all — but is checked anyway,
 * because "the channel only carries our messages" is exactly the assumption
 * that stops holding when something is misconfigured.
 */

const SESSION = "eeeeeeee-0000-4000-8000-000000000001";
const OTHER_SESSION = "eeeeeeee-0000-4000-8000-000000000002";
const ME = "client-me";
const THEM = "client-them";

const NEXT = { type: "command", action: "next" } as const;

function inboxAt(now: number) {
  return new RemoteInbox(SESSION, ME, () => now);
}

function fromThem(overrides: Record<string, unknown> = {}, at = 1_000) {
  return { ...seal(SESSION, THEM, NEXT, () => at), ...overrides };
}

describe("remote topic", () => {
  it("names the session, never the presentation", () => {
    // A presentation id is long-lived and appears in shareable-looking URLs;
    // a channel named after one would be addressable by anyone who ever saw it.
    expect(remoteTopic(SESSION)).toBe(`captivate-remote-${SESSION}`);
  });
});

describe("RemoteInbox", () => {
  it("accepts a well-formed envelope from the other end", () => {
    const result = inboxAt(1_000).accept(fromThem());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.payload).toEqual(NEXT);
  });

  it("rejects a second copy of the same message", () => {
    const inbox = inboxAt(1_000);
    const envelope = fromThem();
    expect(inbox.accept(envelope).ok).toBe(true);
    // The hazard: a duplicate `next` advances two scenes in front of a room.
    expect(inbox.accept(envelope)).toEqual({ ok: false, reason: "duplicate" });
  });

  it("rejects the echo of its own send", () => {
    const mine = seal(SESSION, ME, NEXT, () => 1_000);
    expect(inboxAt(1_000).accept(mine)).toEqual({ ok: false, reason: "own-echo" });
  });

  it("rejects an envelope from another session", () => {
    const stray = { ...fromThem(), sessionId: OTHER_SESSION };
    expect(inboxAt(1_000).accept(stray)).toEqual({ ok: false, reason: "wrong-session" });
  });

  it("rejects a protocol version it does not speak", () => {
    const newer = { ...fromThem(), protocolVersion: PROTOCOL_VERSION + 1 };
    expect(inboxAt(1_000).accept(newer)).toEqual({ ok: false, reason: "wrong-version" });
  });

  it("rejects a payload that is not a valid message", () => {
    const bad = { ...fromThem(), payload: { type: "command", action: "self-destruct" } };
    expect(inboxAt(1_000).accept(bad)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a backlog flushed after a reconnect", () => {
    const queued = fromThem({}, 1_000);
    // Coming back from a dead spot must not fire every press made in it.
    expect(inboxAt(1_000 + STALE_AFTER_MS + 1).accept(queued)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("accepts one that is only just inside the window", () => {
    const queued = fromThem({}, 1_000);
    expect(inboxAt(1_000 + STALE_AFTER_MS).accept(queued).ok).toBe(true);
  });

  it("accepts an envelope whose sender's clock runs fast", () => {
    // Rejecting the future would silence a phone with a skewed clock entirely,
    // which is worse than acting on a message that claims to be from it.
    const ahead = fromThem({}, 60_000);
    expect(inboxAt(1_000).accept(ahead).ok).toBe(true);
  });

  it("still catches a duplicate buried under a burst of pointer traffic", () => {
    // The reason ids age out rather than falling off the end of a fixed ring:
    // the laser streams envelopes at frame rate, so a count-limited buffer
    // forgets a command within a second or two of it arriving — and the
    // duplicate that turns up next advances the scene a second time.
    let clock = 1_000;
    const inbox = new RemoteInbox(SESSION, ME, () => clock);
    const command = fromThem({}, clock);
    expect(inbox.accept(command).ok).toBe(true);

    for (let i = 0; i < 2_000; i += 1) {
      clock += 1;
      const pointer = seal(
        SESSION,
        THEM,
        { type: "pointer", point: { x: 0.5, y: 0.5 }, tool: "laser", color: "#fff" },
        () => clock,
      );
      expect(inbox.accept(pointer).ok).toBe(true);
    }

    expect(inbox.accept(command)).toEqual({ ok: false, reason: "duplicate" });
  });

  it("forgets ids once they are older than the staleness window", () => {
    // Memory is bounded by the same rule that bounds relevance: anything old
    // enough to be forgotten is old enough to be rejected as stale anyway.
    let clock = 1_000;
    const inbox = new RemoteInbox(SESSION, ME, () => clock);
    expect(inbox.accept(fromThem({}, clock)).ok).toBe(true);
    expect(inbox.size).toBe(1);

    clock += STALE_AFTER_MS + 1;
    expect(inbox.accept(fromThem({}, clock)).ok).toBe(true);
    expect(inbox.size).toBe(1);
  });
});

describe("seal", () => {
  it("stamps the current protocol version and a unique id each time", () => {
    const a = seal(SESSION, ME, NEXT, () => 1_000);
    const b = seal(SESSION, ME, NEXT, () => 1_000);
    expect(a.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(a.sessionId).toBe(SESSION);
    expect(a.messageId).not.toBe(b.messageId);
  });
});
