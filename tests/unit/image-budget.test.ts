import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client side of the image budget.
 *
 * The gate itself is in Postgres and is tested against real Postgres, where
 * its concurrency and its ceilings can actually be exercised. What these pin
 * is the part that is easy to get wrong in TypeScript: that the provider is
 * never called without a ticket, and that the two refusals stay
 * distinguishable — "the deployment is out of budget" and "you have used your
 * day's allowance" are different situations for the person reading them, and
 * only one is their own doing.
 */

const OK_IMAGE = { data: [{ b64_json: "aGVsbG8=" }] };

function mockDb(reserve: { id: string | null; refusal: string | null }) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    void name;
    void args;
    return { data: [reserve], error: null };
  });
  vi.doMock("@/lib/supabase/server", () => ({
    supabaseServer: vi.fn(async () => ({ rpc })),
  }));
  return rpc;
}

describe("generateImage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-a-real-one");
  });

  it("says so plainly when no key is configured, without touching the database", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const rpc = mockDb({ id: null, refusal: null });
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("isn't configured");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never calls the provider when the budget is exhausted", async () => {
    mockDb({ id: null, refusal: "budget" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("budget for the month");
      // Search and upload are unaffected, and the message says so, because a
      // budget problem must not read as "images are broken".
      expect(result.error).toContain("Search and upload still work");
    }
    expect(fetchSpy, "a refusal must cost nothing").not.toHaveBeenCalled();
  });

  it("distinguishes a personal daily cap from the shared budget", async () => {
    mockDb({ id: null, refusal: "daily" });
    vi.stubGlobal("fetch", vi.fn());
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("today");
  });

  it("fails closed when the reservation itself errors", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      supabaseServer: vi.fn(async () => ({
        rpc: vi.fn(async () => ({ data: null, error: { message: "down" } })),
      })),
    }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Nothing was spent");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("generates and settles when a ticket is issued", async () => {
    const rpc = mockDb({ id: "aaaaaaaa-0000-4000-8000-000000000001", refusal: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => OK_IMAGE }) as unknown as Response),
    );
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse at dusk");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.previewDataUrl.startsWith("data:image/png;base64,")).toBe(true);

    const settled = rpc.mock.calls.find(([name]) => name === "captivate_settle_image_generation");
    expect(settled, "a spent ticket must be reconciled").toBeTruthy();
    expect(settled?.[1].p_status).toBe("succeeded");
  });

  it("still charges for a failed provider call", async () => {
    // Otherwise an outage looks like free capacity and retries burn the month.
    const rpc = mockDb({ id: "aaaaaaaa-0000-4000-8000-000000000001", refusal: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response),
    );
    const { generateImage, IMAGE_COST_ESTIMATE_USD } = await import("@/lib/ai/visual-sourcing");

    expect((await generateImage("a lighthouse")).ok).toBe(false);
    const settled = rpc.mock.calls.find(([name]) => name === "captivate_settle_image_generation");
    expect(settled?.[1].p_status).toBe("failed");
    expect(settled?.[1].p_cost_usd).toBe(IMAGE_COST_ESTIMATE_USD);
  });
});
