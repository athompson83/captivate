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

/**
 * A real 1x1 PNG, and it has to be real.
 *
 * This was `aGVsbG8=` — base64 for "hello" — which the old success path
 * happily wrapped in a `data:image/png` URL and called a generated image. The
 * generation now sniffs the bytes before it claims success, so a fixture that
 * is not a picture fails here the same way a provider returning SVG would.
 */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const OK_IMAGE = { data: [{ b64_json: PNG_1X1 }] };

function mockDb(
  reserve: { id: string | null; refusal: string | null; daily_max?: number | null },
  plan = "pro",
) {
  // Answering by name, because the plan gate in front of image generation asks
  // the same client which plan the caller is on. A mock that returned the
  // reservation row to every question made every caller free, and free is the
  // one plan that cannot generate images at all — so every budget assertion
  // below was really testing the plan gate.
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    void args;
    if (name === "captivate_current_plan") return { data: plan, error: null };
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
    mockDb({ id: null, refusal: "daily", daily_max: 25 });
    vi.stubGlobal("fetch", vi.fn());
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse");
    expect(result.ok).toBe(false);
    // The ceiling now travels back with the refusal instead of being read from
    // configuration here, so the message has to name the number that actually
    // refused — asserting only on "today" passed just as happily on
    // "You've generated undefined images today".
    if (!result.ok) expect(result.error).toContain("generated 25 images today");
  });

  it("says something a person can read when the refusal carries no number", async () => {
    // An older database, or a refusal raised before the ceilings were read.
    mockDb({ id: null, refusal: "daily" });
    vi.stubGlobal("fetch", vi.fn());
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("daily limit");
      expect(result.error).not.toContain("undefined");
      expect(result.error).not.toContain("null");
    }
  });

  it("says so when the old ceiling variables are still set", async () => {
    // The ceilings moved into the database and the migration seeds the
    // documented defaults. A deployment that had set a *lower* budget on
    // purpose would otherwise be raised to that default with nothing said, so
    // the one thing this must not be is silent.
    vi.stubEnv("CAPTIVATE_IMAGE_BUDGET_USD", "20");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    mockDb({ id: null, refusal: "budget", daily_max: 25 });
    vi.stubGlobal("fetch", vi.fn());
    const { __resetSamplingForTests } = await import("@/lib/observability");
    __resetSamplingForTests();
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    await generateImage("a lighthouse");

    const moved = errors.find((line) => line.includes("ai.image.ceilings-moved"));
    expect(moved, `logged lines: ${JSON.stringify(errors)}`).toBeDefined();
    expect(moved).toContain("ai_image_limits");
  });

  it("stays quiet when they are not", async () => {
    vi.stubEnv("CAPTIVATE_IMAGE_BUDGET_USD", "");
    vi.stubEnv("CAPTIVATE_IMAGE_DAILY_MAX", "");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    mockDb({ id: null, refusal: "budget", daily_max: 25 });
    vi.stubGlobal("fetch", vi.fn());
    const { __resetSamplingForTests } = await import("@/lib/observability");
    __resetSamplingForTests();
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    await generateImage("a lighthouse");

    expect(errors.filter((line) => line.includes("ai.image.ceilings-moved"))).toEqual([]);
  });

  it("fails closed when the reservation itself errors", async () => {
    // The plan still resolves — this is about the *reservation* failing, not
    // about being refused the feature.
    vi.doMock("@/lib/supabase/server", () => ({
      supabaseServer: vi.fn(async () => ({
        rpc: vi.fn(async (name: string) =>
          name === "captivate_current_plan"
            ? { data: "pro", error: null }
            : { data: null, error: { message: "down" } },
        ),
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

  it("refuses a format it cannot store, and says so rather than showing a broken preview", async () => {
    // OpenRouter fronts vector models that answer with `image/svg+xml`. The
    // first version of this path trusted the provider's declared type and
    // mapped anything unrecognised to PNG, on the reasoning that the accept
    // path sniffs the bytes properly. It does — but by then the generation is
    // paid for, so the author saw a broken picture, then "that file isn't an
    // image" when they tried to keep it, with the money already gone.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
    const rpc = mockDb({ id: "aaaaaaaa-0000-4000-8000-000000000001", refusal: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ data: [{ b64_json: svg, media_type: "image/svg+xml" }] }),
          }) as unknown as Response,
      ),
    );
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    const result = await generateImage("a lighthouse at dusk");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/format Captivate can't store/i);

    // Still settled, and settled as what it was. The provider did the work and
    // billed for it, so an unreconciled ticket would read as free capacity.
    const settled = rpc.mock.calls.find(([name]) => name === "captivate_settle_image_generation");
    expect(settled, "a spent ticket must be reconciled even when unusable").toBeTruthy();
    expect((settled?.[1] as { p_status: string }).p_status).toBe("invalid_output");
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
    if (result.ok)
      expect(result.data.previewDataUrl.startsWith("data:image/png;base64,")).toBe(true);

    const settled = rpc.mock.calls.find(([name]) => name === "captivate_settle_image_generation");
    expect(settled, "a spent ticket must be reconciled").toBeTruthy();
    expect(settled?.[1].p_status).toBe("succeeded");
    // The row names who was paid, not only what was asked for: the first
    // production generation settled as `gpt-image-2` and could not say
    // whether that was OpenAI or OpenRouter under a model override.
    expect(settled?.[1].p_provider).toBe("openai");
  });

  it("still charges for a failed provider call", async () => {
    // Otherwise an outage looks like free capacity and retries burn the month.
    const rpc = mockDb({ id: "aaaaaaaa-0000-4000-8000-000000000001", refusal: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response,
      ),
    );
    const { generateImage } = await import("@/lib/ai/visual-sourcing");

    expect((await generateImage("a lighthouse")).ok).toBe(false);

    // The price is set once, by the reservation — and it is not sent. Naming it
    // on the wire is what let one request write a `cost_usd` of its choosing
    // into a sum that is shared by every user of the deployment, so the
    // reservation now reads its own ceilings and takes only what the caller is
    // entitled to decide.
    const reserved = rpc.mock.calls.find(([name]) => name === "captivate_reserve_image_generation");
    expect(Object.keys(reserved?.[1] ?? {}).sort()).toEqual(["p_presentation_id", "p_prompt"]);

    const settled = rpc.mock.calls.find(([name]) => name === "captivate_settle_image_generation");
    expect(settled?.[1].p_status).toBe("failed");
    // Settling carried a price while running under the caller's own JWT, which
    // meant a browser could settle its own reservation at zero and free the
    // deployment's shared monthly budget. The parameter is gone, not ignored.
    expect(settled?.[1]).not.toHaveProperty("p_cost_usd");
  });
});
