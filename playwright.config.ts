import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * Tests are split into two projects:
 *   - `smoke` runs against any deployment, configured or not, and covers the
 *     paths that do not need an account.
 *   - `authenticated` covers the real user journeys and is skipped unless
 *     CAPTIVATE_E2E_EMAIL / CAPTIVATE_E2E_PASSWORD are set, so the suite never
 *     fails misleadingly on a machine without credentials.
 */
const baseURL = process.env.CAPTIVATE_E2E_URL ?? "http://127.0.0.1:3100";

/**
 * Some environments provision Chromium at a fixed path that does not match the
 * build this Playwright version would download. Point at it when it exists,
 * and fall back to Playwright's own browser everywhere else.
 */
const PROVISIONED_CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath = existsSync(PROVISIONED_CHROMIUM) ? PROVISIONED_CHROMIUM : undefined;

/**
 * Projects that need no running application.
 *
 * `shader` compiles the committed GLSL on a bare canvas; `lifecycle` bundles
 * the atmosphere component and opens it from the file system. Requiring a
 * production build to run either would make the cheapest, most diagnostic
 * tests in the suite the most expensive ones to reach.
 */
const SERVERLESS = new Set(["shader", "lifecycle"]);

function selectedProjects(): string[] {
  const names: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    const argument = process.argv[i];
    if (argument.startsWith("--project=")) names.push(argument.slice("--project=".length));
    else if (argument === "--project" && process.argv[i + 1]) names.push(process.argv[i + 1]);
  }
  return names;
}

const chosen = selectedProjects();
const needsServer = chosen.length === 0 || chosen.some((name) => !SERVERLESS.has(name));

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Camera, microphone and screen capture are all permission-gated; the
    // recording tests grant what they can and assert the fallback otherwise.
    permissions: [],
  },

  projects: [
    {
      name: "smoke",
      testMatch: /(smoke|accessibility)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
    {
      // The shader, compiled and rendered from source. Needs no server and no
      // account: it draws the committed GLSL on a bare canvas and reads the
      // pixels back.
      name: "shader",
      testMatch: /atmosphere\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath,
          // CI has no GPU. The field is a gradient; software rendering draws
          // it correctly, which is the whole point of accepting such a context
          // at runtime too.
          args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
    {
      // Real components, bundled from source and mounted in a real browser,
      // for the defects that only exist there: the atmosphere's WebGL context
      // across a StrictMode remount, and a contentEditable's caret across a
      // store write. Neither needs a server or an account.
      name: "lifecycle",
      testMatch:
        /(atmosphere-lifecycle|inline-editing|shared-viewer|presenter-camera|recording-quality|deck-export|reference-read|composition|editor|editor-narrow|dialog-focus)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath,
          args: [
            "--use-gl=swiftshader",
            "--enable-unsafe-swiftshader",
            // A camera, without hardware: the presenter-camera spec drives a
            // real getUserMedia track through real pointer capture.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
    {
      name: "authenticated",
      testMatch: /journey\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath,
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--auto-accept-this-tab-capture",
          ],
        },
      },
    },
  ],

  webServer:
    process.env.CAPTIVATE_E2E_URL || !needsServer
      ? undefined
      : {
          command: "npm run start -- -p 3100",
          url: "http://127.0.0.1:3100",
          reuseExistingServer: true,
          timeout: 120_000,
        },
});
