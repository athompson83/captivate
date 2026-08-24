import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PresentationSummary } from "@/lib/data/presentations";
import { JOURNEY_DEFAULTS } from "@/lib/schema/presentation";

// presentation-card.tsx calls into "@/lib/data/actions", a "use server" file
// that imports the Supabase server client (and therefore `server-only`) —
// mock it so the component can render under jsdom without a server runtime.
vi.mock("@/lib/data/actions", () => ({
  deletePresentation: vi.fn(),
  duplicatePresentation: vi.fn(),
  updatePresentation: vi.fn(),
}));

// useRouter() throws outside an App Router tree; the component only needs
// router.refresh() for actions this test never triggers.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// asset-library.tsx calls "@/lib/data/assets" directly (deleteAsset,
// updateAssetAlt) and transitively via "@/lib/data/upload" (registerAsset) —
// all three live in a "use server" file, so mock the whole module.
vi.mock("@/lib/data/assets", () => ({
  deleteAsset: vi.fn(),
  updateAssetAlt: vi.fn(),
  registerAsset: vi.fn(),
}));

const { PresentationCard } = await import("@/components/dashboard/presentation-card");
const { AssetLibrary } = await import("@/components/dashboard/asset-library");

const PRESENTATION: PresentationSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  ownerId: "00000000-0000-4000-8000-000000000099",
  folderId: null,
  title: "Test deck",
  description: "",
  themeId: "midnight",
  themeOverrides: null,
  aspectRatio: "16:9",
  journey: JOURNEY_DEFAULTS,
  targetSeconds: 0,
  tags: [],
  isFavorite: false,
  thumbnailUrl: null,
  schemaVersion: 1,
  shareToken: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastOpenedAt: null,
  sceneCount: 3,
  folderName: null,
};

describe("PresentationCard reduced-motion", () => {
  it("guards the hover transform/shadow transition with motion-reduce:", () => {
    const { container } = render(<PresentationCard presentation={PRESENTATION} preview={null} />);
    const card = container.querySelector<HTMLElement>(".group");
    expect(card).not.toBeNull();
    expect(card!.className).toMatch(/motion-reduce:(transition-none|transform-none)/);
  });
});

// asset-library.tsx's `Asset` interface is file-local (not exported) —
// this fixture duck-types the same shape rather than importing a type.
const ASSET = {
  id: "00000000-0000-4000-8000-000000000002",
  kind: "image" as const,
  mimeType: "image/png",
  byteSize: 12_345,
  width: 800,
  height: 600,
  alt: "A test asset",
  filename: "test.png",
  createdAt: new Date().toISOString(),
  source: "upload" as const,
  creatorName: null,
  creatorPageUrl: null,
  originalPageUrl: null,
  licenseRef: null,
  provider: null,
  model: null,
  prompt: null,
  presentationTitle: null,
  url: "/api/assets/00000000-0000-4000-8000-000000000002/content",
};

describe("AssetLibrary card reduced-motion and shadow parity", () => {
  it("guards its hover transition and includes a hover shadow", () => {
    const { container } = render(<AssetLibrary assets={[ASSET]} />);
    const cards = container.querySelectorAll<HTMLElement>(".group");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.className).toMatch(/motion-reduce:(transition-none|transform-none)/);
      expect(card.className).toMatch(/hover:shadow-/);
    }
  });
});
