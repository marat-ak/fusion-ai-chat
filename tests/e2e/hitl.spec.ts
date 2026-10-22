import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config). Mock pod chat fixtures: message "approve me" -> HUMAN wait
// "Approve the transfer?" (approval + feedback, callbackToken "cb-1", jobId "job-1", requestChangeMessage
// "What should change?"); any request carrying `resumeInput` -> final "Approved and done".
const MOCK_POD = "http://localhost:8787";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };
type ChatBody = {
  message: string;
  conversationId: string;
  jobId?: string;
  resumeInput?: { messageInstanceId: string; userResponse: string; content?: string };
  statusCheckOnly?: boolean;
};

async function chatBodies(page: Page): Promise<ChatBody[]> {
  const r = await page.request.get(`${MOCK_POD}/__mock/requests`);
  return ((await r.json()) as MockRequest[]).filter((q) => q.url.includes("/chat")).map((q) => q.body as ChatBody);
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId("gai-composer-input").fill(text);
  await page.getByTestId("gai-composer-send").click();
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
  await expect(page.getByTestId("gai-hitl-approve")).toBeEnabled();
  await expect(page.getByTestId("gai-hitl-request-change")).toBeEnabled();
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
  await page.getByTestId("gai-hitl-approve").click();

  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Approve the transfer?", "Approved and done"]);
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["approve me", "Approved"]);
  await expect(page.getByTestId("gai-hitl")).toHaveCount(0);
  await expect(page.getByTestId("gai-composer-input")).toBeEnabled();

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

test("request_change_sends_rfi_with_content", async ({ page }) => {
  await waitForApproval(page);
  await page.getByTestId("gai-hitl-request-change").click();
  const text = page.getByTestId("gai-hitl-change-text");
  await expect(text).toBeVisible();
  await expect(text).toHaveAttribute("placeholder", "What should change?");
  const send = page.getByTestId("gai-hitl-change-send");
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
