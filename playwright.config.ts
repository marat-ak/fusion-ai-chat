import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  retries: 0,
  // One mock pod with shared state (request log, one-shot expired relay): spec files must not run concurrently.
  workers: 1,
  reporter: "list",
  // The host page runs the debug build: every JET/oj-c module is a separate AMD request (~700 per page load), so the chat
  // is ready 2-7 s after goto depending on host load. The default 5 s made first-render expectations flaky.
  expect: { timeout: 15_000 },
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
