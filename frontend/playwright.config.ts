import { defineConfig } from "@playwright/test";

// Expects the backend (port 8000) and frontend (port 3000) to be running already.
// Uses the Microsoft Edge that ships with Windows, so no browser download is needed.
// On a machine without Edge, run `npx playwright install chromium` and remove `channel`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    channel: "msedge",
    viewport: { width: 1366, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
