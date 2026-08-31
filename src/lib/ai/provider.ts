import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Model provider boundary.
 *
 * Everything the app asks of a model goes through `generateStructured`, which:
 *   - forces the model to answer through a tool whose schema is derived from a
 *     Zod schema, so there is no free-text parsing anywhere;
 *   - validates the result against that same Zod schema;
 *   - retries once, feeding the validation error back, before giving up;
 *   - reports token usage so callers can record cost.
 *
 * Swapping providers means reimplementing this one function.
 */

export const AI_MODEL = process.env.CAPTIVATE_AI_MODEL ?? "claude-sonnet-5";

/**
 * Ceiling on any single generation, as a guard against runaway cost.
 *
 * 16000, up from 12000 (itself up from 8000): a full deck is up to 24 scenes
 * each carrying finished prose and a spoken script, and now also asides —
 * whole extra detail scenes — and photo queries. Each rise happened because a
 * squeezed model learned to compress — thinner bodies, clipped notes — long
 * before the schema's own field caps were near. The client timeout below
 * rises with it, because a bigger answer is a longer wait and a timeout that
 * fires mid-generation bills the tokens and delivers nothing.
 */
const MAX_OUTPUT_TOKENS = 16_000;

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type StructuredResult<T> =
  | { ok: true; data: T; usage: { input: number; output: number }; model: string }
  | {
      ok: false;
      reason: "not_configured" | "invalid_output" | "provider_error" | "overloaded" | "truncated";
      error: string;
      /**
       * What the failed attempts cost, when they reached the model at all.
       *
       * A schema near-miss and a truncated answer both bill two full calls,
       * and the ledger row for them recorded nothing — so the spend was
       * invisible in the cost record, and the limiter could not tell a
       * generation that burned twenty thousand tokens from one that never
       * left the building. Absent means nothing was spent.
       */
      usage?: { input: number; output: number };
    };

let client: Anthropic | null = null;

/**
 * How long one attempt may take when the caller does not say.
 *
 * Short enough that two of them — this function retries once on a schema
 * near-miss — fit inside the 45-second budget every light route runs with.
 */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 20_000;

function anthropic(): Anthropic {
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // One, not two. This function already makes a second call to correct a
    // schema near-miss; SDK-level retries multiply that, and the worst case
    // has to stay inside the route's own ceiling.
    maxRetries: 1,
  });
  return client;
}

export interface GenerateOptions<T> {
  schema: z.ZodType<T>;
  /** Tool name the model must call; also names the shape in error messages. */
  toolName: string;
  toolDescription: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /**
   * How long one attempt may take, in milliseconds.
   *
   * The number that matters is not how long a model might take but how long
   * the function it runs inside is allowed to live. `/api/ai/map` ran with a
   * 60-second ceiling while the client was built with a 180-second timeout,
   * so the timeout could never fire — the platform killed the function first
   * and the owner got a bare 504: no message, no toast, no completed ledger
   * row. Callers state a budget that leaves room for the corrective retry,
   * so a slow model fails as an error the user can read.
   */
  attemptTimeoutMs?: number;
}

export async function generateStructured<T>(
  options: GenerateOptions<T>,
): Promise<StructuredResult<T>> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      error: "AI isn't configured on this deployment. Set ANTHROPIC_API_KEY to enable it.",
    };
  }

  const jsonSchema = z.toJSONSchema(options.schema, { io: "input" }) as Record<string, unknown>;
  const maxTokens = Math.min(options.maxTokens ?? 4000, MAX_OUTPUT_TOKENS);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: options.prompt }];

  let totalInput = 0;
  let totalOutput = 0;

  // Two attempts: the first as asked, the second with the validation error so
  // the model can correct a near-miss rather than the user seeing a failure.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Anthropic.Message;
    try {
      // No sampling parameters. `temperature`/`top_p`/`top_k` are removed on
      // the Claude 5 family — the API answers 400 `invalid_request_error`,
      // which took every AI feature down at once when the deployed model
      // started rejecting them. Variation between drafts is the model's own;
      // nothing replaces the knob.
      response = await anthropic().messages.create(
        {
          model: AI_MODEL,
          max_tokens: maxTokens,
          system: options.system,
          tools: [
            {
              name: options.toolName,
              description: options.toolDescription,
              input_schema: jsonSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: "tool", name: options.toolName },
          messages,
        },
        { timeout: options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS },
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 429 || status === 529) {
        return {
          ok: false,
          reason: "overloaded",
          error: "The model is busy right now. Try again in a moment — nothing was changed.",
        };
      }
      return {
        ok: false,
        reason: "provider_error",
        error:
          error instanceof Error
            ? `The model couldn't be reached: ${error.message}`
            : "The model couldn't be reached.",
      };
    }

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    // The model ran out of room mid-answer. Its tool input is cut off, so the
    // schema rejects it and — with no other check — the author was told their
    // answer "didn't match the required shape", which is both wrong and
    // unactionable: nothing about the prompt was malformed, the ceiling was
    // simply too low. The retry cannot help either, since it re-answers under
    // the same ceiling with a longer conversation in front of it. Say what
    // happened and stop.
    if (response.stop_reason === "max_tokens") {
      return {
        ok: false,
        reason: "truncated",
        usage: { input: totalInput, output: totalOutput },
        error: `The answer was longer than the ${maxTokens.toLocaleString()}-token limit for this step and was cut off, so nothing was applied. Ask for a shorter piece — fewer minutes, or fewer moments — and try again.`,
      };
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) {
      if (attempt === 0) {
        messages.push(
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: `You must answer by calling the ${options.toolName} tool. Call it now.`,
          },
        );
        continue;
      }
      return {
        ok: false,
        reason: "invalid_output",
        usage: { input: totalInput, output: totalOutput },
        error: "The model didn't return usable structured output. Nothing was changed.",
      };
    }

    const parsed = options.schema.safeParse(toolUse.input);
    if (parsed.success) {
      return {
        ok: true,
        data: parsed.data,
        usage: { input: totalInput, output: totalOutput },
        model: AI_MODEL,
      };
    }

    if (attempt === 0) {
      const issues = parsed.error.issues
        .slice(0, 8)
        .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");

      // The correction must arrive as a tool_result for the failed call, not
      // as prose: the API rejects any user turn after a tool_use that does
      // not answer it ("tool_use ids were found without tool_result blocks"),
      // which meant this retry — the whole rescue path for a near-miss —
      // could never run. Every schema failure fell straight through to the
      // structural fallback while looking like a model error.
      messages.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              is_error: true,
              content: `That input didn't match the schema:\n${issues}\n\nCall ${options.toolName} again with corrected input. Respect every length limit exactly.`,
            },
          ],
        },
      );
      continue;
    }

    return {
      ok: false,
      reason: "invalid_output",
      usage: { input: totalInput, output: totalOutput },
      error:
        "The model's answer didn't match the required shape, so nothing was applied. Try again, or rephrase your prompt.",
    };
  }

  return {
    ok: false,
    reason: "invalid_output",
    usage: { input: totalInput, output: totalOutput },
    error: "The model's answer couldn't be validated. Nothing was changed.",
  };
}

/** Shared voice for every Captivate generation. */
export const BASE_SYSTEM = `You write presentation content for Captivate, a tool used by educators, clinicians, trainers and professional speakers.

Rules that matter more than anything else:
- A scene is a visual aid for a person who is speaking. It is not a document. Never write a paragraph where a phrase will do.
- Headings are short and specific. Prefer "Shock is a clinical diagnosis" over "Introduction to shock".
- Bullets are at most one line each, and there are at most four of them. If you need more, that is two scenes.
- Never invent statistics, citations, dates or quotations. If a number would strengthen a scene, describe the placeholder in the speaker notes instead.
- Speaker notes carry the detail that does not belong on screen: what to say, what to emphasise, what to ask the room.
- Write in the register of the audience described, without jargon they would not use themselves.
- Vary layouts. A deck where every scene is a bulleted list has failed.`;
