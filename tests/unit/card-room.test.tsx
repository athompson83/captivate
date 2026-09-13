import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PresentationSummary } from "@/lib/data/presentations";
import { JOURNEY_DEFAULTS, SceneContent } from "@/lib/schema/presentation";
import { composeScene } from "@/lib/editor/layouts";

// The card calls into "use server" modules and the App Router; mocked as in
// card-reduced-motion so it renders under jsdom.
vi.mock("@/lib/data/actions", () => ({
  deletePresentation: vi.fn(),
  duplicatePresentation: vi.fn(),
  updatePresentation: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { PresentationCard } = await import("@/components/dashboard/presentation-card");

const ROOM = "/api/assets/0f3c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6/content";

const deck = (url: string): PresentationSummary => ({
  id: "00000000-0000-4000-8000-000000000001",
  ownerId: "00000000-0000-4000-8000-000000000099",
  folderId: null,
  title: "Shock",
  description: "",
  themeId: "midnight",
  themeOverrides: null,
  aspectRatio: "16:9",
  journey: { ...JOURNEY_DEFAULTS, backdrop: { ...JOURNEY_DEFAULTS.backdrop, url, dim: 0.4 } },
  targetSeconds: 0,
  tags: [],
  isFavorite: false,
  thumbnailUrl: null,
  schemaVersion: 1,
  shareToken: null,
  generationStatus: "ready",
  generation: "ready",
  generationStartedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastOpenedAt: null,
  sceneCount: 3,
  folderName: null,
});

/** jsdom measures nothing, so the fill thumbnail is given a width by hand. */
function measured() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { ...original.call(this), width: 320, height: 180 } as DOMRect;
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
    vi.unstubAllGlobals();
  };
}

describe("the deck card", () => {
  it("shows the first scene standing in the deck's room", () => {
    const restore = measured();
    try {
      const preview: SceneContent = composeScene("bullets", {
        heading: "Shock",
        bullets: ["First"],
      });
      const { container } = render(
        <PresentationCard presentation={deck(ROOM)} preview={preview} />,
      );
      const picture = container.querySelector<HTMLImageElement>("img[data-room]");
      expect(picture).not.toBeNull();
      expect(picture!.getAttribute("src")).toBe(ROOM);
      expect(container.querySelector<HTMLElement>("[data-room-veil]")!.style.opacity).toBe("0.4");
    } finally {
      restore();
    }
  });

  it("stands on the canvas when the deck has no room", () => {
    const restore = measured();
    try {
      const preview: SceneContent = composeScene("bullets", {
        heading: "Shock",
        bullets: ["First"],
      });
      const { container } = render(<PresentationCard presentation={deck("")} preview={preview} />);
      expect(container.querySelector("img[data-room]")).toBeNull();
    } finally {
      restore();
    }
  });
});
