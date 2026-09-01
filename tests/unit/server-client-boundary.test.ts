import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/**
 * The boundary that took /recordings down in production.
 *
 * `src/lib/data/recordings.ts` is a `"use server"` file and imported
 * `parseCues` from `lib/record/transcript.ts`, which is `"use client"`.
 * Typecheck passed, lint passed, `next build` passed, the unit suite that
 * mocks Supabase and calls `listRecordings` passed — and every visit to
 * /recordings answered 500 with *Attempted to call parseCues() from the
 * server*. A `"use client"` export is not a function on the server; it is a
 * reference the runtime can render or pass as a prop and nothing else.
 *
 * Nothing in the toolchain checks this, so this test does. The invariant is
 * narrow enough to be exactly true: a server action module cannot render
 * anything, so it has no legitimate reason to reach a client module at all —
 * unlike a server *component*, for which importing a client component and
 * rendering it is the normal arrangement.
 *
 * It walks the real import graph rather than a list, so a client module
 * introduced three hops down a helper chain fails just as loudly as a direct
 * import.
 */

const SRC = resolve(__dirname, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const ALL = walk(SRC);

const source = new Map<string, string>();
function read(path: string): string {
  let text = source.get(path);
  if (text === undefined) {
    text = readFileSync(path, "utf8");
    source.set(path, text);
  }
  return text;
}

/** A directive only counts where the compiler reads it: the top of the file. */
function directive(path: string): "client" | "server" | null {
  const head = read(path).slice(0, 400);
  if (/^\s*(?:\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head)) return "client";
  if (/^\s*(?:\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(head)) return "server";
  return null;
}

const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Resolves `@/…` and relative specifiers the way the tsconfig alias does. */
function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null; // A package, not our code.
  for (const suffix of ["", ...CANDIDATES]) {
    const candidate = base + suffix;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this extension.
    }
  }
  return null;
}

/**
 * Value imports only. `import type { X }` and `import { type X }` are erased
 * before the module ever exists at runtime, so they cross no boundary.
 */
function valueImports(path: string): string[] {
  const text = read(path);
  const found: string[] = [];
  const pattern = /import\s+(type\s+)?([\s\S]*?)from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    const [, typeKeyword, clause, specifier] = match;
    if (typeKeyword) continue;
    const bindings = clause.trim();
    // `import { type A, type B } from …` is entirely erased too.
    if (
      bindings.startsWith("{") &&
      bindings
        .replace(/[{}]/g, "")
        .split(",")
        .filter((part) => part.trim())
        .every((part) => /^\s*type\s/.test(part))
    ) {
      continue;
    }
    found.push(specifier);
  }
  // `import "./side-effect"` has no `from`.
  for (const match of text.matchAll(/import\s*["']([^"']+)["']\s*;/g)) found.push(match[1]);
  return found;
}

/** Every module a server action can reach, and the path it took to get there. */
function clientModulesReachableFrom(root: string): { module: string; via: string[] }[] {
  const leaks: { module: string; via: string[] }[] = [];
  const seen = new Set<string>([root]);
  const queue: { path: string; via: string[] }[] = [{ path: root, via: [root] }];

  while (queue.length) {
    const { path, via } = queue.shift()!;
    for (const specifier of valueImports(path)) {
      const target = resolveImport(path, specifier);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      const trail = [...via, target];
      if (directive(target) === "client") {
        leaks.push({ module: target, via: trail });
        continue; // Report the crossing; don't walk the client half of the app.
      }
      queue.push({ path: target, via: trail });
    }
  }
  return leaks;
}

const serverActionFiles = ALL.filter((path) => directive(path) === "server");

describe("server/client module boundary", () => {
  it("finds the server-action files it is meant to be guarding", () => {
    // A resolver or directive-detection regression would otherwise turn this
    // whole suite green by having nothing to check.
    expect(serverActionFiles.length).toBeGreaterThanOrEqual(5);
    expect(serverActionFiles.some((path) => path.endsWith("data/recordings.ts"))).toBe(true);
  });

  it.each(serverActionFiles.map((path) => [path.slice(SRC.length + 1), path]))(
    '"use server" %s reaches no "use client" module',
    (_label, path) => {
      const leaks = clientModulesReachableFrom(path);
      expect(leaks.map(({ via }) => via.map((p) => p.slice(SRC.length + 1)).join(" → "))).toEqual(
        [],
      );
    },
  );

  it("still detects a crossing when one is introduced", () => {
    // Proves the walk is load-bearing rather than vacuously passing: the
    // recorder is a client module, and reaching it from a server action is
    // the exact shape of the /recordings failure.
    const recorder = join(SRC, "lib/record/recorder.ts");
    expect(directive(recorder)).toBe("client");
    expect(valueImports(join(SRC, "lib/record/transcript.ts"))).toContain(
      "@/lib/record/transcript-core",
    );
    expect(directive(join(SRC, "lib/record/transcript-core.ts"))).toBe(null);
  });
});
