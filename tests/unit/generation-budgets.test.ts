import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A model call must fail before the function it runs inside is killed.
 *
 * `/api/ai/map` ran with a 60-second platform ceiling while its model call was
 * given three minutes and two SDK retries on top, so the client's own timeout
 * could never fire: Vercel killed the function first and the browser got a
 * bare 504 — no message, no toast, and a reservation left pending that counted
 * against the author's allowance for thirty days.
 *
 * These read source rather than running the routes, because the claim is about
 * two numbers written in two different files agreeing with each other, which
 * no amount of exercising either one on its own can show.
 */

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const service = read("src/lib/ai/service.ts");
const provider = read("src/lib/ai/provider.ts");

const ROUTES = [
  "src/app/api/ai/map/route.ts",
  "src/app/api/ai/moment/route.ts",
  "src/app/api/ai/notes/route.ts",
  "src/app/api/ai/rewrite/route.ts",
  "src/app/api/ai/scene/route.ts",
  "src/app/api/ai/scenes-from-map/route.ts",
  "src/app/api/ai/create-from-map/route.ts",
  "src/app/api/ai/visuals/route.ts",
  "src/app/api/ai/visuals/draw/route.ts",
];

const numeric = (literal: string) => Number(literal.replaceAll("_", ""));

function maxDurationOf(path: string): number {
  const match = read(path).match(/export const maxDuration = (\d[\d_]*)/);
  if (!match) throw new Error(`${path} declares no maxDuration`);
  return numeric(match[1]);
}

/**
 * Which generation each route runs, and therefore which budget has to fit
 * inside its ceiling. Read from the source rather than declared here: a table
 * written by hand is the thing that drifts.
 */
function budgetsIn(functionName: string): number[] {
  const start = service.indexOf(`export async function ${functionName}(`);
  if (start < 0) throw new Error(`service.ts exports no ${functionName}`);
  const next = service.indexOf("\nexport async function ", start + 1);
  const body = service.slice(start, next < 0 ? undefined : next);
  return [...body.matchAll(/attemptTimeoutMs: (\d[\d_]*)/g)].map((m) => numeric(m[1]));
}

const SERVICE_FUNCTIONS = [
  "buildNarrativeMap",
  "rewriteMoment",
  "buildScenesFromMap",
  "buildSingleScene",
  "rewriteText",
  "writeSpeakerNotes",
  "suggestVisuals",
  "generateDrawing",
];

describe("every generation states how long one attempt may take", () => {
  const callSites = service.match(/generateStructured\(\{/g) ?? [];
  const budgets = service.match(/attemptTimeoutMs: (\d[\d_]*)/g) ?? [];

  it("names a budget at every call site", () => {
    expect(callSites.length).toBeGreaterThan(0);
    expect(budgets).toHaveLength(callSites.length);
  });

  it("leaves room for the corrective retry inside the route that runs it", () => {
    for (const path of ROUTES) {
      const source = read(path);
      const ceilingMs = maxDurationOf(path) * 1000;
      const used = SERVICE_FUNCTIONS.filter((name) => source.includes(name));
      // Every AI route runs some generation; one that runs none would make
      // this whole check vacuous.
      expect(used.length).toBeGreaterThan(0);

      for (const name of used) {
        for (const ms of budgetsIn(name)) {
          // Two attempts, because a schema near-miss is answered a second time.
          expect({ path, name, ms, ceilingMs, fits: ms * 2 < ceilingMs }).toMatchObject({
            fits: true,
          });
        }
      }
    }
  });
});

describe("the deck routes run at the platform ceiling", () => {
  it("gives the map the same budget as the scenes it becomes", () => {
    // 60 seconds could not hold one long map plus its retry, which is the 504
    // the owner hit on the live create flow.
    expect(maxDurationOf("src/app/api/ai/map/route.ts")).toBe(300);
  });
});

describe("the provider does not multiply the wait", () => {
  it("retries once at the SDK level, not twice", () => {
    expect(provider).toMatch(/maxRetries: 1/);
  });

  it("bounds an attempt even when a caller says nothing", () => {
    const match = provider.match(/DEFAULT_ATTEMPT_TIMEOUT_MS = (\d[\d_]*)/);
    expect(match).not.toBeNull();
    expect(numeric(match![1]) * 2).toBeLessThan(45_000);
  });
});

describe("the narrative map has room to finish", () => {
  it("is generated with headroom over the longest map observed in production", () => {
    // Successful maps were recorded at 4820 and 5543 output tokens against a
    // 4000 ceiling — two-attempt totals, so the first attempt was truncated
    // every time. When both attempts truncate the author is handed the
    // structural fallback and told their answer was the wrong shape.
    const match = service.match(/maxTokens: (\d[\d_]*),\n\s+\/\/ \/api\/ai\/map/);
    expect(match).not.toBeNull();
    expect(numeric(match![1])).toBeGreaterThanOrEqual(8000);
  });
});
