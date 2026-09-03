import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProposedMap } from "@/lib/ai/schemas";

const requestMap = vi.fn();
const requestPresentationFromMap = vi.fn();

vi.mock("@/lib/data/actions", () => ({ createPresentation: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({
  NETWORK_ERROR: "Couldn't reach the server. Your work is unaffected.",
  requestMap: (...args: unknown[]) => requestMap(...args),
  requestPresentationFromMap: (...args: unknown[]) => requestPresentationFromMap(...args),
  aiConfigured: vi.fn(async () => false),
  aiAvailability: vi.fn(async () => ({
    configured: false,
    stockSearch: false,
    imageGeneration: false,
  })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { CreateFlow } = await import("@/components/dashboard/create-flow");
const { ToastProvider } = await import("@/components/ui/toast");

const MAP: ProposedMap = {
  title: "Peptides at the frontier",
  approach: "",
  suggestedThemeId: "midnight",
  movements: [
    {
      label: "Open",
      title: "Why peptides",
      purpose: "Ground the audience in the problem peptides address.",
      weight: 1,
      moments: [
        {
          title: "Antimicrobial peptides against resistant bacteria",
          role: "example",
          purpose: "Show a high-stakes unmet need.",
          takeaway: "Peptides may offer a genuinely different mechanism.",
          visualIntent: "auto",
          weight: 1,
          evidenceIds: [],
        },
      ],
    },
    {
      label: "Close",
      title: "Where this goes",
      purpose: "Leave the audience with a way to evaluate new claims.",
      weight: 1,
      moments: [
        {
          title: "Reading an early peptide trial like a clinician",
          role: "demonstration",
          purpose: "Give a practical framework.",
          takeaway: "I have a checklist now.",
          visualIntent: "auto",
          weight: 1,
          evidenceIds: [],
        },
      ],
    },
  ],
};

/**
 * `create-from-map` creates the presentation, its movements and its moments
 * before it starts writing scenes — so a network-level failure on a slow
 * full-depth deck can leave a real, unfinished presentation behind that the
 * generic "Couldn't reach the server" toast never mentions. A retry from this
 * screen would then generate a second one from the same map.
 */
describe("a network failure while generating scenes names the recovery path", () => {
  it("points at the dashboard by the map's title instead of implying nothing happened", async () => {
    const user = userEvent.setup();
    requestMap.mockResolvedValue({
      ok: true,
      proposal: MAP,
      available: [],
      source: "model",
    });
    requestPresentationFromMap.mockResolvedValue({
      ok: false,
      error: "Couldn't reach the server. Your work is unaffected.",
    });

    render(
      <ToastProvider>
        <CreateFlow initialMode="ai" folders={[]} folderId={null} />
      </ToastProvider>,
    );

    await user.type(
      screen.getByLabelText(/what is this presentation about/i),
      "A talk on peptide therapeutics",
    );
    await user.click(screen.getByRole("button", { name: /plan the argument/i }));

    await screen.findByText(MAP.title);

    await user.click(screen.getByRole("button", { name: /generate \d+ scenes/i }));

    await screen.findByText(/generation failed/i);
    const description = await screen.findByText(
      (_, element) => Boolean(element?.textContent?.includes("dashboard")),
      { selector: "p" },
    );
    expect(description.textContent).toContain(MAP.title);
    expect(description.textContent).not.toBe("Couldn't reach the server. Your work is unaffected.");
  });
});
