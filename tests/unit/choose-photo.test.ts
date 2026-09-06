import { describe, expect, it } from "vitest";
import { chooseStockPhoto, scorePhoto } from "@/lib/ai/choose-photo";
import type { StockResult } from "@/lib/ai/visual-sourcing";

/**
 * The first search result is not a creative decision.
 *
 * Every scene in every generated deck took `found.data[0]`, which is the
 * provider's best guess from the *words* alone. It cannot know the shape of
 * the hole, how much of the picture survives being cropped into it, or that
 * another scene already used it.
 */

const photo = (over: Partial<StockResult> & { providerAssetId: string }): StockResult => ({
  thumbnailUrl: "https://example.test/t.jpg",
  fullUrl: "https://example.test/f.jpg",
  originalPageUrl: "https://example.test/p",
  creatorName: "A Photographer",
  creatorPageUrl: "https://example.test/c",
  licenseRef: "Pexels License",
  altText: "",
  width: 3000,
  height: 2000,
  ...over,
});

/** The tall half of a split scene, as the room sees it on a 16:9 display. */
const SPLIT = 8 / 9;
/** A full-bleed cover. */
const COVER = 16 / 9;

describe("choosing for the slot", () => {
  it("prefers the picture that survives the crop into a tall half-scene", () => {
    const wide = photo({ providerAssetId: "wide", width: 4000, height: 1500 });
    const upright = photo({ providerAssetId: "upright", width: 2000, height: 2200 });
    expect(chooseStockPhoto([wide, upright], { slotAspect: SPLIT, terms: "" })?.providerAssetId).toBe(
      "upright",
    );
  });

  it("prefers the wide one for a full-bleed cover", () => {
    const wide = photo({ providerAssetId: "wide", width: 4000, height: 2250 });
    const upright = photo({ providerAssetId: "upright", width: 2000, height: 2200 });
    expect(chooseStockPhoto([wide, upright], { slotAspect: COVER, terms: "" })?.providerAssetId).toBe(
      "wide",
    );
  });

  it("refuses a picture that would be soft on a projector when a sharp one exists", () => {
    const small = photo({ providerAssetId: "small", width: 600, height: 400 });
    const large = photo({ providerAssetId: "large", width: 3000, height: 2000 });
    expect(chooseStockPhoto([small, large], { slotAspect: COVER, terms: "" })?.providerAssetId).toBe(
      "large",
    );
  });
});

describe("choosing for meaning", () => {
  it("prefers a candidate whose description shares the scene's own words", () => {
    const generic = photo({ providerAssetId: "generic", altText: "a busy city street at night" });
    const onPoint = photo({
      providerAssetId: "on-point",
      altText: "paramedic transfusing whole blood in an ambulance",
    });
    const chosen = chooseStockPhoto([generic, onPoint], {
      slotAspect: COVER,
      terms: "paramedic transfusing whole blood at the roadside",
    });
    expect(chosen?.providerAssetId).toBe("on-point");
  });

  it("keeps the provider's own ranking as the tie-breaker", () => {
    // Identical on every measure this can see, so the provider's judgement
    // about the words is the only thing left and it is not thrown away.
    const first = photo({ providerAssetId: "first" });
    const second = photo({ providerAssetId: "second" });
    expect(chooseStockPhoto([first, second], { slotAspect: COVER, terms: "" })?.providerAssetId).toBe(
      "first",
    );
  });

  it("does not let a description alone beat a picture of the right shape", () => {
    // Meaning matters; a picture two-thirds of which is cropped away matters
    // more, because what is cropped away is usually the subject.
    const wordy = photo({
      providerAssetId: "wordy",
      width: 4000,
      height: 1200,
      altText: "whole blood transfusion paramedic ambulance roadside",
    });
    const shaped = photo({ providerAssetId: "shaped", width: 2000, height: 2200 });
    expect(
      chooseStockPhoto([wordy, shaped], {
        slotAspect: SPLIT,
        terms: "whole blood transfusion paramedic",
      })?.providerAssetId,
    ).toBe("shaped");
  });
});

describe("across a deck", () => {
  it("never puts the same photograph on two scenes", () => {
    const only = photo({ providerAssetId: "only" });
    const other = photo({ providerAssetId: "other" });
    const taken = new Set(["only"]);
    expect(
      chooseStockPhoto([only, other], { slotAspect: COVER, terms: "", taken })?.providerAssetId,
    ).toBe("other");
  });

  it("returns nothing rather than repeating when every candidate is used", () => {
    const only = photo({ providerAssetId: "only" });
    expect(
      chooseStockPhoto([only], { slotAspect: COVER, terms: "", taken: new Set(["only"]) }),
    ).toBeNull();
  });

  it("returns nothing for an empty search", () => {
    expect(chooseStockPhoto([], { slotAspect: COVER, terms: "anything" })).toBeNull();
  });
});

describe("scoring", () => {
  it("scores a shape-matched, sharp, on-topic picture above everything else", () => {
    const ideal = photo({
      providerAssetId: "ideal",
      width: 3200,
      height: 1800,
      altText: "an ambulance at dusk",
    });
    const poor = photo({ providerAssetId: "poor", width: 500, height: 1500, altText: "a teacup" });
    const wanted = new Set(["ambulance", "dusk"]);
    expect(scorePhoto(ideal, COVER, wanted)).toBeGreaterThan(scorePhoto(poor, COVER, wanted));
  });

  it("survives a candidate with no dimensions rather than dividing by zero", () => {
    const broken = photo({ providerAssetId: "broken", width: 0, height: 0 });
    expect(Number.isFinite(scorePhoto(broken, COVER, new Set()))).toBe(true);
  });
});
