import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * jsdom lacks a few browser APIs the app relies on. Stubbing them here keeps
 * the tests honest about what is being exercised: these are environment shims,
 * not behaviour under test.
 */

if (!globalThis.crypto?.randomUUID) {
  let counter = 0;
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...globalThis.crypto,
      randomUUID: () => {
        counter += 1;
        return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
      },
    },
    configurable: true,
  });
}

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as unknown as typeof matchMedia;
