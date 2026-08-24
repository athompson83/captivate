import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reservation is what actually bounds AI spend, so these pin the
 * behaviour a wrong answer would be expensive for.
 *
 * The old limiter counted `ai_generations` rows and let the request through;
 * the row was written after the model answered. Everything in between — the
 * whole call — was a window the count did not move in. The database side of
 * the fix is covered by the RLS suite and its concurrency probe; this covers
 * the client side, where the mistake to avoid is failing *open*: a caller who
 * cannot get a ticket must not be allowed to spend anyway.
 */

function mockRpc(impl: (name: string, args: Record<string, unknown>) => unknown) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    try {
      return { data: impl(name, args), error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  });
  vi.doMock("@/lib/supabase/server", () => ({
    supabaseServer: vi.fn(async () => ({ rpc })),
  }));
  return rpc;
}

const LIMIT = { windowMinutes: 60, max: 30 };
const TICKET = "aaaaaaaa-0000-4000-8000-000000000001";

describe("AI call reservation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("hands back the ticket the database issued", async () => {
    const rpc = mockRpc(() => TICKET);
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("visuals", ["visuals"], "a prompt", null, LIMIT);
    expect(outcome).toEqual({ ok: true, reservation: { id: TICKET } });
    expect(rpc).toHaveBeenCalledWith(
      "captivate_reserve_generation",
      expect.objectContaining({
        p_kind: "visuals",
        p_count_kinds: ["visuals"],
        p_window_minutes: 60,
        p_max: 30,
      }),
    );
  });

  it("refuses when the database declines to issue one", async () => {
    // Null is how the function says "this would exceed the limit" — and it
    // says it without writing a row, so nothing has been spent.
    mockRpc(() => null);
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("visuals", ["visuals"], "a prompt", null, LIMIT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("30 AI generations");
      expect(outcome.retryAfterMinutes).toBe(60);
    }
  });

  it("fails closed when the reservation itself errors", async () => {
    // The pre-filter may fail open — being wrong there only means a request
    // is not rejected early. Here there would be nothing counting the call.
    mockRpc(() => {
      throw new Error("connection reset");
    });
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("map", ["map"], "p", null, LIMIT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Nothing was spent");
  });

  it("truncates an oversized prompt rather than sending it whole", async () => {
    const rpc = mockRpc(() => TICKET);
    const { reserve } = await import("@/lib/ai/rate-limit");

    await reserve("map", ["map"], "x".repeat(9000), null, LIMIT);
    const sent = rpc.mock.calls[0][1] as { p_prompt: string };
    expect(sent.p_prompt).toHaveLength(4000);
  });

  it("records the outcome against the ticket", async () => {
    const rpc = mockRpc(() => true);
    const { complete } = await import("@/lib/ai/rate-limit");

    await complete(
      { id: TICKET },
      { status: "succeeded", model: "test", usage: { input: 12, output: 34 } },
    );
    expect(rpc).toHaveBeenCalledWith("captivate_complete_generation", {
      p_id: TICKET,
      p_status: "succeeded",
      p_model: "test",
      p_input_tokens: 12,
      p_output_tokens: 34,
      p_error: null,
    });
  });

  it("swallows a failure to record, because the ticket already counts", async () => {
    mockRpc(() => {
      throw new Error("gone");
    });
    const { complete } = await import("@/lib/ai/rate-limit");

    await expect(
      complete({ id: TICKET }, { status: "failed", error: "boom" }),
    ).resolves.toBeUndefined();
  });
});

describe("a refused reservation never reaches the model", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-a-real-one");
  });

  it("returns the refusal without calling the provider", async () => {
    mockRpc((name) => (name === "captivate_reserve_generation" ? null : true));
    const generateStructured = vi.fn();
    vi.doMock("@/lib/ai/provider", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
      generateStructured,
      isAiConfigured: () => true,
    }));

    const { suggestVisuals } = await import("@/lib/ai/service");
    const result = await suggestVisuals({ title: "T", text: "body" }, {}, null);

    expect(result.ok).toBe(false);
    // The point of reserving rather than recording: the spend never happened.
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
