import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build, type Plugin } from "vite";

/**
 * Stands in for the server-action boundary that Next builds and vite does not.
 *
 * A `"use server"` module is not shipped to the browser. Next replaces each of
 * its exports with a stub that calls the server over the wire, so a client
 * component can import `createPresentation` and get an RPC. A plain vite bundle
 * has no such transform: it follows the import and pulls the real module in,
 * along with the Supabase server client, the AI provider, and `server-only` —
 * which exists precisely to make that a build error.
 *
 * That is why mounting the editor in a fixture failed twice before, and why
 * aliasing the eight action modules by hand did not fix it: the failure was one
 * level deeper, at `server-only` reached through `sourced-assets.ts`, and the
 * error only named it once the bundle was run directly instead of through the
 * suite.
 *
 * So do what Next does. Every export of a `"use server"` module becomes an
 * async stub that records the call and returns whatever the test told it to.
 * The names are read from the real source rather than hand-maintained, so a new
 * action is stubbed the day it is written; the module's other exports are types
 * and erase on their own.
 *
 * `server-only` is deliberately *not* aliased away. If a module carrying it
 * ever becomes reachable from a client entry by some path other than a server
 * action, that is a genuine boundary violation and the build should fail loudly
 * rather than quietly bundle a file that reads secrets.
 */
/** Windows separators to POSIX, so two paths from different sources compare. */
function posix(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/$/, "");
}

function serverActionStubs(root: string): Plugin {
  const USE_SERVER = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use server["']/;
  const EXPORTED = /^export\s+async\s+function\s+([A-Za-z0-9_$]+)/gm;

  return {
    name: "captivate:server-action-stubs",
    // Ahead of the React plugin: this replaces the module wholesale, so there
    // is nothing left for anything else to transform.
    enforce: "pre",
    transform(code, id) {
      // Both sides normalised, and the root given its separator. Vite hands the
      // transform hook a POSIX path while `resolve` uses the platform's, so on
      // Windows the comparison silently never matched and every server action
      // was bundled for real — failing in `server-only` with an error that
      // names neither this plugin nor the reason. The trailing separator stops
      // a sibling directory called `srcfoo` from matching too.
      const file = posix(id.split("?")[0]);
      if (!file.startsWith(`${posix(root)}/`) || !/\.tsx?$/.test(file)) return null;
      if (!USE_SERVER.test(code)) return null;

      const names = [...code.matchAll(EXPORTED)].map((match) => match[1]);
      if (names.length === 0) return null;

      const stub = [
        "const __record = (name) => async (...args) => {",
        "  const bus = (globalThis.__serverActions ??= { log: [], replies: {} });",
        "  bus.log.push({ name, args });",
        "  const reply = bus.replies[name];",
        "  if (typeof reply === 'function') return await reply(...args);",
        "  if (reply !== undefined) return reply;",
        // The shape every action in this codebase returns. A stub that resolved
        // to undefined would make each caller's `result.ok` throw, and the test
        // would fail somewhere unrelated to what it was checking.
        "  return { ok: true, data: undefined };",
        "};",
        ...names.map((name) => `export const ${name} = __record(${JSON.stringify(name)});`),
      ].join("\n");

      return { code: stub, map: null };
    },
  };
}

/**
 * Bundles a fixture entry and returns a `file://` URL for it.
 *
 * Built in **development** mode on purpose. Two of the defects these fixtures
 * exist for only appear in a development React: StrictMode's double-invoke of
 * effects, and the render timing that made a contentEditable's caret collapse.
 * A production bundle would pass while testing neither.
 *
 * One self-contained script, inlined, so the page opens from the file system
 * with no server and no module CORS.
 */
export async function bundleFixture(entry: string): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "captivate-fixture-"));

  await build({
    root: process.cwd(),
    mode: "development",
    logLevel: "error",
    plugins: [serverActionStubs(resolve(process.cwd(), "src")), react()],
    resolve: {
      alias: {
        "@": resolve(process.cwd(), "src"),
        // No Next runtime exists in a file:// fixture; links render as links.
        "next/link": resolve(process.cwd(), "tests/e2e/fixtures/next-link-shim.tsx"),
      },
    },
    define: {
      "process.env.NODE_ENV": '"development"',
      /*
       * Next inlines `NEXT_PUBLIC_*` at build time, so a client component can
       * read one and never think about `process`. vite does not, and the
       * bundle then throws `process is not defined` the moment the module is
       * evaluated — before anything renders, which looks exactly like the
       * fixture failing to mount for no reason. Inline it here for the same
       * reason Next does, with a stable value so embed sandboxing behaves the
       * way it does in a configured deployment rather than an unconfigured one.
       */
      "process.env.NEXT_PUBLIC_SITE_URL": '"https://fixture.captivate.test"',
      /*
       * Empty on purpose. `isSupabaseConfigured` is derived from these two, so
       * blank means the fixture cannot reach a backend even by accident — no
       * realtime socket, no PostgREST call, no chance of a test pointing at the
       * real project. Anything that needs a server answer goes through a
       * stubbed action instead, where the test controls the reply.
       */
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '""',
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""',
    },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: resolve(process.cwd(), entry),
        formats: ["iife"],
        name: "fixture",
        fileName: () => "fixture.js",
      },
    },
  });

  const script = await readFile(join(outDir, "fixture.js"), "utf8");

  /**
   * Any stylesheet the entry imported, inlined too.
   *
   * A `lib` build emits CSS as a sibling asset rather than injecting it, and a
   * fixture opened from `file://` will not fetch one. A component whose layout
   * is Tailwind — as the presenter camera's is — then mounts with `absolute`,
   * `size-6` and the rest as inert strings, and every geometry assertion
   * measures a stretched block in normal flow instead of the thing the
   * presenter sees.
   */
  const styles: string[] = [];
  for (const entry of await readdir(outDir)) {
    if (entry.endsWith(".css")) styles.push(await readFile(join(outDir, entry), "utf8"));
  }

  const html = join(outDir, "index.html");
  await writeFile(
    html,
    `<!doctype html><meta charset="utf-8"><title>fixture</title>` +
      (styles.length ? `<style>${styles.join("\n")}</style>` : "") +
      `<body style="margin:0;background:#000"><script>${script}</script></body>`,
  );
  return `file://${html}`;
}
