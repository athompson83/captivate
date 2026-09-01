import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/data/actions", () => ({ createPresentation: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({
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
 * Switching between the two creation paths used to unmount the one being left,
 * which threw away everything typed into it — on the AI side that included a
 * narrative map that had cost a model call and a round of editing.
 */
describe("create flow keeps a draft across a mode switch", () => {
  it("still has the title after going to AI and back", async () => {
    const user = userEvent.setup();
    render(
      <CreateFlow
        initialMode="template"
        initialTemplateId="lecture"
        folders={[]}
        folderId={null}
      />,
    );

    const title = screen.getByLabelText(/title/i);
    await user.type(title, "Sepsis for paramedics");
    expect((title as HTMLInputElement).value).toBe("Sepsis for paramedics");

    await user.click(screen.getByRole("radio", { name: /with ai/i }));
    await user.click(screen.getByRole("radio", { name: /from a template/i }));

    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe(
      "Sepsis for paramedics",
    );
  });

  it("still has the brief after going to the template path and back", async () => {
    const user = userEvent.setup();
    render(<CreateFlow initialMode="ai" folders={[]} folderId={null} />);

    const brief = screen.getByLabelText(/what is this presentation about/i);
    await user.type(brief, "A 50-minute lecture on sepsis");

    await user.click(screen.getByRole("radio", { name: /from a template/i }));
    await user.click(screen.getByRole("radio", { name: /with ai/i }));

    expect(
      (screen.getByLabelText(/what is this presentation about/i) as HTMLTextAreaElement).value,
    ).toBe("A 50-minute lecture on sepsis");
  });
});
