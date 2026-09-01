import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The second gateway, asserted at the wire.
 *
 * There is nothing to mock at a higher level than `fetch` here: the whole of
 * this provider *is* a request body and a response shape, and every defect it
 * can have is a field in the wrong place. So each test reads the JSON that
 * would go to OpenRouter, or hands back the JSON OpenRouter would return, and
 * asserts on what `generateStructured` makes of it.
 *
 * Two of these exist because of a bug this repository has already shipped
 * once, on the other provider. A corrective retry after a failed tool call has
 * to answer that call in the protocol's own terms — a `tool_result` block for
 * Anthropic, a `role: "tool"` message carrying `tool_call_id` for anything
 * OpenAI-shaped — and the plausible-looking version, a plain user turn saying
 * what went wrong, is rejected outright by both. When that happened on the
 * Anthropic path the entire rescue route for a schema near-miss was dead for a
 * release, and it looked exactly like a model that could not follow a schema.
 */

const SCHEMA = z.object({ heading: z.string().min(1), bullets: z.array(z.string()).max(2) });

/** Every request body `fetch` was called with, parsed. */
let sent: Record<string, unknown>[] = [];
/** Responses to hand back, in order; the last is repeated. */
let replies: { status?: number; body: unknown }[] = [];

function mockFetch() {
  return vi.fn(async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: async () => reply.body,
    };
  });
}

/** A well-formed OpenRouter answer that calls the tool with `args`. */
function toolReply(args: unknown, finish = "tool_calls") {
  return {
    body: {
      choices: [
        {
          finish_reason: finish,
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "compose", arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    },
  };
}

async function generate() {
  const { generateStructured } = await import("@/lib/ai/provider");
  return generateStructured({
    schema: SCHEMA,
    toolName: "compose",
    toolDescription: "Compose a scene.",
    system: "You write scenes.",
    prompt: "A scene about shock.",
  });
}

describe("generating through OpenRouter", () => {
  beforeEach(() => {
    sent = [];
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("CAPTIVATE_AI_PROVIDER", "openrouter");
    vi.stubEnv("CAPTIVATE_AI_MODEL", "");
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forces the one tool by name rather than merely requiring a tool", async () => {
    replies = [toolReply({ heading: "Shock is a diagnosis", bullets: ["Not a number"] })];
    const result = await generate();

    expect(result.ok).toBe(true);
    // `"required"` would let a model pick among tools. There is one tool and
    // the entire design rests on the answer arriving through it, so the freedom
    // has nothing on the other side of it.
    expect(sent[0].tool_choice).toEqual({ type: "function", function: { name: "compose" } });
    expect(sent[0].model).toBe("anthropic/claude-sonnet-5");
  });

  it("sends the system prompt as a message, which is where this protocol reads it", async () => {
    // Anthropic takes `system` as a top-level field. Sending it that way here
    // is accepted and ignored, so the whole of BASE_SYSTEM — every rule about
    // what a scene is — would silently stop reaching the model.
    replies = [toolReply({ heading: "H", bullets: [] })];
    await generate();

    const messages = sent[0].messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: "You write scenes." });
    expect(messages[1].role).toBe("user");
    expect(sent[0].system).toBeUndefined();
  });

  it("parses the arguments, which arrive as a string and not an object", async () => {
    // The one place a caller could tell the two providers apart. The Anthropic
    // SDK hands back a parsed object; this hands back JSON text, and passing
    // that straight to a Zod object schema fails every time.
    replies = [toolReply({ heading: "Perfusion first", bullets: ["A", "B"] })];
    const result = await generate();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.heading).toBe("Perfusion first");
  });

  it("answers a failed tool call with a tool message, not a user turn", async () => {
    // The bug already shipped once on the other provider. An assistant message
    // carrying `tool_calls` must be followed by a `tool` message quoting each
    // id, or the API rejects the request outright — so a correction written as
    // prose does not merely fail to help, it makes the retry impossible.
    replies = [
      toolReply({ heading: "", bullets: [] }), // fails: heading must be non-empty
      toolReply({ heading: "Rescued", bullets: [] }),
    ];
    const result = await generate();

    expect(result.ok, "the corrective retry must be able to run at all").toBe(true);

    const second = sent[1].messages as { role: string; tool_call_id?: string; content?: unknown }[];
    const assistant = second.find((m) => m.role === "assistant") as
      { tool_calls?: { id: string }[] } | undefined;
    const tool = second.find((m) => m.role === "tool");

    expect(assistant?.tool_calls?.[0]?.id, "the failed call has to be quoted back").toBe("call_1");
    expect(tool?.tool_call_id, "and answered by id").toBe("call_1");
    expect(String(tool?.content)).toMatch(/heading/);
  });

  it("adds up the tokens across both attempts", async () => {
    // Both calls are billed. A ledger that recorded only the successful one
    // would understate every generation that needed correcting, which is the
    // half worth knowing about.
    replies = [toolReply({ heading: "", bullets: [] }), toolReply({ heading: "Ok", bullets: [] })];
    const result = await generate();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage).toEqual({ input: 200, output: 80 });
  });

  it("reads a cut-off answer as truncated rather than as bad JSON", async () => {
    // A model stopped at the ceiling still reports a `tool_calls` entry, and
    // its arguments are half-written JSON. Checking the arguments first would
    // report "not valid JSON" — true, useless, and hiding the ceiling that
    // caused it — and then burn a second call re-answering under the same one.
    replies = [
      {
        body: {
          choices: [
            {
              finish_reason: "length",
              message: {
                tool_calls: [
                  { id: "c", type: "function", function: { name: "compose", arguments: '{"head' } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4000 },
        },
      },
    ];
    const result = await generate();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("truncated");
      expect(result.usage).toEqual({ input: 10, output: 4000 });
    }
    expect(sent, "a truncation must not be retried under the same ceiling").toHaveLength(1);
  });

  it("still reports what the first attempt cost when the second hits an outage", async () => {
    // The ledger is the point. Attempt 0 reaches the model, fails its schema
    // and is billed; attempt 1 gets a 429. Returning no usage books a real
    // call as free — `StructuredResult` documents absent usage as "nothing was
    // spent" — so the cost record is short by exactly the generations that had
    // to be corrected and then hit an outage.
    replies = [toolReply({ heading: "", bullets: [] }), { status: 429, body: {} }];
    const result = await generate();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("overloaded");
      expect(result.usage, "the billed first attempt must survive the outage").toEqual({
        input: 100,
        output: 40,
      });
    }
  });

  it("reports nothing spent when nothing reached the model", async () => {
    // The other half of the same rule: an outage on the very first attempt
    // really did cost nothing, and claiming otherwise would inflate the ledger
    // rather than complete it.
    replies = [{ status: 503, body: {} }];
    const result = await generate();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.usage).toBeUndefined();
  });

  it("gives an out-of-credit account its own sentence", async () => {
    // "The model couldn't be reached" sends whoever reads it to look at
    // networking. The answer is a billing page.
    replies = [{ status: 402, body: {} }];
    const result = await generate();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("provider_error");
      expect(result.error).toMatch(/out of credit/i);
    }
  });

  it("treats a rejected key as a credentials problem, naming the variable", async () => {
    replies = [{ status: 401, body: {} }];
    const result = await generate();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/OPENROUTER_API_KEY/);
  });

  it("reads a rate limit and a bad gateway as busy, so the caller retries later", async () => {
    for (const status of [429, 502, 503]) {
      sent = [];
      replies = [{ status, body: {} }];
      const result = await generate();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason, `HTTP ${status}`).toBe("overloaded");
    }
  });

  it("refuses a response it cannot read rather than crashing on it", async () => {
    // OpenRouter fronts dozens of upstreams and normalises them onto one
    // shape; normalising is not guaranteeing, and a shape we did not expect
    // has to become a sentence rather than a TypeError in a server component.
    replies = [{ body: { choices: [] } }];
    const result = await generate();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("provider_error");
  });

  it("corrects arguments that are not JSON at all, then gives up cleanly", async () => {
    replies = [
      {
        body: {
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  {
                    id: "c",
                    type: "function",
                    function: { name: "compose", arguments: "not json" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        },
      },
    ];
    const result = await generate();

    expect(sent, "an unreadable answer earns one correction").toHaveLength(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_output");
  });

  it("names the key an operator actually has to set", async () => {
    vi.resetModules();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const result = await generate();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_configured");
      expect(result.error).toMatch(/OPENROUTER_API_KEY/);
    }
  });
});

describe("choosing a provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function provider(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return (await import("@/lib/ai/provider")).AI_PROVIDER;
  }

  it("keeps an existing Anthropic deployment on Anthropic when a second key appears", async () => {
    // The case that matters. Adding an OpenRouter key next to a working
    // Anthropic one must not move the whole product onto a different gateway,
    // a different price and a different set of failure modes without anybody
    // choosing it.
    expect(
      await provider({
        ANTHROPIC_API_KEY: "sk-ant",
        OPENROUTER_API_KEY: "sk-or",
        CAPTIVATE_AI_PROVIDER: "",
      }),
    ).toBe("anthropic");
  });

  it("switches on the key alone when there is only one", async () => {
    expect(
      await provider({
        ANTHROPIC_API_KEY: "",
        OPENROUTER_API_KEY: "sk-or",
        CAPTIVATE_AI_PROVIDER: "",
      }),
    ).toBe("openrouter");
  });

  it("lets the deliberate switch be stated", async () => {
    expect(
      await provider({
        ANTHROPIC_API_KEY: "sk-ant",
        OPENROUTER_API_KEY: "sk-or",
        CAPTIVATE_AI_PROVIDER: "openrouter",
      }),
    ).toBe("openrouter");
  });

  it("ignores a name it does not recognise instead of failing closed on a typo", async () => {
    // `CAPTIVATE_AI_PROVIDER=OpenRouter.ai` should not take AI generation down
    // across the deployment; the keys still say what is reachable.
    expect(
      await provider({
        ANTHROPIC_API_KEY: "",
        OPENROUTER_API_KEY: "sk-or",
        CAPTIVATE_AI_PROVIDER: "openrouter.ai",
      }),
    ).toBe("openrouter");
  });
});
