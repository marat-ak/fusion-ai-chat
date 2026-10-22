import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  retries: 0,
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
