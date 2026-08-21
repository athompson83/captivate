import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useDebouncedSave } from "@/lib/data/use-debounced-save";

/**
 * The notes surfaces depend on this for durability, and it has a history of
 * subtle data loss: an earlier version kept one pending slot, so editing a
 * title and then a body within one debounce window silently dropped the title.
 */

interface Payload {
  id: string;
  title?: string;
  body?: string;
}

const calls: Payload[] = [];
let resolveNext: ((value: { ok: boolean; error?: string }) => void) | null = null;

function Harness({
  onReady,
  failing = false,
  manual = false,
}: {
  onReady: (api: ReturnType<typeof useDebouncedSave<Payload>>) => void;
  failing?: boolean;
  manual?: boolean;
}) {
  const api = useDebouncedSave<Payload>(async (payload) => {
    calls.push(payload);
    if (manual) {
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    }
    return failing ? { ok: false, error: "nope" } : { ok: true };
  }, 200);

  onReady(api);
  return <span data-testid="status">{api.status}</span>;
}

let api: ReturnType<typeof useDebouncedSave<Payload>>;

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  resolveNext = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedSave", () => {
  it("debounces a burst of edits into one call", async () => {
    render(<Harness onReady={(a) => (api = a)} />);

    act(() => {
      api.schedule({ id: "n1", body: "a" });
      api.schedule({ id: "n1", body: "ab" });
      api.schedule({ id: "n1", body: "abc" });
    });
    expect(calls).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ id: "n1", body: "abc" });
  });

  it("merges different fields of the same record", async () => {
    render(<Harness onReady={(a) => (api = a)} />);

    act(() => {
      api.schedule({ id: "n1", title: "A title" });
      api.schedule({ id: "n1", body: "A body" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // The regression this exists for: the title must not be lost.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ id: "n1", title: "A title", body: "A body" });
  });

  it("keeps edits to different records separate", async () => {
    render(<Harness onReady={(a) => (api = a)} />);

    act(() => {
      api.schedule({ id: "n1", body: "one" });
      api.schedule({ id: "n2", body: "two" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.id).sort()).toEqual(["n1", "n2"]);
  });

  it("reports saved on success and error on failure", async () => {
    const { unmount } = render(<Harness onReady={(a) => (api = a)} />);

    act(() => api.schedule({ id: "n1", body: "x" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
    unmount();

    calls.length = 0;
    render(<Harness failing onReady={(a) => (api = a)} />);
    act(() => api.schedule({ id: "n1", body: "y" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(screen.getByTestId("status")).toHaveTextContent("error");
  });

  it("flushes immediately when asked", async () => {
    render(<Harness onReady={(a) => (api = a)} />);

    act(() => api.schedule({ id: "n1", body: "now" }));
    await act(async () => {
      api.flush();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
  });

  it("does not start a second save while one is in flight", async () => {
    render(<Harness manual onReady={(a) => (api = a)} />);

    act(() => api.schedule({ id: "n1", body: "first" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toHaveLength(1);

    // A new edit while the first request is still open must queue, not race.
    act(() => api.schedule({ id: "n1", body: "second" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      resolveNext?.({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ id: "n1", body: "second" });
  });

  it("sends a pending write when the component unmounts", async () => {
    const { unmount } = render(<Harness onReady={(a) => (api = a)} />);

    act(() => api.schedule({ id: "n1", body: "unmounted" }));
    expect(calls).toHaveLength(0);

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toBe("unmounted");
  });

  it("sends a pending write when the tab is hidden", async () => {
    render(<Harness onReady={(a) => (api = a)} />);

    act(() => api.schedule({ id: "n1", body: "hidden" }));

    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });
});
