import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config: workflow MOCK_WF on pod "mockpod", starters "fromWorkflow").
// Mock pod chat fixtures by message: "hello" (any other text too) -> "Hel","lo!" deltas, final "Hello! How can I help?"
// + follow-ups; "fail" -> error final "ErrorRecord[boom]". BOSS workflows -> starters "Show my invoices", "Create a PO".
const MOCK_POD = "http://localhost:8787";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };

async function mockRequests(page: Page): Promise<MockRequest[]> {
  const r = await page.request.get(`${MOCK_POD}/__mock/requests`);
  return (await r.json()) as MockRequest[];
}

async function chatRequests(page: Page): Promise<MockRequest[]> {
  return (await mockRequests(page)).filter((r) => r.url.includes("/chat"));
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId("gai-composer-input").fill(text);
  await page.getByTestId("gai-composer-send").click();
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
});

test("starters_from_workflow_render_and_send", async ({ page }) => {
  await page.goto("/");
  const starters = page.getByTestId("gai-starter");
  await expect(starters).toHaveText(["Show my invoices", "Create a PO"]);

  await starters.first().click();
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["Show my invoices"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(page.getByTestId("gai-starter")).toHaveCount(0);
  expect(((await chatRequests(page)).at(-1)?.body as { message?: string }).message).toBe("Show my invoices");
});

test("send_hello_streams_and_shows_followups", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-composer-input")).toBeEnabled();
  // Record every text the assistant bubble shows, so the streamed (partial) states are observable.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => {
      const b = document.querySelector('[data-testid="gai-bubble-assistant"]');
      const t = b?.textContent?.trim();
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["hello"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(page.getByTestId("gai-followup")).toHaveText(["Show invoices", "Create order"]);

  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.some((t) => t === "Hel" || t === "Hello!")).toBe(true);
  const chat = await chatRequests(page);
  expect(chat).toHaveLength(1);
  expect(chat[0].headers["accept"]).toBe("text/event-stream");
});

test("followup_click_sends_text", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "hello");
  const followup = page.getByTestId("gai-followup").filter({ hasText: "Show invoices" });
  await expect(followup).toBeVisible();

  await followup.click();
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["hello", "Show invoices"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?", "Hello! How can I help?"]);

  const chat = await chatRequests(page);
  expect(chat).toHaveLength(2);
  const last = chat[chat.length - 1].body as { message: string; conversationId: string };
  expect(last.message).toBe("Show invoices");
  expect(last.conversationId).toBe((chat[0].body as { conversationId: string }).conversationId);
});

test("error_reply_shows_error_bubble_and_reenables_composer", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "fail");
  await expect(page.getByTestId("gai-error")).toContainText("ErrorRecord[boom]");

  const input = page.getByTestId("gai-composer-input");
  await expect(input).toBeEnabled();
  await input.fill("hello");
  await expect(page.getByTestId("gai-composer-send")).toBeEnabled();
});

test("needs_input_makes_no_requests", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = {
      agent: { pod: "mockpod" },
      auth: { kind: "fusionShell" },
      protocol: { checkVersion: "2607100" },
    };
  });
  await page.goto("/");
  const panel = page.getByTestId("gai-state-panel");
  await expect(panel).toContainText("agent.workflowCode");
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);

  await page.waitForLoadState("networkidle");
  expect(await mockRequests(page)).toEqual([]);
});

test("relogin_banner_on_html_relay", async ({ page }) => {
  await page.goto("/");
  // The starters fetch has minted the BOSS token; the fusion-ai audience has no cached token on this fresh page,
  // so the relay that send() triggers is the first one after arming and gets the login HTML.
  await expect(page.getByTestId("gai-starter")).toHaveCount(2);
  await page.request.get(`${MOCK_POD}/fscmRestApi/tokenrelay?$mock=expired`);

  await sendText(page, "hello");
  const banner = page.getByTestId("gai-auth-banner");
  await expect(banner).toContainText("Session expired");
  await expect(page.getByTestId("gai-composer-input")).toBeDisabled();
  await expect(page.getByTestId("gai-composer-send")).toBeDisabled();

  await Promise.all([page.waitForEvent("load"), page.getByTestId("gai-auth-reload").click()]);
  await expect(page.getByTestId("gai-starter")).toHaveCount(2);
  await expect(page.getByTestId("gai-auth-banner")).toHaveCount(0);
});
