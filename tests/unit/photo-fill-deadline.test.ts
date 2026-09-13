import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A stock fill that respects the caller's deadline.
 *
 * Codex, reviewing the found room: the search has a twelve-second timeout
 * and the download a twenty-second one, and a fill started with little of
 * the route's ceiling left could outlive it and leave a written deck marked
 * as generating. The deadline is checked before the search and again after
 * it, so nothing is stored past it.
 */

const photo = {
  thumbnailUrl: "https://images.example/t.jpg",
  fullUrl: "https://images.example/f.jpg",
  providerAssetId: "1",
  originalPageUrl: "https://example/p",
  creatorName: "A",
  creatorPageUrl: "https://example/a",
  licenseRef: "Pexels License",
  altText: "a corridor",
  width: 1600,
  height: 900,
};

const searchStockPhotos = vi.fn();
const saveStockPhoto = vi.fn();

vi.mock("@/lib/ai/visual-sourcing", () => ({
  isStockSearchConfigured: () => true,
  isImageGenerationConfigured: () => false,
  searchStockPhotos: (...args: unknown[]) => searchStockPhotos(...args),
  generateImage: vi.fn(),
}));
vi.mock("@/lib/data/sourced-assets", () => ({
  saveStockPhoto: (...args: unknown[]) => saveStockPhoto(...args),
  registerGeneratedImage: vi.fn(),
}));
vi.mock("@/lib/data/sourced-store", () => ({ storeGeneratedImage: vi.fn() }));

import { fillWithStockPhoto } from "@/lib/ai/photo-fill";

describe("a stock fill with a deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T00:00:00Z"));
    searchStockPhotos.mockReset();
    saveStockPhoto.mockReset();
    searchStockPhotos.mockResolvedValue({ ok: true, data: [photo] });
    saveStockPhoto.mockResolvedValue({ ok: true, data: { id: "asset", url: "/api/assets/asset" } });
  });
  afterEach(() => vi.useRealTimers());

  it("fills as before while the deadline is ahead", async () => {
    const found = await fillWithStockPhoto("hospital corridor", "", null, {
      slotAspect: 16 / 9,
      deadline: Date.now() + 60_000,
    });
    expect(found).toEqual({ url: "/api/assets/asset", assetId: "asset", alt: "a corridor" });
    expect(saveStockPhoto).toHaveBeenCalledTimes(1);
  });

  it("does not even search once the deadline has passed", async () => {
    const found = await fillWithStockPhoto("hospital corridor", "", null, {
      slotAspect: 16 / 9,
      deadline: Date.now() - 1,
    });
    expect(found).toBeNull();
    expect(searchStockPhotos).not.toHaveBeenCalled();
    expect(saveStockPhoto).not.toHaveBeenCalled();
  });

  it("stores nothing when the deadline passes during the search", async () => {
    const deadline = Date.now() + 5_000;
    searchStockPhotos.mockImplementation(async () => {
      vi.setSystemTime(deadline + 1);
      return { ok: true, data: [photo] };
    });
    const found = await fillWithStockPhoto("hospital corridor", "", null, {
      slotAspect: 16 / 9,
      deadline,
    });
    expect(found).toBeNull();
    expect(searchStockPhotos).toHaveBeenCalledTimes(1);
    expect(saveStockPhoto).not.toHaveBeenCalled();
  });

  it("is unchanged for a caller with no deadline", async () => {
    const found = await fillWithStockPhoto("hospital corridor", "", null);
    expect(found?.assetId).toBe("asset");
  });
});
