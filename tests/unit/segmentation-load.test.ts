import { describe, expect, it } from "vitest";
import { fpsForRung, nextRung } from "@/lib/media/segmentation";

/**
 * What background removal does to a machine that cannot afford it.
 *
 * Before this, the loop asked for a segmented frame thirty times a second
 * whatever it cost, and the answer on weak hardware was a presentation that
 * stuttered — with no way for the presenter to tell that the pretty background
 * was what was eating their frame budget. The policy is now: slow down twice,
 * and if that is still not enough, stop and show the raw camera. A nicety
 * never gets to degrade the talk.
 */

const budgetAt = (fps: number) => (1000 / fps) * 0.7;

describe("segmentation under load", () => {
  it("stays put while it is affording the frame", () => {
    expect(nextRung(budgetAt(30) - 1, 0)).toEqual({ rung: 0, givenUp: false });
  });

  it("steps down when a frame costs more than its share of the budget", () => {
    const slower = nextRung(budgetAt(30) + 1, 0);
    expect(slower).toEqual({ rung: 1, givenUp: false });
    expect(fpsForRung(slower.rung)).toBeLessThan(fpsForRung(0));
  });

  it("steps down again rather than giving up on the first miss", () => {
    expect(nextRung(budgetAt(20) + 1, 1)).toEqual({ rung: 2, givenUp: false });
  });

  it("gives up at the bottom of the ladder instead of going slower still", () => {
    // Below the last rung the inset is a slideshow of the presenter, which is
    // worse than simply leaving their room behind them.
    const bottom = nextRung(budgetAt(12) + 50, 2);
    expect(bottom.givenUp).toBe(true);
    expect(bottom.rung).toBe(2);
  });

  it("recovers to staying put if the cost comes back down", () => {
    expect(nextRung(1, 2)).toEqual({ rung: 2, givenUp: false });
  });

  it("never reports a rate outside the ladder", () => {
    expect(fpsForRung(-5)).toBe(30);
    expect(fpsForRung(99)).toBe(12);
  });
});
