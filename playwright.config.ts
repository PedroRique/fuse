import { defineConfig, devices } from "@playwright/test";

// E2E runs against the dev server (time travel only exists in development) and local Supabase.
// Serial: the dev clock offset is global to the local database.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:4317",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:4317/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
