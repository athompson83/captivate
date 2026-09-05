import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { fullscreenElement, requestFullscreen, useFullscreen } from "@/lib/present/fullscreen";

/**
 * Fullscreen by either name. Safari on iPad still exposes only the `webkit`
 * names; a hook that read the standard ones alone reported a fullscreen deck
 * as windowed and never asked for one.
 */

type Mutable = Record<string, unknown>;
const doc = document as unknown as Mutable;
const proto = HTMLElement.prototype as unknown as Mutable;
const saved: Array<() => void> = [];

function define(target: Mutable, key: string, value: unknown) {
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const before = had ? Object.getOwnPropertyDescriptor(target, key) : undefined;
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  saved.push(() => {
    if (before) Object.defineProperty(target, key, before);
    else delete target[key];
  });
}

afterEach(() => {
  while (saved.length) saved.pop()?.();
});

describe("fullscreen by either name", () => {
  it("finds the fullscreen element under the prefixed name", () => {
    const stage = document.createElement("div");
    define(doc, "fullscreenElement", undefined);
    define(doc, "webkitFullscreenElement", stage);
    expect(fullscreenElement()).toBe(stage);
  });

  it("asks by the prefixed name when the standard one is missing, and refuses when neither exists", async () => {
    const stage = document.createElement("div");
    define(proto, "requestFullscreen", undefined);
    const webkit = vi.fn(() => Promise.resolve());
    define(proto, "webkitRequestFullscreen", webkit);
    await requestFullscreen(stage);
    expect(webkit).toHaveBeenCalledTimes(1);

    define(proto, "webkitRequestFullscreen", undefined);
    await expect(requestFullscreen(stage)).rejects.toThrow();
  });
});

function Probe() {
  const fullscreen = useFullscreen();
  return (
    <div>
      <span data-testid="state">
        {fullscreen.supported ? "supported" : "unsupported"}/{fullscreen.active ? "active" : "idle"}
        /{fullscreen.denied ? "denied" : "ok"}
      </span>
      <button onClick={() => void fullscreen.toggle()}>toggle</button>
    </div>
  );
}

describe("useFullscreen", () => {
  it("reads support from the prefixed flag when the standard one says no", () => {
    define(doc, "fullscreenEnabled", false);
    define(doc, "webkitFullscreenEnabled", true);
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("supported/idle/ok");
  });

  it("is unsupported on a phone that has neither", () => {
    define(doc, "fullscreenEnabled", false);
    define(doc, "webkitFullscreenEnabled", false);
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("unsupported");
  });

  it("follows a prefixed change event, and says so when refused", async () => {
    define(doc, "fullscreenEnabled", true);
    const stage = document.createElement("div");
    define(doc, "fullscreenElement", undefined);
    define(doc, "webkitFullscreenElement", null);
    define(
      proto,
      "requestFullscreen",
      vi.fn(() => Promise.reject(new Error("no"))),
    );

    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("supported/idle/ok");

    await act(async () => {
      fireEvent.click(screen.getByText("toggle"));
    });
    expect(screen.getByTestId("state")).toHaveTextContent("denied");

    define(doc, "webkitFullscreenElement", stage);
    act(() => {
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    });
    expect(screen.getByTestId("state")).toHaveTextContent("active");
  });
});
