/**
 * Copies the MediaPipe vision wasm runtime from node_modules into public/ so
 * the segmenter loads same-origin under the app's CSP. The files are ~12MB
 * each, which is why they are staged at build time rather than committed —
 * public/mediapipe/ is gitignored. The model itself (public/models/*.tflite)
 * is small and committed, so a build without this step still type-checks and
 * the segmenter fails soft at runtime.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const target = join(root, "public", "mediapipe", "wasm");

if (!existsSync(source)) {
  console.warn(
    "[mediapipe] wasm assets not found in node_modules; segmentation will be unavailable",
  );
  process.exit(0);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log("[mediapipe] wasm runtime staged in public/mediapipe/wasm");
