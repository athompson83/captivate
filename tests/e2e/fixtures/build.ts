import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build } from "vite";

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
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(process.cwd(), "src"),
        // No Next runtime exists in a file:// fixture; links render as links.
        "next/link": resolve(process.cwd(), "tests/e2e/fixtures/next-link-shim.tsx"),
      },
    },
    define: { "process.env.NODE_ENV": '"development"' },
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
