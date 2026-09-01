import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUDGET_GROUPS,
  PER_PRESENTATION,
  ceilingsFor,
  type BudgetGroup,
  type Plan,
} from "@/lib/billing/plans";

/**
 * The ceilings exist twice, and they must be the same twice.
 *
 * `plans.ts` is what the pricing page advertises and the settings meter draws;
 * `plan_budgets` is what actually refuses a call. Two copies of a number is a
 * drift risk, and the drift is silent in the worst direction: a migration that
 * allows less than the product promised refuses generations the author was
 * told they had, and one that allows more sells an allowance nobody is paying
 * for.
 *
 * Parsed out of the migration rather than read from a database, so it runs in
 * the unit suite on every commit — `npm run test:rls` applies the real schema
 * and is the slower, fuller check.
 */

const MIGRATION = "supabase/migrations/0022_plan_budgets.sql";
const CREDITS = "supabase/migrations/0024_generation_credits.sql";

/** The `insert ... values` rows that seed `plan_budgets`. */
function seededBudgets(): Map<string, { allowance: number[]; burst: number[] }> {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("insert into public.plan_budgets");
  expect(start, "the seed insert moved or was renamed").toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf("on conflict", start));

  const rows = new Map<string, { allowance: number[]; burst: number[] }>();
  const pattern =
    /\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
  for (const m of block.matchAll(pattern)) {
    rows.set(`${m[1]}:${m[2]}`, {
      allowance: [Number(m[3]), Number(m[4])],
      burst: [Number(m[5]), Number(m[6])],
    });
  }
  return rows;
}

describe("the database and the product agree on every ceiling", () => {
  const seeded = seededBudgets();
  const plans: Plan[] = ["free", "basic", "pro", "unlimited"];

  it("seeds a row for every plan and every group, and no others", () => {
    expect(seeded.size).toBe(plans.length * BUDGET_GROUPS.length);
    for (const plan of plans) {
      for (const group of BUDGET_GROUPS) {
        expect(seeded.has(`${plan}:${group}`), `${plan}/${group} is not seeded`).toBe(true);
      }
    }
  });

  it("matches `plans.ts` on the allowance and the burst ceiling alike", () => {
    for (const plan of plans) {
      for (const group of BUDGET_GROUPS as readonly BudgetGroup[]) {
        const [allowance, burst] = ceilingsFor(plan, group);
        const row = seeded.get(`${plan}:${group}`)!;
        expect(row.allowance, `${plan}/${group} allowance`).toEqual([
          allowance.windowMinutes,
          allowance.max,
        ]);
        expect(row.burst, `${plan}/${group} burst`).toEqual([burst!.windowMinutes, burst!.max]);
      }
    }
  });

  it("keeps the group names the reservation resolves in step with the product's", () => {
    // `captivate_budget_kinds` maps a group to the ledger kinds it counts. A
    // group the product has and the function does not is a reservation that
    // always answers 'misconfigured' — an outage for that whole feature.
    const sql = readFileSync(MIGRATION, "utf8");
    const start = sql.indexOf("function public.captivate_budget_kinds");
    const block = sql.slice(start, sql.indexOf("$$;", start));
    for (const group of BUDGET_GROUPS) {
      expect(block, `captivate_budget_kinds has no arm for '${group}'`).toContain(
        `when '${group}'`,
      );
    }
  });

  it("prices every group in presentations, the same way the product does", () => {
    // `captivate_per_presentation` is what turns a credit into a presentation
    // rather than a deck counter, and a group it has no arm for returns null.
    // The reservation coalesces that to zero now, so the worst case is a credit
    // buying no headroom in that pool rather than an unbounded ceiling — but
    // the honest fix is for the two lists to agree, which is what this asserts.
    const sql = readFileSync(CREDITS, "utf8");
    const start = sql.indexOf("function public.captivate_per_presentation");
    expect(start, "captivate_per_presentation moved or was renamed").toBeGreaterThan(-1);
    const block = sql.slice(start, sql.indexOf("$$;", start));

    for (const group of BUDGET_GROUPS) {
      expect(block, `captivate_per_presentation has no arm for '${group}'`).toContain(
        `when '${group}'`,
      );
      // And it agrees on the number, not just on having one.
      expect(block, `${group} disagrees with PER_PRESENTATION`).toMatch(
        new RegExp(`when '${group}'\\s+then ${PER_PRESENTATION[group]}\\b`),
      );
    }
  });
});
