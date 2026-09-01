import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

const DIR = "supabase/migrations";

/**
 * Every rate any migration seeds, not the rates in one named file.
 *
 * This read `0023` alone, which was the whole story until a second gateway
 * arrived with its own price list in `0027`. A test pinned to the first file
 * would have reported the OpenRouter default as unpriced while its row sat in
 * the migration directory — a false alarm, which is the failure that teaches
 * people to delete a check.
 *
 * Rates accumulate rather than override: each model is its own primary key, so
 * a later file adds models without replacing earlier ones, and a later
 * effective-dated row for the same model is a repricing this test does not
 * need to model — it only asks whether a price exists at all.
 */
function pricedModels(): Map<string, { input: number; output: number }> {
  const rates = new Map<string, { input: number; output: number }>();
  // Model ids carry a slash on OpenRouter (`anthropic/claude-sonnet-5`), which
  // the old character class silently excluded — so every one of them would
  // have read as unpriced.
  const pattern = /\(\s*'([\w./-]+)'\s*,\s*'[\d-]+'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,/g;

  for (const name of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(DIR, name), "utf8");
    let start = sql.indexOf("insert into public.ai_model_rates");
    while (start > -1) {
      const block = sql.slice(start, sql.indexOf("on conflict", start));
      for (const m of block.matchAll(pattern)) {
        rates.set(m[1], { input: Number(m[2]), output: Number(m[3]) });
      }
      start = sql.indexOf("insert into public.ai_model_rates", start + 1);
    }
  }

  expect(rates.size, "no migration seeds ai_model_rates any more").toBeGreaterThan(0);
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

  it("prices whichever default a deployment lands on, on either gateway", () => {
    // `AI_MODEL` above is only the default for the provider *this* process
    // resolved — in CI, with no key set, that is always Anthropic. The other
    // default is then completely unguarded: an operator adds an OpenRouter key
    // in production, the gateway switches, and every generation settles at
    // zero with nothing red anywhere. Both defaults are named here so neither
    // depends on which environment the test happened to run in.
    for (const model of ["claude-sonnet-5", "anthropic/claude-sonnet-5"]) {
      expect(rates.has(model), `${model} is a provider default with no rate row`).toBe(true);
    }
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
