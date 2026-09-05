import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Any AI route allowed to run longer than a phone will wait for a first byte
 * has to answer through `keepAlive`. This reads the routes rather than
 * running them, because the claim is about how each one returns — and a new
 * route that copies `maxDuration = 300` from a neighbour without copying the
 * wrapper would reproduce the owner's failure exactly.
 */

const ROOT = join(process.cwd(), "src/app/api/ai");

/** iOS abandons a request after sixty seconds without a byte. */
const SILENCE_LIMIT_SECONDS = 60;

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path);
    return name === "route.ts" ? [path] : [];
  });
}

describe("long AI routes keep the connection alive", () => {
  const long = routes(ROOT).filter((path) => {
    const match = /export const maxDuration = (\d+)/.exec(readFileSync(path, "utf8"));
    return match !== null && Number(match[1]) > SILENCE_LIMIT_SECONDS;
  });

  it("finds the routes this rule is about", () => {
    expect(long.map((p) => relative(ROOT, p)).sort()).toEqual([
      "create-from-map/route.ts",
      "map/route.ts",
      "scenes-from-map/route.ts",
      "visuals/draw/route.ts",
      "visuals/generate/route.ts",
    ]);
  });

  it.each(long.map((p) => [relative(ROOT, p), p]))("%s returns through keepAlive", (_, path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain('from "@/lib/ai/keep-alive"');
    expect(source).toMatch(/return keepAlive\(async \(\) =>/);
  });
});
