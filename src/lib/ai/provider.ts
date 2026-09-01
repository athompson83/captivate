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
 * There are two providers behind it now. The retry policy, the error strings
 * and the schema validation are shared — they are the product's behaviour and
 * must not differ by which key an operator happened to set — and each provider
 * supplies only a `Conversation`: how to ask for one answer, and how to put a
 * failed answer back in front of the model so it can correct itself. That
 * second half is the part that genuinely differs. Anthropic wants the
 * correction as a `tool_result` block answering the failed `tool_use`;
 * OpenAI-compatible APIs want a `role: "tool"` message carrying the same
 * `tool_call_id`. Both reject the naive version — a plain user turn after an
 * unanswered tool call — and this repository has already shipped that bug once.
 */

/** Which wire protocol the deployment talks. */
export type AiProviderName = "anthropic" | "openrouter";

const PROVIDERS = new Set<AiProviderName>(["anthropic", "openrouter"]);

/**
 * Which provider this deployment uses, and why it is resolved rather than set.
 *
 * An operator should be able to switch by adding a key, not by keeping two
 * variables in step — the failure mode of "set the provider *and* the key" is
 * a deployment that names OpenRouter, holds an Anthropic key, and reports
 * itself unconfigured while both halves look present.
 *
 * Anthropic wins a tie because it is what every existing deployment is already
 * on: adding an OpenRouter key next to a working Anthropic one must not
 * silently move the whole product onto a different gateway. `CAPTIVATE_AI_PROVIDER`
 * is there for the deliberate switch.
 *
 * With neither key set the answer is `anthropic`, which is not a claim that
 * anything is configured — `isAiConfigured` is the only thing that says that —
 * but it keeps `AI_MODEL` at a stable, priced default so the cost test and the
 * status route have something honest to report.
 */
function resolveProvider(): AiProviderName {
  const named = process.env.CAPTIVATE_AI_PROVIDER?.trim().toLowerCase();
  if (named && PROVIDERS.has(named as AiProviderName)) return named as AiProviderName;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "anthropic";
}

export const AI_PROVIDER = resolveProvider();

/**
 * The default model per provider.
 *
 * Both are Claude Sonnet 5 on purpose. Every prompt in `service.ts`, every
 * schema cap, the token ceiling below and the shape of the structural
 * fallbacks were tuned against that model, so changing the *gateway* and the
 * *model* in one step would leave nothing to attribute a regression to.
 * `CAPTIVATE_AI_MODEL` moves it in one variable once the gateway is known good
 * — `openai/gpt-5.2`, `google/gemini-3.7-flash` and `deepseek/deepseek-v3.2` all
 * support the forced tool call this depends on, and the last is roughly a
 * tenth of the price.
 *
 * Anything set here needs a row in `ai_model_rates` or its generations settle
 * at zero cost, silently. `tests/unit/generation-cost.test.ts` is the line
 * that catches that.
 */
const DEFAULT_MODEL: Record<AiProviderName, string> = {
  anthropic: "claude-sonnet-5",
  openrouter: "anthropic/claude-sonnet-5",
};

export const AI_MODEL = process.env.CAPTIVATE_AI_MODEL?.trim() || DEFAULT_MODEL[AI_PROVIDER];

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
  return AI_PROVIDER === "openrouter"
    ? Boolean(process.env.OPENROUTER_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY);
}

/** What an operator has to set, named in the message they will actually see. */
const KEY_NAME: Record<AiProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

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

/** Tokens billed by one call. */
interface Usage {
  input: number;
  output: number;
}

/**
 * One answer, in the only vocabulary the shared loop understands.
 *
 * `unreadable` is not the same as `no_tool`: the model did call the tool, so
 * insisting it call one would be answering a question nobody asked. It gets
 * the correction path, with the parse failure as the thing to fix.
 */
type Attempt =
  | { kind: "tool"; input: unknown; usage: Usage }
  | { kind: "no_tool"; usage: Usage }
  | { kind: "unreadable"; usage: Usage; detail: string }
  | { kind: "truncated"; usage: Usage }
  | { kind: "overloaded" }
  | { kind: "error"; message: string };

/**
 * A conversation with one model, which remembers what it last said.
 *
 * The memory is the point. A correction has to reference the exact call that
 * failed — by `tool_use` id or by `tool_call_id` — so it cannot be assembled
 * by a caller holding only the parsed result.
 */
interface Conversation {
  attempt(): Promise<Attempt>;
  /** Put the last answer back with what was wrong with it. */
  correct(problem: string): void;
  /** The last answer called no tool. Say so. */
  insist(): void;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

function anthropicConversation<T>(
  options: GenerateOptions<T>,
  jsonSchema: Record<string, unknown>,
  maxTokens: number,
): Conversation {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: options.prompt }];
  let last: Anthropic.Message | null = null;
  let lastToolUseId: string | null = null;

  return {
    async attempt() {
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
        if (status === 429 || status === 529) return { kind: "overloaded" };
        return {
          kind: "error",
          message:
            error instanceof Error
              ? `The model couldn't be reached: ${error.message}`
              : "The model couldn't be reached.",
        };
      }

      last = response;
      const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens };

      if (response.stop_reason === "max_tokens") return { kind: "truncated", usage };

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      if (!toolUse) {
        lastToolUseId = null;
        return { kind: "no_tool", usage };
      }

      lastToolUseId = toolUse.id;
      return { kind: "tool", input: toolUse.input, usage };
    },

    correct(problem) {
      if (!last || !lastToolUseId) return;
      // The correction must arrive as a tool_result for the failed call, not
      // as prose: the API rejects any user turn after a tool_use that does
      // not answer it ("tool_use ids were found without tool_result blocks"),
      // which meant this retry — the whole rescue path for a near-miss —
      // could never run. Every schema failure fell straight through to the
      // structural fallback while looking like a model error.
      messages.push(
        { role: "assistant", content: last.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: lastToolUseId,
              is_error: true,
              content: problem,
            },
          ],
        },
      );
    },

    insist() {
      if (!last) return;
      messages.push(
        { role: "assistant", content: last.content },
        {
          role: "user",
          content: `You must answer by calling the ${options.toolName} tool. Call it now.`,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

const OPENROUTER_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Only the fields this code reads, and every one of them optional where the
 * spec allows it to be.
 *
 * OpenRouter fronts dozens of upstreams and normalises them onto the OpenAI
 * shape; "normalises" is not "guarantees", and a response that is a little
 * different from the one model we tested against must degrade to a readable
 * error rather than a `TypeError` in a server component.
 */
const ChatCompletion = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z
          .object({
            content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  id: z.string(),
                  function: z.object({ name: z.string(), arguments: z.string() }),
                }),
              )
              .nullish(),
          })
          .prefault({}),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
    })
    .nullish(),
});

/** An OpenAI-shaped message, carrying only what a correction turn needs. */
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function openRouterConversation<T>(
  options: GenerateOptions<T>,
  jsonSchema: Record<string, unknown>,
  maxTokens: number,
): Conversation {
  const messages: ChatMessage[] = [
    { role: "system", content: options.system },
    { role: "user", content: options.prompt },
  ];
  let lastCall: { id: string; arguments: string } | null = null;
  let lastContent: string | null = null;

  return {
    async attempt() {
      let payload: unknown;
      let status = 0;
      try {
        const response = await fetch(OPENROUTER_CHAT_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            // OpenRouter's attribution headers. The product's name and its own
            // public origin, and deliberately nothing else — no account, no
            // author, no prompt — because this is a third party being told
            // who is calling, not who is asking.
            "X-Title": "Captivate",
            ...(process.env.NEXT_PUBLIC_SITE_URL
              ? { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL }
              : {}),
          },
          body: JSON.stringify({
            model: AI_MODEL,
            max_tokens: maxTokens,
            messages,
            tools: [
              {
                type: "function",
                function: {
                  name: options.toolName,
                  description: options.toolDescription,
                  parameters: jsonSchema,
                },
              },
            ],
            // The named form, not `"required"`: there is exactly one tool and
            // the whole design rests on the answer arriving through it, so
            // letting the model pick which tool to call is a freedom with
            // nothing on the other side of it.
            tool_choice: { type: "function", function: { name: options.toolName } },
          }),
          signal: AbortSignal.timeout(options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS),
        });
        status = response.status;
        if (!response.ok) {
          if (status === 429 || status === 502 || status === 503) return { kind: "overloaded" };
          if (status === 402) {
            // Worth its own sentence. "The model couldn't be reached" sends an
            // operator to look at networking, and the answer is a billing page.
            return {
              kind: "error",
              message:
                "The OpenRouter account is out of credit, so nothing was generated. Top it up and try again.",
            };
          }
          if (status === 401 || status === 403) {
            return {
              kind: "error",
              message: `The model provider rejected this deployment's credentials (HTTP ${status}). Check OPENROUTER_API_KEY.`,
            };
          }
          return { kind: "error", message: `The model couldn't be reached (HTTP ${status}).` };
        }
        payload = await response.json();
      } catch (error) {
        // A timeout arrives here as an AbortError, and it is the common case
        // rather than an exotic one, so it gets the sentence that says what to
        // do about it.
        if (error instanceof DOMException && error.name === "TimeoutError") {
          return {
            kind: "error",
            message: "The model took too long to answer. Nothing was spent.",
          };
        }
        return {
          kind: "error",
          message:
            error instanceof Error
              ? `The model couldn't be reached: ${error.message}`
              : "The model couldn't be reached.",
        };
      }

      const parsed = ChatCompletion.safeParse(payload);
      if (!parsed.success) {
        return { kind: "error", message: "The model provider returned something unreadable." };
      }

      const choice = parsed.data.choices[0];
      const usage = {
        input: parsed.data.usage?.prompt_tokens ?? 0,
        output: parsed.data.usage?.completion_tokens ?? 0,
      };

      lastContent = choice.message.content ?? null;
      const call = choice.message.tool_calls?.[0] ?? null;
      lastCall = call ? { id: call.id, arguments: call.function.arguments } : null;

      // Checked before the tool call rather than after: a model cut off
      // mid-arguments still reports a `tool_calls` entry, and its JSON is
      // truncated garbage. Reading that first would report "the arguments
      // weren't valid JSON" — true, unactionable, and hiding the ceiling that
      // actually caused it.
      if (choice.finish_reason === "length") return { kind: "truncated", usage };
      if (!call) return { kind: "no_tool", usage };

      // Arguments arrive as a *string* here, where the Anthropic SDK hands
      // back a parsed object. That is the one place a caller could see a
      // difference between the two providers, so it is absorbed here.
      try {
        return { kind: "tool", input: JSON.parse(call.function.arguments), usage };
      } catch {
        return {
          kind: "unreadable",
          usage,
          detail: "The arguments you sent were not valid JSON.",
        };
      }
    },

    correct(problem) {
      if (!lastCall) return;
      // The OpenAI convention's version of the same trap: an assistant message
      // carrying `tool_calls` must be followed by a `tool` message for each
      // one, or the next request is rejected outright.
      messages.push(
        {
          role: "assistant",
          content: lastContent,
          tool_calls: [
            {
              id: lastCall.id,
              type: "function",
              function: { name: options.toolName, arguments: lastCall.arguments },
            },
          ],
        },
        { role: "tool", tool_call_id: lastCall.id, content: problem },
      );
    },

    insist() {
      messages.push(
        { role: "assistant", content: lastContent ?? "" },
        {
          role: "user",
          content: `You must answer by calling the ${options.toolName} tool. Call it now.`,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The shared loop
// ---------------------------------------------------------------------------

export async function generateStructured<T>(
  options: GenerateOptions<T>,
): Promise<StructuredResult<T>> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      error: `AI isn't configured on this deployment. Set ${KEY_NAME[AI_PROVIDER]} to enable it.`,
    };
  }

  const jsonSchema = z.toJSONSchema(options.schema, { io: "input" }) as Record<string, unknown>;
  const maxTokens = Math.min(options.maxTokens ?? 4000, MAX_OUTPUT_TOKENS);

  const conversation =
    AI_PROVIDER === "openrouter"
      ? openRouterConversation(options, jsonSchema, maxTokens)
      : anthropicConversation(options, jsonSchema, maxTokens);

  let totalInput = 0;
  let totalOutput = 0;

  // Two attempts: the first as asked, the second with the validation error so
  // the model can correct a near-miss rather than the user seeing a failure.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await conversation.attempt();

    // Both of these can fire on the *second* attempt, after the first reached
    // the model and was billed. `StructuredResult` documents absent usage as
    // "nothing was spent", so returning nothing here books a real call as free
    // — and the ledger this whole cost model rests on is then short by exactly
    // the generations that had to be corrected and then hit an outage. Spent
    // is spent, whether or not the author got anything.
    const spent =
      totalInput || totalOutput ? { usage: { input: totalInput, output: totalOutput } } : {};

    if (answer.kind === "overloaded") {
      return {
        ok: false,
        reason: "overloaded",
        ...spent,
        error: "The model is busy right now. Try again in a moment — nothing was changed.",
      };
    }
    if (answer.kind === "error") {
      return { ok: false, reason: "provider_error", ...spent, error: answer.message };
    }

    totalInput += answer.usage.input;
    totalOutput += answer.usage.output;

    // The model ran out of room mid-answer. Its tool input is cut off, so the
    // schema rejects it and — with no other check — the author was told their
    // answer "didn't match the required shape", which is both wrong and
    // unactionable: nothing about the prompt was malformed, the ceiling was
    // simply too low. The retry cannot help either, since it re-answers under
    // the same ceiling with a longer conversation in front of it. Say what
    // happened and stop.
    if (answer.kind === "truncated") {
      return {
        ok: false,
        reason: "truncated",
        usage: { input: totalInput, output: totalOutput },
        error: `The answer was longer than the ${maxTokens.toLocaleString()}-token limit for this step and was cut off, so nothing was applied. Ask for a shorter piece — fewer minutes, or fewer moments — and try again.`,
      };
    }

    if (answer.kind === "no_tool") {
      if (attempt === 0) {
        conversation.insist();
        continue;
      }
      return {
        ok: false,
        reason: "invalid_output",
        usage: { input: totalInput, output: totalOutput },
        error: "The model didn't return usable structured output. Nothing was changed.",
      };
    }

    if (answer.kind === "unreadable") {
      if (attempt === 0) {
        conversation.correct(
          `${answer.detail}\n\nCall ${options.toolName} again with valid JSON that matches the schema exactly.`,
        );
        continue;
      }
      return {
        ok: false,
        reason: "invalid_output",
        usage: { input: totalInput, output: totalOutput },
        error: "The model's answer couldn't be read as structured output. Nothing was changed.",
      };
    }

    const parsed = options.schema.safeParse(answer.input);
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

      conversation.correct(
        `That input didn't match the schema:\n${issues}\n\nCall ${options.toolName} again with corrected input. Respect every length limit exactly.`,
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
