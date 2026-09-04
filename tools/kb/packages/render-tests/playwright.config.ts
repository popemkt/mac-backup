import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests-render",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined && process.env.CI !== "",
  retries: process.env.CI !== undefined && process.env.CI !== "" ? 1 : 0,
  timeout: 45_000,
  reporter: "list",
  globalSetup: "./tests-render/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4323",
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  },
});
