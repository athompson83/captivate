import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      create: async (params: Record<string, unknown>) => {
        captured.push(params);
        return {
          content: [{ type: "tool_use", name: "answer", input: { value: "hi" } }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    };
  },
}));

describe("the model request", () => {
  beforeEach(() => {
    captured.length = 0;
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

  it("answers the failed tool_use with a tool_result block, and recovers", async () => {
    const { generateStructured } = await import("@/lib/ai/provider");
    // First answer misses the schema; the second corrects it.
    const inputs = [{ wrong: true }, { value: "right" }];
    let call = 0;
    const client = (await import("@anthropic-ai/sdk")).default as unknown as new () => {
      messages: { create: (p: Record<string, unknown>) => Promise<unknown> };
    };
    // The shared mock replays `captured`; give it per-call inputs instead.
    new client().messages.create = async () => ({}) as never;

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class Anthropic {
        messages = {
          create: async (params: Record<string, unknown>) => {
            captured.push(params);
            const input = inputs[Math.min(call, inputs.length - 1)];
            call += 1;
            return {
              content: [{ type: "tool_use", id: "toolu_test_1", name: "answer", input }],
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };
      },
    }));
    vi.resetModules();
    const { generateStructured: gen } = await import("@/lib/ai/provider");

    const result = await gen({
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
    void generateStructured;
  });
});
