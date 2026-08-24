import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/ui/theme-provider";

function Harness() {
  const { pref, resolved, setPref } = useTheme();
  return (
    <div>
      <span data-testid="pref">{pref}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPref("system")}>system</button>
      <button onClick={() => setPref("light")}>light</button>
    </div>
  );
}

function mockMatchMedia(prefersDark: boolean) {
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes("dark") ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof matchMedia;
}

describe("theme default policy", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("resolves dark on first visit even when the OS prefers light", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("resolves dark on first visit even when the OS prefers dark (same outcome, different reason)", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("an explicit System preference still follows the OS", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    act(() => screen.getByRole("button", { name: "system" }).click());
    expect(screen.getByTestId("resolved").textContent).toBe("light");

    mockMatchMedia(true);
    act(() => window.dispatchEvent(new Event("storage")));
    // resolved is recomputed from matchMedia on the next snapshot read; the
    // component re-renders because the store's subscribe callback fires on
    // matchMedia's own change event in real browsers. Here we simulate the
    // externally-observed effect via the same "storage" signal the provider
    // already listens to for cross-tab preference sync.
  });

  it("an explicit Light/Dark preference is unaffected", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    act(() => screen.getByRole("button", { name: "light" }).click());
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });
});
