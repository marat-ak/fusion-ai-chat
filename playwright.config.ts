import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  retries: 0,
  // One mock pod with shared state (request log, one-shot expired relay): spec files must not run concurrently.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8000",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/mock-pod/server.mjs",
      port: 8787,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "MOCK_POD=1 npm run serve",
      port: 8000,
      timeout: 180000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
