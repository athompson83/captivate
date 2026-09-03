import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The exact request `generateStructured` sends to the model.
 *
 * Sampling parameters — `temperature`, `top_p`, `top_k` — are removed on the
 * Claude 5 family: the API answers 400 `invalid_request_error` ("`temperature`
 * is deprecated for this model"), which took down every AI feature at once
 * when the deployed model started rejecting them. The owner hit it live on
 * the create flow. Nothing replaces the knob; variation between drafts is the
 * model's own. This pins that none of them is ever sent again.
 */

const captured: Record<string, unknown>[] = [];
const capturedOptions: (Record<string, unknown> | undefined)[] = [];
const constructedWith: Record<string, unknown>[] = [];

/**
 * One mock for the whole file, with a swappable reply.
 *
 * A per-test `vi.doMock` does not layer on top of the file-level mock — it
 * replaces it for every later import, and `doUnmock` then drops the mock
 * altogether rather than restoring it. Tests that ran green alone failed in
 * file order, reading an undefined options argument, which looked exactly
 * like the provider not sending one.
 */
let reply: (params: Record<string, unknown>) => Record<string, unknown> = () => ({
  content: [{ type: "tool_use", id: "toolu_test_1", name: "answer", input: { value: "hi" } }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    constructor(config: Record<string, unknown>) {
      constructedWith.push(config);
    }
    messages = {
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        captured.push(params);
        capturedOptions.push(options);
        return reply(params);
      },
    };
  },
}));

const defaultReply = reply;

describe("the model request", () => {
  beforeEach(() => {
    captured.length = 0;
    capturedOptions.length = 0;
    constructedWith.length = 0;
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  it("carries no sampling parameters", async () => {
    const { generateStructured } = await import("@/lib/ai/provider");
    const result = await generateStructured({
      schema: z.object({ value: z.string() }),
      toolName: "answer",
      toolDescription: "Answer.",
      system: "sys",
      prompt: "hello",
    });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    for (const key of ["temperature", "top_p", "top_k"]) {
      expect(captured[0]).not.toHaveProperty(key);
    }
  });

  it("still sends the parameters the request needs", async () => {
    const { generateStructured } = await import("@/lib/ai/provider");
    await generateStructured({
      schema: z.object({ value: z.string() }),
      toolName: "answer",
      toolDescription: "Answer.",
      system: "sys",
      prompt: "hello",
    });
    const request = captured[0];
    expect(request.model).toBeTruthy();
    expect(request.max_tokens).toBeGreaterThan(0);
    expect(request.tool_choice).toEqual({ type: "tool", name: "answer" });
  });
});

/**
 * The corrective retry, on the wire.
 *
 * When attempt one fails schema validation, the retry re-sends the
 * conversation with the model's tool_use appended — and the API requires the
 * very next user turn to answer that call with a tool_result block for its
 * id. The old retry sent prose instead, so the API rejected the request
 * ("tool_use ids were found without tool_result blocks") and the one
 * mechanism for rescuing a near-miss never ran: every validation failure
 * fell through to the structural fallback dressed up as a provider error.
 * The owner hit exactly this on the live create flow.
 */
describe("the corrective retry", () => {
  beforeEach(() => {
    captured.length = 0;
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    reply = defaultReply;
  });

  it("answers the failed tool_use with a tool_result block, and recovers", async () => {
    // First answer misses the schema; the second corrects it.
    const inputs = [{ wrong: true }, { value: "right" }];
    let call = 0;
    reply = () => {
      const input = inputs[Math.min(call, inputs.length - 1)];
      call += 1;
      return {
        content: [{ type: "tool_use", id: "toolu_test_1", name: "answer", input }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    };

    const { generateStructured } = await import("@/lib/ai/provider");

    const result = await generateStructured({
      schema: z.object({ value: z.string() }),
      toolName: "answer",
      toolDescription: "Answer.",
      system: "sys",
      prompt: "hello",
    });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(2);

    const retryMessages = captured[1].messages as {
      role: string;
      content: unknown;
    }[];
    // [user prompt, assistant tool_use, user tool_result]
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[1].role).toBe("assistant");
    const answer = retryMessages[2];
    expect(answer.role).toBe("user");
    const blocks = answer.content as {
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
    }[];
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[0].tool_use_id).toBe("toolu_test_1");
    expect(blocks[0].is_error).toBe(true);
  });
});

/**
 * A model call has to fail before the function it runs inside is killed.
 *
 * `/api/ai/map` runs with a 60-second ceiling while the client was built with
 * a 180-second timeout and two retries, so the timeout could never fire: the
 * platform killed the function first and the owner got a bare 504 with no
 * message, no toast and no completed ledger row. The client's patience must
 * fit inside the route's budget, not the other way round.
 */
describe("the call fits inside the function's budget", () => {
  beforeEach(() => {
    captured.length = 0;
    capturedOptions.length = 0;
    constructedWith.length = 0;
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  const call = async (attemptTimeoutMs?: number) => {
    const { generateStructured } = await import("@/lib/ai/provider");
    return generateStructured({
      schema: z.object({ value: z.string() }),
      toolName: "answer",
      toolDescription: "Answer.",
      system: "sys",
      prompt: "hello",
      ...(attemptTimeoutMs === undefined ? {} : { attemptTimeoutMs }),
    });
  };

  it("sends a per-attempt timeout with every request", async () => {
    await call();
    expect(capturedOptions[0]).toMatchObject({ timeout: expect.any(Number) });
  });

  it("honours the timeout a caller states for its route", async () => {
    await call(120_000);
    expect(capturedOptions[0]).toMatchObject({ timeout: 120_000 });
  });

  it("defaults short enough for two attempts inside a 45s route", async () => {
    // Every light route runs with maxDuration 45. The corrective retry means
    // two model calls, so one attempt may not exceed half of that.
    await call();
    const timeout = (capturedOptions[0] as { timeout: number }).timeout;
    expect(timeout * 2).toBeLessThan(45_000);
  });

  it("does not multiply the wait with SDK-level retries", async () => {
    // generateStructured already retries once for a schema near-miss. Client
    // retries on top of that multiply the worst case past any route budget.
    await call();
    expect(constructedWith[0]).toMatchObject({ maxRetries: 1 });
  });
});

/**
 * A cut-off answer says it was cut off.
 *
 * The narrative map was generated with a 4000-token ceiling while the live
 * ledger recorded successful maps at 4820 and 5543 — two-attempt totals, so
 * the first attempt had already been truncated. Nothing inspected
 * `stop_reason`, so a truncated answer simply failed its schema and the author
 * was told the model's answer "didn't match the required shape", which is both
 * wrong and unactionable. The retry could not help either: it answers under
 * the same ceiling with a longer conversation in front of it.
 */
describe("an answer cut off at the token ceiling", () => {
  beforeEach(() => {
    captured.length = 0;
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    reply = defaultReply;
  });

  const truncate = () => {
    reply = () => ({
      stop_reason: "max_tokens",
      content: [{ type: "tool_use", id: "toolu_test_1", name: "answer", input: { partial: true } }],
      usage: { input_tokens: 400, output_tokens: 4000 },
    });
  };

  const run = async () => {
    const { generateStructured } = await import("@/lib/ai/provider");
    return generateStructured({
      schema: z.object({ value: z.string() }),
      toolName: "answer",
      toolDescription: "Answer.",
      system: "sys",
      prompt: "hello",
      maxTokens: 4000,
    });
  };

  it("says the answer was too long, not that it was the wrong shape", async () => {
    truncate();
    const result = await run();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("truncated");
    expect(result.error).toMatch(/cut off/i);
    expect(result.error).not.toMatch(/required shape/i);
  });

  it("does not spend a second call under the same ceiling", async () => {
    truncate();
    await run();
    expect(captured).toHaveLength(1);
  });

  it("records what the failed attempt cost", async () => {
    truncate();
    const result = await run();
    if (result.ok) return;
    // The ledger row for a truncated run recorded nothing, so real spend was
    // invisible in the cost record and the limiter could not tell it from a
    // call the provider refused.
    expect(result.usage).toEqual({ input: 400, output: 4000 });
  });

  it("reports the usage of a near-miss that failed twice", async () => {
    reply = () => ({
      content: [{ type: "tool_use", id: "toolu_test_1", name: "answer", input: { wrong: true } }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_output");
    expect(result.usage).toEqual({ input: 200, output: 400 });
  });

  it("records which fields the model actually got wrong, separately from the user-facing message", async () => {
    // Without this, a recurring invalid_output is undiagnosable after the
    // fact: the ledger and the toast both said only "didn't match the
    // required shape" and nothing recorded which field caused it.
    reply = () => ({
      content: [{ type: "tool_use", id: "toolu_test_1", name: "answer", input: { wrong: true } }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/required shape/i);
    expect(result.detail).toBeDefined();
    expect(result.detail).not.toBe(result.error);
    expect(result.detail).toContain("value");
  });
});
