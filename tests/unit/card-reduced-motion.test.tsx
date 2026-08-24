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

const { PresentationCard } = await import("@/components/dashboard/presentation-card");

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
