import { defineConfig, devices } from "@playwright/test";

// e2e of the debug host (spec §17.1): the debug-host RELEASE build as delivered in dist/debug-host/ (what agent-ui serves
// at /ai-chat-debug/) behind a fake of the engine's /api/pod proxy, in front of the mock pod. `npm run e2e:debug-host`
// (scripts/e2e.sh); the build runs first, so the dev host page's e2e (playwright.config.ts) and this one never share a
// run (both stage into web/).
export default defineConfig({
  testDir: "tests/e2e-debug-host",
  retries: 0,
  // One mock pod and one proxy log with shared state: spec files must not run concurrently.
  workers: 1,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:8790",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/mock-pod/server.mjs",
      port: 8787,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run build:debug-host && node tests/fake-pod-proxy/server.mjs",
      port: 8790,
      timeout: 600000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
