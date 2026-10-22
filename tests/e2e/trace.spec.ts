import { expect, test, type Page } from "@playwright/test";

// Mock pod chat-hello.sse starts with three nodeProgressMessage frames (START, CHAT_LLM start, START end; traceId trace-1).
const TRACE_CONFIG = {
  agent: { workflowCode: "MOCK_WF", pod: "mockpod" },
  auth: { kind: "fusionShell" },
  protocol: { checkVersion: "2607100", hcmRestBase: "/hcmRestApi/rest/latest/en/11.13.18.05:9" },
  ui: { starterQuestions: "fromWorkflow", trace: { roles: ["AGENT_DEBUG"] } },
  files: { enabled: true },
};

async function setup(page: Page, opts: { config?: object; roles?: string[] }): Promise<void> {
  await page.addInitScript((o) => {
    const w = window as unknown as { __CHAT_CONFIG__?: object; __CHAT_USER__?: object };
    if (o.config) w.__CHAT_CONFIG__ = o.config;
    if (o.roles) w.__CHAT_USER__ = { userName: "test.user@example.com", roles: o.roles };
  }, opts);
  await page.goto("/");
}

// The testids of Core Pack (oj-c) controls sit on the custom element: typing and enabled/disabled checks go to its inner
// <textarea>/<input>/<button>.
// The testids of Core Pack (oj-c) controls sit on the custom element: typing and clicks go to its inner <textarea>/<button>.
async function reply(page: Page): Promise<void> {
  await page.getByTestId("gai-composer-input").locator("textarea").fill("hello");
  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
}

test("trace_hidden_without_role", async ({ page }) => {
  await setup(page, {});
  await reply(page);
  await expect(page.getByTestId("gai-trace-toggle")).toHaveCount(0);
});

test("trace_hidden_when_role_mismatch", async ({ page }) => {
  await setup(page, { config: TRACE_CONFIG, roles: ["OTHER"] });
  await reply(page);
  await expect(page.getByTestId("gai-trace-toggle")).toHaveCount(0);
});

test("trace_visible_with_role_and_expands", async ({ page }) => {
  await setup(page, { config: TRACE_CONFIG, roles: ["OTHER", "AGENT_DEBUG"] });
  await reply(page);
  const toggle = page.getByTestId("gai-trace-toggle");
  await expect(toggle).toHaveText("Trace (3)");
  await expect(page.getByTestId("gai-trace")).toHaveCount(0);
  await toggle.click();
  const rows = page.getByTestId("gai-trace-row");
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-node-type")))).toEqual(["NODE_START", "NODE_START", "NODE_END"]);
  await expect(rows.nth(1)).toContainText("CHAT_LLM");
  await expect(page.getByTestId("gai-trace-id")).toContainText("trace-1");
});
