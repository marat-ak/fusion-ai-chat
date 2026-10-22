import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config). Mock pod chat fixtures: message "approve me" -> HUMAN wait
// "Approve the transfer?" (approval + feedback, callbackToken "cb-1", jobId "job-1", requestChangeMessage
// "What should change?"); message "wait for me" -> WAIT node "Waiting for the timer" (waitTimeInMinutes 1, callbackToken
// "cb-2", jobId "job-2", no approval/feedback flags); any request carrying `resumeInput` -> final "Approved and done".
const MOCK_POD = "http://localhost:8787";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };
type ChatBody = {
  message: string;
  conversationId: string;
  jobId?: string;
  resumeInput?: { messageInstanceId: string; userResponse: string; content?: string };
  statusCheckOnly?: boolean;
};

// The testids of Core Pack (oj-c) controls sit on the custom element: typing, clicks and enabled/disabled checks go to its
// inner <textarea>/<input>/<button> (a click on the custom element would not wait for the inner control to be enabled).
async function chatBodies(page: Page): Promise<ChatBody[]> {
  const r = await page.request.get(`${MOCK_POD}/__mock/requests`);
  return ((await r.json()) as MockRequest[]).filter((q) => q.url.includes("/chat")).map((q) => q.body as ChatBody);
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId("gai-composer-input").locator("textarea").fill(text);
  await page.getByTestId("gai-composer-send").locator("button").click();
}

async function waitForApproval(page: Page): Promise<void> {
  await page.goto("/");
  await sendText(page, "approve me");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Approve the transfer?"]);
  await expect(page.getByTestId("gai-hitl")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK_POD}/__mock/reset`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
});

test("wait_reply_shows_approve_and_request_change", async ({ page }) => {
  await waitForApproval(page);
  await expect(page.getByTestId("gai-hitl-approve").locator("button")).toBeEnabled();
  await expect(page.getByTestId("gai-hitl-request-change").locator("button")).toBeEnabled();
  // approval + feedback: no Reject, no free text, no countdown; the bar replaces the composer.
  await expect(page.getByTestId("gai-hitl-reject")).toHaveCount(0);
  await expect(page.getByTestId("gai-hitl-free-text")).toHaveCount(0);
  await expect(page.getByTestId("gai-hitl-countdown")).toHaveCount(0);
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);
  // The change textarea opens only on "Request change".
  await expect(page.getByTestId("gai-hitl-change-text")).toHaveCount(0);
});

test("approve_sends_resumeInput_and_streams_result", async ({ page }) => {
  await waitForApproval(page);
  await page.getByTestId("gai-hitl-approve").locator("button").click();

  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Approve the transfer?", "Approved and done"]);
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["approve me", "Approved"]);
  await expect(page.getByTestId("gai-hitl")).toHaveCount(0);
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toBeEnabled();

  const chat = await chatBodies(page);
  expect(chat).toHaveLength(2);
  expect(chat[1]).toMatchObject({
    message: "",
    jobId: "job-1",
    conversationId: chat[0].conversationId,
    resumeInput: { messageInstanceId: "cb-1", userResponse: "APPROVE_ACTION" },
  });
  expect(chat[1].resumeInput?.content).toBeUndefined();
  expect(chat[1].statusCheckOnly).toBeUndefined();
});

test("wait_timer_counts_down_then_refresh_sends_status_check", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await sendText(page, "wait for me");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Waiting for the timer"]);
  await expect(page.getByTestId("gai-hitl")).toBeVisible();

  // 1 min + 15 s; every control stays disabled and no Refresh is offered until the countdown ends.
  const countdown = page.getByTestId("gai-hitl-countdown");
  await expect(countdown).toHaveText(/^01:1[45]$/);
  await expect(page.getByTestId("gai-hitl-free-text").locator("textarea")).toBeDisabled();
  await expect(page.getByTestId("gai-hitl-free-send").locator("button")).toBeDisabled();
  await expect(page.getByTestId("gai-hitl-approve")).toHaveCount(0);
  await expect(page.getByTestId("gai-hitl-refresh")).toHaveCount(0);

  await page.clock.fastForward(60_000);
  await expect(countdown).toHaveText(/^00:1[345]$/);
  await page.clock.fastForward(15_000);
  await expect(countdown).toHaveCount(0);
  const refresh = page.getByTestId("gai-hitl-refresh").locator("button");
  await expect(refresh).toBeEnabled();
  await refresh.click();

  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Waiting for the timer", "Approved and done"]);
  // A status check is not a user message: no new user bubble.
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["wait for me"]);
  await expect(page.getByTestId("gai-hitl")).toHaveCount(0);

  const chat = await chatBodies(page);
  expect(chat).toHaveLength(2);
  expect(chat[1]).toMatchObject({
    message: "",
    jobId: "job-2",
    conversationId: chat[0].conversationId,
    statusCheckOnly: true,
    resumeInput: { messageInstanceId: "cb-2", userResponse: "RFI_ACTION" },
  });
  expect(chat[1].resumeInput?.content).toBeUndefined();
});

test("request_change_sends_rfi_with_content", async ({ page }) => {
  await waitForApproval(page);
  await page.getByTestId("gai-hitl-request-change").locator("button").click();
  const text = page.getByTestId("gai-hitl-change-text").locator("textarea");
  await expect(text).toBeVisible();
  await expect(text).toHaveAttribute("placeholder", "What should change?");
  const send = page.getByTestId("gai-hitl-change-send").locator("button");
  await expect(send).toBeDisabled();

  await text.fill("Use account 42");
  await send.click();

  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["approve me", "Use account 42"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Approve the transfer?", "Approved and done"]);
  await expect(page.getByTestId("gai-hitl")).toHaveCount(0);

  const chat = await chatBodies(page);
  expect(chat).toHaveLength(2);
  expect(chat[1]).toMatchObject({
    message: "",
    jobId: "job-1",
    conversationId: chat[0].conversationId,
    resumeInput: { messageInstanceId: "cb-1", userResponse: "RFI_ACTION", content: "Use account 42" },
  });
});
