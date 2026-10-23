import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config: files.enabled, person-id "-1", hcmRestBase
// "/hcmRestApi/rest/latest/en/11.13.18.05:9", limits 5 files / 50 MB). Mock pod attachment endpoints:
// hcmAiStudioConversations -> 201, attachDocTracker -> {trackers:[{trackerId:"trk-1"}], username:"test.user"},
// attachUpload -> 200 (GET /__mock/arm?attachUpload=<status> makes the next one fail once), ADF batch on
// `${hcmRestBase}/` -> 200. JSON bodies are recorded parsed, others as text.
const MOCK_POD = "http://localhost:8787";
const HCM_REST_BASE = "/hcmRestApi/rest/latest/en/11.13.18.05:9";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };

async function mockRequests(page: Page): Promise<MockRequest[]> {
  const r = await page.request.get(`${MOCK_POD}/__mock/requests`);
  return (await r.json()) as MockRequest[];
}

/** The attachment flow and chat calls only (the log also holds BOSS list/workflow and name lookups). */
function flowStep(r: MockRequest): string | null {
  if (r.method !== "POST") return null;
  if (r.url === `${HCM_REST_BASE}/hcmAiStudioConversations`) return "hcmAiStudioConversations";
  if (r.url === "/fscmRestApi/applcoreApi/v1/attachDocTracker/") return "attachDocTracker";
  if (r.url === "/fscmRestApi/applcoreApi/v1/attachUpload") return "attachUpload";
  if (r.url === `${HCM_REST_BASE}/`) return "batch";
  if (r.url.includes("/chat")) return "chat";
  return null;
}

// The testids of Core Pack (oj-c) controls sit on the custom element: typing, clicks and enabled/disabled checks go to its
// inner <textarea>/<input>/<button> (a click on the custom element would not wait for the inner control to be enabled).
const file = (name: string, mimeType: string, size: number) => ({ name, mimeType, buffer: Buffer.alloc(size) });

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK_POD}/__mock/reset`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
});

test("upload_then_send_performs_oracle_sequence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-attach").locator("button")).toBeEnabled();
  await page.getByTestId("gai-attach-input").setInputFiles(file("test.pdf", "application/pdf", 10240));
  const chip = page.getByTestId("gai-attach-chip");
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText("test.pdf");
  await expect(chip).toContainText("10 KB");
  await expect(chip).toHaveAttribute("data-state", "pending");
  await expect(page.getByTestId("gai-attach-rejected")).toHaveCount(0);
  // Nothing is uploaded at selection: the flow runs on send.
  expect((await mockRequests(page)).map(flowStep).filter((s) => s !== null)).toEqual([]);

  await page.getByTestId("gai-composer-input").locator("textarea").fill("summarize the file");
  await page.getByTestId("gai-composer-send").locator("button").click();

  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  const userBubble = page.getByTestId("gai-bubble-user");
  await expect(userBubble).toHaveCount(1);
  await expect(userBubble).toContainText("summarize the file");
  await expect(userBubble.getByTestId("gai-bubble-attachment")).toHaveText(["test.pdf"]);
  await expect(page.getByTestId("gai-attach-chip")).toHaveCount(0);

  const log = await mockRequests(page);
  expect(log.map(flowStep).filter((s) => s !== null)).toEqual([
    "hcmAiStudioConversations", "attachDocTracker", "attachUpload", "batch", "chat",
  ]);
  const step = (name: string) => log.find((r) => flowStep(r) === name) as MockRequest;
  const conversationId = (step("chat").body as { conversationId: string }).conversationId;

  expect(step("hcmAiStudioConversations").body).toEqual({
    ConversationId: conversationId, PersonId: "-1", ObjectCode: "MOCK_WF", ObjectType: "AGENT_TEAM",
  });
  const tracker = step("attachDocTracker").body as Array<Record<string, unknown>>;
  expect(tracker).toHaveLength(1);
  expect(tracker[0]).toMatchObject({ filename: "test.pdf", mimetype: "application/pdf", size: 10240 });
  expect(typeof tracker[0].clientfileid).toBe("number");

  const upload = step("attachUpload");
  expect(upload.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  expect(upload.body as string).toContain('name="tracker"\r\n\r\ntrk-1');
  expect(upload.body as string).toContain('name="user"\r\n\r\ntest.user');

  const batch = step("batch");
  expect(batch.headers["content-type"]).toBe("application/vnd.oracle.adf.batch+json");
  expect(batch.body).toEqual({
    parts: [{
      id: "attachment_1",
      operation: "create",
      path: `/hcmAiStudioConversations/${conversationId}/child/Attachments`,
      payload: {
        AsyncTrackerId: "trk-1",
        CategoryName: null,
        ContentRepositoryFileShared: "false",
        DatatypeCode: "FILE",
        FileName: "test.pdf",
        Title: "test.pdf",
        UploadedFileName: "test.pdf",
      },
    }],
  });
  expect((step("chat").body as { message: string }).message).toBe("summarize the file");
});

test("failed_upload_blocks_send_and_marks_chip", async ({ page }) => {
  await page.request.get(`${MOCK_POD}/__mock/arm?attachUpload=500`);
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as unknown as { __chatErrors: unknown[] };
    w.__chatErrors = [];
    document.getElementById("chat")!.addEventListener("aiChatError", (e) => w.__chatErrors.push((e as CustomEvent).detail));
  });
  await page.getByTestId("gai-attach-input").setInputFiles(file("test.pdf", "application/pdf", 10240));
  const input = page.getByTestId("gai-composer-input").locator("textarea");
  await input.fill("hello");
  await page.getByTestId("gai-composer-send").locator("button").click();

  const chip = page.getByTestId("gai-attach-chip");
  await expect(chip).toHaveAttribute("data-state", "failed");
  await expect(chip).toContainText("attachment upload HTTP 500");
  await expect(input).toHaveValue("hello");
  await expect(input).toBeEnabled();
  await expect(page.getByTestId("gai-composer-send").locator("button")).toBeEnabled();
  await expect(page.getByTestId("gai-bubble-user")).toHaveCount(0);

  const errors = await page.evaluate(() => (window as unknown as { __chatErrors: Array<{ message: string; status?: number }> }).__chatErrors);
  expect(errors).toHaveLength(1);
  expect(errors[0].status).toBe(500);
  expect(errors[0].message).toContain("attachment upload HTTP 500");
  // The flow stopped at the failed upload: no batch link, no chat.
  expect((await mockRequests(page)).map(flowStep).filter((s) => s !== null)).toEqual([
    "hcmAiStudioConversations", "attachDocTracker", "attachUpload",
  ]);
});

test("files_disabled_hides_attach_ui", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = {
      agent: { workflowCode: "MOCK_WF" },
      auth: { kind: "fusionShell" },
      protocol: { checkVersion: "2607100", hcmRestBase: "/hcmRestApi/rest/latest/en/11.13.18.05:9" },
      ui: { starterQuestions: "fromWorkflow" },
      files: { enabled: false },
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toBeEnabled();
  await expect(page.getByTestId("gai-attach")).toHaveCount(0);
  await expect(page.getByTestId("gai-attach-input")).toHaveCount(0);

  await page.getByTestId("gai-composer-input").locator("textarea").fill("hello");
  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  expect((await mockRequests(page)).map(flowStep).filter((s) => s !== null)).toEqual(["chat"]);
});

test("sixth_file_is_rejected_with_count_reason", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("gai-attach-input").setInputFiles(
    ["a", "b", "c", "d", "e", "f"].map((n) => file(`${n}.pdf`, "application/pdf", 1024)),
  );
  const chips = page.getByTestId("gai-attach-chip");
  await expect(chips).toHaveCount(5);
  await expect(chips.locator(".gai-attach-name")).toHaveText(["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"]);
  const rejected = page.getByTestId("gai-attach-rejected");
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toContainText("too many files");
  await expect(rejected).toHaveText("f.pdf: too many files");

  // Removing a chip frees a slot.
  await chips.first().getByTestId("gai-attach-remove").locator("button").click();
  await expect(chips).toHaveCount(4);
});

test("txt_oversize_is_rejected", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = {
      agent: { workflowCode: "MOCK_WF" },
      auth: { kind: "fusionShell" },
      protocol: { checkVersion: "2607100", hcmRestBase: "/hcmRestApi/rest/latest/en/11.13.18.05:9" },
      ui: { starterQuestions: "fromWorkflow" },
      files: { enabled: true, maxSizeMB: 1 },
    };
  });
  await page.goto("/");
  await page.getByTestId("gai-attach-input").setInputFiles(file("big.txt", "text/plain", 2 * 1024 * 1024));
  await expect(page.getByTestId("gai-attach-rejected")).toHaveText(["big.txt: too large (max 1 MB)"]);
  await expect(page.getByTestId("gai-attach-chip")).toHaveCount(0);
});
