import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_MODEL } from "@/lib/ai/provider";

/**
 * The model the app actually calls must have a price.
 *
 * `captivate_complete_generation` costs a settled row by looking its model up
 * in `ai_model_rates`, and a model that is not there costs nothing — which is
 * the right behaviour (inventing a price would put made-up numbers into the
 * evidence a pricing decision rests on) and a silent one. The failure mode is
 * exactly the state this whole migration exists to leave behind: tokens
 * recorded, cost zero, and nothing saying so.
 *
 * So the drift that matters is switching `CAPTIVATE_AI_MODEL`, or bumping the
 * default here, without adding the rate. That is a one-line change with no
 * other symptom, and this is the line that catches it.
 */

const MIGRATION = "supabase/migrations/0023_text_generation_cost.sql";

function pricedModels(): Map<string, { input: number; output: number }> {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("insert into public.ai_model_rates");
  expect(start, "the rate seed moved or was renamed").toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf("on conflict", start));

  const rates = new Map<string, { input: number; output: number }>();
  const pattern = /\(\s*'([\w.-]+)'\s*,\s*'[\d-]+'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,/g;
  for (const m of block.matchAll(pattern)) {
    rates.set(m[1], { input: Number(m[2]), output: Number(m[3]) });
  }
  return rates;
}

describe("every model the app can call has a price", () => {
  const rates = pricedModels();

  it("prices the model this deployment is configured to use", () => {
    expect(
      rates.has(AI_MODEL),
      `${AI_MODEL} has no row in ai_model_rates, so every generation it makes will settle at zero cost`,
    ).toBe(true);
  });

  it("charges more for output than for input, on every model", () => {
    // Not a style point: output tokens are the expensive half on every
    // provider, and a row with them the wrong way round would understate a
    // long generation — which is exactly the kind this is measuring.
    expect(rates.size).toBeGreaterThan(0);
    for (const [model, rate] of rates) {
      expect(rate.input, `${model} input rate`).toBeGreaterThan(0);
      expect(rate.output, `${model} output rate`).toBeGreaterThan(rate.input);
    }
  });
});
