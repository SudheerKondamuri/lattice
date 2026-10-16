import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3050";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  timeout: 90000,
  expect: { timeout: 15000 },
  outputDir: "e2e/results",
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  use: {
    baseURL,
    actionTimeout: 10000,
    navigationTimeout: 30000,
    screenshot: { mode: "only-on-failure", fullPage: true },
    trace: "retain-on-failure",
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 13 Mini"], browserName: "chromium" },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command:
            "LATTICE_FRONTEND_FIXTURES=1 node frontend-infra/fixture-server.mjs",
          url: "http://127.0.0.1:4410/health",
          reuseExistingServer: false,
          timeout: 30000,
        },
        {
          command:
            "NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4410 NEXT_PUBLIC_SUPABASE_ANON_KEY=isolated-fixture-public-key BACKEND_API_ORIGIN=http://127.0.0.1:4410 npm run dev -- --port 3050",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120000,
        },
      ],
});
