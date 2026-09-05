import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import PresentLoading from "@/app/present/[id]/loading";
import SharedLoading from "@/app/v/[token]/loading";

/**
 * Both audience routes await their deck on the server. Without a loading
 * frame the window showed the site's light body first — a white flash on a
 * projector, and the only white thing a reader of a share link would see.
 */
describe("the frame before the stage", () => {
  it.each([
    ["the stage", PresentLoading],
    ["a shared deck", SharedLoading],
  ])("is black and full-screen for %s", (_, Loading) => {
    const { container } = render(<Loading />);
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain("bg-black");
    expect(frame.className).toContain("h-screen");
    expect(frame).toHaveAttribute("aria-busy", "true");
  });
});
