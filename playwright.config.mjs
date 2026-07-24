import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "output/playwright/results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI
    ? [["line"], ["html", {outputFolder: "output/playwright/report", open: "never"}]]
    : "line",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:2370",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01
    }
  },
  projects: [
    {
      name: "desktop",
      use: {...devices["Desktop Chrome"]}
    },
    {
      name: "mobile",
      use: {...devices["iPhone 13"], defaultBrowserType: "chromium"}
    }
  ]
});
