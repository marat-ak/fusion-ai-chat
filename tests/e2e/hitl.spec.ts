import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config). Mock pod chat fixtures: message "approve me" -> HUMAN wait
// "Approve the transfer?" (approval + feedback, callbackToken "cb-1", jobId "job-1", requestChangeMessage
// "What should change?"); message "wait for me" -> WAIT node "Waiting for the timer" (waitTimeInMinutes 1, callbackToken
// "cb-2", jobId "job-2", no approval/feedback flags); message "send me a file" -> HUMAN wait "Attach the invoice" (free-text
// reply: no approval, no feedback; callbackToken "cb-3", jobId "job-3"); any request carrying `resumeInput` -> final
// "Approved and done". Attachment flow steps as in files.spec.ts.
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

/**
 * The wait frame is the stream's last frame, so the reply ends right after it: the bar's controls must be usable at once
 * (no wait beyond the default expect timeout) and Approve must resume; the composer is usable after the resumed reply.
 */
async function approveRightAfterTheWait(page: Page): Promise<void> {
  await page.goto("/");
  await sendText(page, "approve me");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Approve the transfer?"]);
  const approve = page.getByTestId("gai-hitl-approve").locator("button");
  await expect(approve).toBeEnabled();
  await expect(page.getByTestId("gai-hitl-request-change").locator("button")).toBeEnabled();
  await approve.click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Approve the transfer?", "Approved and done"]);
  await expect(page.getByTestId("gai-hitl")).toHaveCount(0);
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toBeEnabled();
  const chat = await chatBodies(page);
  expect(chat).toHaveLength(2);
  expect(chat[1]).toMatchObject({ jobId: "job-1", resumeInput: { messageInstanceId: "cb-1", userResponse: "APPROVE_ACTION" } });
}

test("hitl_controls_usable_when_wait_and_end_arrive_in_one_chunk", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_REST_HELPER_MODE__: string }).__CHAT_REST_HELPER_MODE__ = "stream-one-chunk";
  });
  await approveRightAfterTheWait(page);
});

test("hitl_controls_usable_when_the_end_follows_the_wait_at_once", async ({ page }) => {
  await page.request.get(`${MOCK_POD}/__mock/arm?sseGap=0`);
  await approveRightAfterTheWait(page);
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
  // Files go with a free-text reply only.
  await expect(page.getByTestId("gai-attach")).toHaveCount(0);
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

test("free_text_wait_takes_files_alone_as_its_reply", async ({ page }) => {
  // The agent asked for a file through a HUMAN wait: the free-text reply carries the picked files (uploaded and linked to
  // the conversation first, as a message's) and, without text, resumes with an empty content, as Oracle's chat client
  // answers an input wait from its composer (`resumeInput.content` = the composer text, "" here).
  await page.goto("/");
  await sendText(page, "send me a file");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Attach the invoice"]);
  await expect(page.getByTestId("gai-hitl")).toBeVisible();
  await expect(page.getByTestId("gai-hitl-approve")).toHaveCount(0);
  const text = page.getByTestId("gai-hitl-free-text").locator("textarea");
  const send = page.getByTestId("gai-hitl-free-send").locator("button");
  await expect(text).toBeEnabled();
  await expect(send).toBeDisabled();

  await page.getByTestId("gai-attach-input").setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2048) });
  const chip = page.getByTestId("gai-attach-chip");
  await expect(chip).toHaveAttribute("data-state", "pending");
  await expect(text).toHaveValue("");
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Attach the invoice", "Approved and done"]);
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["send me a file", "invoice.pdf"]);
  await expect(page.getByTestId("gai-bubble-user").nth(1).getByTestId("gai-bubble-attachment")).toHaveText(["invoice.pdf"]);
  await expect(page.getByTestId("gai-hitl")).toHaveCount(0);
  await expect(page.getByTestId("gai-attach-chip")).toHaveCount(0);
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toBeEnabled();

  const log = ((await (await page.request.get(`${MOCK_POD}/__mock/requests`)).json()) as MockRequest[]).filter((r) => r.method === "POST");
  const hcm = "/hcmRestApi/rest/latest/en/11.13.18.05:9";
  const step = (r: MockRequest): string =>
    r.url.includes("/chat") ? "chat" : r.url === `${hcm}/` ? "batch" : r.url.split("/").filter((p) => p !== "").pop() ?? r.url;
  expect(log.map(step)).toEqual(["chat", "hcmAiStudioConversations", "attachDocTracker", "attachUpload", "batch", "chat"]);
  const chat = await chatBodies(page);
  expect(chat).toHaveLength(2);
  expect(chat[1]).toMatchObject({
    message: "",
    jobId: "job-3",
    conversationId: chat[0].conversationId,
    resumeInput: { messageInstanceId: "cb-3", userResponse: "RFI_ACTION", content: "" },
  });
});
