import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests-render",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined && process.env.CI !== "",
  // A retry would hide exactly the order and timing faults this suite exists
  // to surface; a flaky spec is fixed, never retried into green.
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  globalSetup: "./tests-render/global-setup.ts",
  use: {
    // Each test's `baseURL` is its own harness (`tests-render/harness-test.ts`).
    browserName: "chromium",
    // Chromium's new headless mode, not the headless shell: the shell hands
    // out a WebGPU adapter but cannot present to a canvas, so every WebGPU
    // scene stalls until its device is lost.
    channel: "chromium",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    // Headless Chromium hides WebGPU behind this flag. With it, a machine
    // that has an adapter proves the WebGPU path; one without falls back to
    // WebGL2, and the specs read which (`gpu` in harness-test.ts).
    launchOptions: { args: ["--enable-unsafe-webgpu"] },
  },
});
