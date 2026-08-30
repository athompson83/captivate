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
