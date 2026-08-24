import { chromium } from "@playwright/test";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";

const outDir = await mkdtemp(join(tmpdir(), "captivate-bench-"));
await build({
  root: process.cwd(),
  mode: "production",
  logLevel: "error",
  plugins: [react()],
  resolve: { alias: { "@": resolve(process.cwd(), "src") } },
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(process.cwd(), "tests/bench/segmentation-bench.tsx"),
      formats: ["iife"],
      name: "bench",
      fileName: () => "bench.js",
    },
  },
});
const script = await readFile(join(outDir, "bench.js"), "utf8");

// Serve the app's real public assets, so the wasm runtime and the model come
// from the same place they do in production.
const PUBLIC = resolve(process.cwd(), "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".tflite": "application/octet-stream",
};
const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><meta charset=utf-8><body><script>${script}</script></body>`);
    return;
  }
  try {
    const body = await readFile(join(PUBLIC, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(3199, r));

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("PAGE ERROR:", m.text());
});
await page.goto("http://127.0.0.1:3199/");
const result = await page.evaluate((n) => window.runBench(n), Number(process.argv[2] ?? 120));
console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
