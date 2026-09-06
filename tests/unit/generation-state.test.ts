import { describe, expect, it } from "vitest";
import {
  GENERATING_WINDOW_MS,
  canFinish,
  generationLabel,
  generationState,
  unfinishedGenerationNote,
} from "@/lib/data/generation-state";

/**
 * A deck that can say where its own generation got to.
 *
 * Writing a deck is one request that may run for five minutes; a phone locks
 * long before that. The work itself survives — Vercel's request cancellation
 * is opt-in and this project does not enable it, so the function finishes
 * whether or not anyone is still listening. What did not survive was the
 * author's ability to find out.
 *
 * Production, 2026-09-06: two presentations both called "How to Build a Side
 * Hustle With AI", created a minute apart, each with sixteen moments and
 * sixteen placeholder scenes. That is what "I could not tell what happened, so
 * I pressed it again" looks like in a table.
 */

const NOW = Date.parse("2026-09-06T17:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("what a deck says it is doing", () => {
  it("says nothing at all when it is simply ready", () => {
    expect(generationState("ready", null, NOW)).toBe("ready");
    expect(generationLabel("ready")).toBeNull();
  });

  it("is generating while the route that writes it could still be running", () => {
    expect(generationState("generating", ago(30_000), NOW)).toBe("generating");
    expect(generationState("generating", ago(GENERATING_WINDOW_MS - 1_000), NOW)).toBe(
      "generating",
    );
  });

  it("stops claiming to be busy once nothing could still be writing it", () => {
    // A runtime killed outright leaves the row mid-sentence. Past the window
    // there is nothing left to finish it, and saying "generating" for ever is
    // a spinner that never resolves.
    expect(generationState("generating", ago(GENERATING_WINDOW_MS + 1_000), NOW)).toBe("stalled");
    expect(generationState("generating", ago(86_400_000), NOW)).toBe("stalled");
  });

  it("treats a claim with no timestamp as stalled rather than busy", () => {
    expect(generationState("generating", null, NOW)).toBe("stalled");
    expect(generationState("generating", "not a date", NOW)).toBe("stalled");
  });

  it("keeps the two ways a generation can end badly apart", () => {
    // Different things to tell someone: one has a deck full of placeholders,
    // the other has a map and no scenes.
    expect(generationState("partial", null, NOW)).toBe("partial");
    expect(generationState("failed", null, NOW)).toBe("failed");
    expect(generationLabel("partial")).not.toBe(generationLabel("failed"));
  });

  it("reads an unknown or missing status as ready rather than alarming anyone", () => {
    // Every deck written before this column existed defaults to `ready`, and a
    // value from a newer build must not make an older one show a warning it
    // cannot explain.
    expect(generationState(null, null, NOW)).toBe("ready");
    expect(generationState(undefined, null, NOW)).toBe("ready");
    expect(generationState("something-new", null, NOW)).toBe("ready");
  });
});

describe("which decks are worth offering to finish", () => {
  it("offers on every ending that left work undone", () => {
    expect(canFinish("stalled")).toBe(true);
    expect(canFinish("partial")).toBe(true);
    expect(canFinish("failed")).toBe(true);
  });

  it("never offers on a deck that is finished or still being written", () => {
    // Offering to re-run a generation that is still in flight is how a deck
    // ends up written twice.
    expect(canFinish("ready")).toBe(false);
    expect(canFinish("generating")).toBe(false);
  });
});

describe("what the author is told", () => {
  it("says something specific for every state that is not ready", () => {
    for (const state of ["generating", "stalled", "partial", "failed"] as const) {
      const label = generationLabel(state);
      expect(label, state).toBeTruthy();
      expect(label!.length, state).toBeGreaterThan(0);
    }
  });
});

describe("what the map says next to the button that finishes it", () => {
  /**
   * The dashboard offers "open it to finish". For a release, opening it
   * finished nothing: the map looked ordinary and never said which of its
   * scenes were placeholders.
   */
  it("says something specific for every way a generation can be left undone", () => {
    for (const status of ["generating", "partial", "failed"]) {
      expect(unfinishedGenerationNote(status, false), status).toBeTruthy();
    }
    // Three different situations, three different things to tell someone.
    const said = ["generating", "partial", "failed"].map((s) => unfinishedGenerationNote(s, false));
    expect(new Set(said).size).toBe(3);
  });

  it("says nothing at all about a deck that is simply finished", () => {
    expect(unfinishedGenerationNote("ready", false)).toBeNull();
    expect(unfinishedGenerationNote(null, false)).toBeNull();
    expect(unfinishedGenerationNote(undefined, false)).toBeNull();
    expect(unfinishedGenerationNote("something-new", false)).toBeNull();
  });

  it("stays quiet while this tab is the one generating", () => {
    // The only case where a stored `generating` means what it says rather than
    // naming a run somebody walked away from. Telling an author their deck was
    // abandoned while they watch it being written is worse than saying nothing.
    for (const status of ["generating", "partial", "failed", "ready"]) {
      expect(unfinishedGenerationNote(status, true), status).toBeNull();
    }
  });
});
