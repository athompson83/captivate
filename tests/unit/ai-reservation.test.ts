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

const TICKET = "aaaaaaaa-0000-4000-8000-000000000001";

/** What the function returns: one row, whether it issued a ticket or refused. */
const issued = () => [{ id: TICKET, refusal: null, limit_max: 25, limit_minutes: 43_200 }];
const refused = (refusal: string, limit_max: number, limit_minutes: number) => [
  { id: null, refusal, limit_max, limit_minutes },
];

describe("AI call reservation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("hands back the ticket the database issued", async () => {
    const rpc = mockRpc(issued);
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("visuals", "light", "a prompt", null);
    expect(outcome).toEqual({ ok: true, reservation: { id: TICKET } });
    // The caller names the work and the budget, and nothing else. A window and
    // a ceiling used to travel in this payload, which meant a browser issuing
    // the same RPC could choose its own — so their absence is the fix, and it
    // is asserted rather than assumed.
    expect(rpc).toHaveBeenCalledWith("captivate_reserve_generation", {
      p_kind: "visuals",
      p_group: "light",
      p_prompt: "a prompt",
      p_presentation_id: null,
    });
    const sent = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(sent)).not.toContain("p_max");
    expect(Object.keys(sent)).not.toContain("p_window_minutes");
  });

  it("names the ceiling that refused it, and its window", async () => {
    // Two ceilings, and they mean different things to an author: wait an hour,
    // or wait out the month. A refusal that says "you have reached the limit"
    // does not even say which.
    mockRpc(() => refused("burst", 5, 60));
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("scenes", "deck", "p", null);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("5 AI generations");
      expect(outcome.error).toContain("the last 1 hour");
      expect(outcome.retryAfterMinutes).toBe(60);
    }
  });

  it("refuses a caller with no session rather than guessing who they are", async () => {
    mockRpc(() => refused("signed-out", 0, 0));
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("scenes", "deck", "p", null);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("signed out");
  });

  it("refuses when the database declines to issue one", async () => {
    // A row with no id is how the function says "this would exceed the limit"
    // — and it says it without writing a ledger row, so nothing was spent.
    mockRpc(() => refused("allowance", 25, 43_200));
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("visuals", "light", "a prompt", null);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain("25 AI generations");
      expect(outcome.error).toContain("the last 30 days");
      expect(outcome.retryAfterMinutes).toBe(43_200);
    }
  });

  it("fails closed when the reservation itself errors", async () => {
    // The pre-filter may fail open — being wrong there only means a request
    // is not rejected early. Here there would be nothing counting the call.
    mockRpc(() => {
      throw new Error("connection reset");
    });
    const { reserve } = await import("@/lib/ai/rate-limit");

    const outcome = await reserve("map", "draft", "p", null);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Nothing was spent");
  });

  it("truncates an oversized prompt rather than sending it whole", async () => {
    const rpc = mockRpc(issued);
    const { reserve } = await import("@/lib/ai/rate-limit");

    await reserve("map", "draft", "x".repeat(9000), null);
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
    mockRpc((name) =>
      name === "captivate_reserve_generation" ? refused("allowance", 25, 43_200) : true,
    );
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
