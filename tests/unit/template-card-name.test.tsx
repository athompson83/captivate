import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/data/actions", () => ({ createPresentation: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({
  NETWORK_ERROR: "Couldn't reach the server. Your work is unaffected.",
  requestMap: vi.fn(),
  requestPresentationFromMap: vi.fn(),
  aiConfigured: vi.fn(async () => false),
  aiAvailability: vi.fn(async () => ({
    configured: false,
    stockSearch: false,
    imageGeneration: false,
  })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { CreateFlow } = await import("@/components/dashboard/create-flow");

/**
 * The whole template card is the button, so its accessible name is everything
 * on it — and the clear stage now carries an eyebrow *before* its name. A
 * journey that looked for a button whose name began "Blank" waited a minute
 * for one that no longer exists. Whatever the card says around the name, the
 * name itself must stay the one exact string that identifies the card.
 */
describe("a template card's name", () => {
  it("has the eyebrow before the name, and the name still identifies the card", () => {
    render(<CreateFlow initialMode="template" folders={[]} folderId={null} />);
    const blank = screen.getByText("Blank", { selector: "span" }).closest("button");
    expect(blank).not.toBeNull();
    const name = blank!.textContent ?? "";
    expect(name.startsWith("A clear stage")).toBe(true);
    expect(name.startsWith("Blank")).toBe(false);
    // The exact visible name, on its own, is on exactly one card.
    expect(screen.getAllByText("Blank", { exact: true })).toHaveLength(1);

    const example = screen.getByText("Hold the room", { selector: "span" }).closest("button");
    expect(example!.textContent?.startsWith("A finished talk")).toBe(true);
  });
});
