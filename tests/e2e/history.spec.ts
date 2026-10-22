import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config: workflow MOCK_WF, user test.user@example.com, ui.conversations on).
// Mock pod BOSS rows (tests/mock-pod/fixtures/conversations.json): conv-1 "Invoice questions", conv-2 "Purchase order draft",
// broken "Broken history"; all carry etag "1". Messages: conv-1 -> fixture (newest first on the wire), broken -> HTTP 500,
// any other id -> empty. The rows live in the mock's memory, so every test starts from POST /__mock/reset.
const MOCK_POD = "http://localhost:8787";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };

async function mockRequests(page: Page): Promise<MockRequest[]> {
  const r = await page.request.get(`${MOCK_POD}/__mock/requests`);
  return (await r.json()) as MockRequest[];
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId("gai-composer-input").fill(text);
  await page.getByTestId("gai-composer-send").click();
}

const row = (page: Page, id: string) => page.locator(`[data-testid="gai-conv-row"][data-conv-id="${id}"]`);
const currentRow = (page: Page) => page.locator('[data-testid="gai-conv-row"][aria-current="true"]');
const componentConversationId = (page: Page) =>
  page.evaluate(() => (document.getElementById("chat") as unknown as { conversationId?: string }).conversationId);
/** GETs of one conversation's BOSS row (the controller's name lookup). */
const nameLookups = async (page: Page, id: string) =>
  (await mockRequests(page)).filter((r) => r.method === "GET" && r.url.includes(`/userConversations/${id}?`));

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK_POD}/__mock/reset`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
});

test("sidebar_lists_conversations_from_boss", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-sidebar")).toBeVisible();
  const rows = page.getByTestId("gai-conv-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator(".gai-conv-name")).toHaveText(["Invoice questions", "Purchase order draft", "Broken history"]);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-conv-id")))).toEqual(["conv-1", "conv-2", "broken"]);
  const expectedDate = await page.evaluate(() =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date("2026-10-20T09:05:00.000Z")));
  await expect(row(page, "conv-1").locator(".gai-conv-date")).toHaveText(expectedDate);
  // The fresh conversation has no row yet, so no row is current.
  await expect(currentRow(page)).toHaveCount(0);

  const list = (await mockRequests(page)).filter((r) => r.method === "GET" && r.url.includes("/userConversations?"));
  expect(list).toHaveLength(1);
  const url = decodeURIComponent(list[0].url);
  expect(url).toContain("objectType='AGENT_TEAM' and createdBy~='test.user@example.com' and objectCode ~= 'MOCK_WF'");
  expect(url).toContain("$offset=0");
  expect(list[0].headers["authorization"]).toMatch(/^Bearer /);
});

test("open_conversation_renders_messages_oldest_first", async ({ page }) => {
  await page.goto("/");
  await row(page, "conv-1").click();

  await expect(page.locator(".gai-feed .gai-bubble")).toHaveText([
    "hello",
    "Hello! How can I help?",
    "Show my invoices",
    "You have 3 open invoices.",
  ]);
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["hello", "Show my invoices"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?", "You have 3 open invoices."]);
  await expect(currentRow(page)).toHaveAttribute("data-conv-id", "conv-1");
  await expect(page.getByTestId("gai-history-loading")).toHaveCount(0);
  await expect(page.getByTestId("gai-history-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("gai-starter")).toHaveCount(0);
  expect(await componentConversationId(page)).toBe("conv-1");
  const msgs = async () => (await mockRequests(page)).filter((r) => r.url.endsWith("/orchestrator/conversations/v1/conv-1/messages"));
  expect(await msgs()).toHaveLength(1);

  // Clicking the open conversation's row again does not reload it (a reload would be requested at once).
  await row(page, "conv-1").click();
  await page.waitForTimeout(300);
  expect(await msgs()).toHaveLength(1);
  await expect(page.locator(".gai-feed .gai-bubble")).toHaveCount(4);
});

test("open_broken_conversation_shows_unavailable_and_can_send", async ({ page }) => {
  await page.goto("/");
  await row(page, "broken").click();
  // The mock answers {"detail":"boom"}: the notice carries the readable error body.
  await expect(page.getByTestId("gai-history-unavailable")).toHaveText("History unavailable (HTTP 500): boom");
  await expect(currentRow(page)).toHaveAttribute("data-conv-id", "broken");
  await expect(page.locator(".gai-feed .gai-bubble")).toHaveCount(0);

  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["hello"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(page.getByTestId("gai-followup")).toHaveText(["Show invoices", "Create order"]);
  // The notice stays at the top of the feed, above the turns sent after it.
  await expect(page.locator(".gai-feed > :first-child")).toHaveAttribute("data-testid", "gai-history-unavailable");
  const chat = (await mockRequests(page)).filter((r) => r.url.includes("/chat"));
  expect(chat).toHaveLength(1);
  expect((chat.at(-1)?.body as { conversationId?: string }).conversationId).toBe("broken");
});

test("rename_sends_patch_with_if_match", async ({ page }) => {
  await page.goto("/");
  const r = row(page, "conv-2");
  const input = r.getByTestId("gai-conv-rename-input");

  // Escape cancels without a request.
  await r.getByTestId("gai-conv-rename").click();
  await expect(input).toHaveValue("Purchase order draft");
  await input.fill("Not this");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(r.locator(".gai-conv-name")).toHaveText("Purchase order draft");

  // Enter saves.
  await r.getByTestId("gai-conv-rename").click();
  await input.fill("Renamed");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(r.locator(".gai-conv-name")).toHaveText("Renamed");

  const log = await mockRequests(page);
  const patches = log.filter((x) => x.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(patches[0].url).toMatch(/\/userConversations\/conv-2$/);
  expect(patches[0].headers["if-match"]).toBe('"1"');
  expect(patches[0].body).toEqual({ name: "Renamed" });
  // The row controls do not open the conversation.
  expect(log.filter((x) => x.url.includes("/conversations/v1/"))).toHaveLength(0);
  await expect(currentRow(page)).toHaveCount(0);
});

test("delete_removes_row", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(3);

  // First click only arms the confirm; the second one deletes.
  const del = row(page, "conv-2").getByTestId("gai-conv-delete");
  await del.click();
  await expect(row(page, "conv-2")).toHaveCount(1);
  expect((await mockRequests(page)).filter((x) => x.method === "DELETE")).toHaveLength(0);
  await del.click();
  await expect(row(page, "conv-2")).toHaveCount(0);
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(2);

  const dels = (await mockRequests(page)).filter((x) => x.method === "DELETE");
  expect(dels).toHaveLength(1);
  expect(dels[0].url).toMatch(/\/userConversations\/conv-2$/);
  expect(dels[0].headers["if-match"]).toBe('"1"');

  // Deleting the open conversation starts a new one.
  await row(page, "conv-1").click();
  await expect(page.getByTestId("gai-bubble-user")).toHaveCount(2);
  await row(page, "conv-1").getByTestId("gai-conv-delete").click();
  await row(page, "conv-1").getByTestId("gai-conv-delete").click();
  await expect(row(page, "conv-1")).toHaveCount(0);
  await expect(page.locator(".gai-feed .gai-bubble")).toHaveCount(0);
  await expect.poll(() => componentConversationId(page)).toMatch(UUID_V4);

  // The pod agrees: a reload lists the remaining row only.
  await page.reload();
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(1);
  await expect(row(page, "broken")).toHaveCount(1);
});

test("new_conversation_mints_uuid_and_emits_event", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(3);
  const initial = await componentConversationId(page);
  await page.evaluate(() => {
    document.getElementById("chat")!.addEventListener("aiChatConversationChanged", (e) => {
      (window as unknown as { __lastConv: string }).__lastConv = (e as CustomEvent<{ conversationId: string }>).detail.conversationId;
    });
  });

  await page.getByTestId("gai-conv-new").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lastConv?: string }).__lastConv)).toMatch(UUID_V4);
  const minted = await page.evaluate(() => (window as unknown as { __lastConv: string }).__lastConv);
  expect(minted).not.toBe(initial);
  expect(await componentConversationId(page)).toBe(minted);
});

test("first_reply_of_new_conversation_looks_up_its_name", async ({ page }) => {
  const text = "Please list every open invoice for the supplier Acme Corporation";
  await page.goto("/");
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(3);
  const id = (await componentConversationId(page)) as string;

  await sendText(page, text);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  // The new conversation leads the list under its local title (first 42 characters + an ellipsis) and is current.
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(4);
  await expect(page.getByTestId("gai-conv-row").first()).toHaveAttribute("data-conv-id", id);
  await expect(currentRow(page)).toHaveAttribute("data-conv-id", id);
  await expect(currentRow(page).locator(".gai-conv-name")).toHaveText(text.slice(0, 42) + "…");
  // After the first reply the pod is asked for the name once (the mock has no row: the local title stays).
  await expect.poll(async () => (await nameLookups(page, id)).length).toBe(1);
  expect((await nameLookups(page, id))[0].url).toContain("$fields=name");
});

test("first_reply_survives_list_reload_race", async ({ page }) => {
  // The mount-time list answers 1.5 s late, i.e. after the first reply of the new conversation has completed.
  await page.request.get(`${MOCK_POD}/__mock/arm?listDelay=1500`);
  await page.goto("/");
  await page.getByTestId("gai-starter").first().click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  const id = (await componentConversationId(page)) as string;

  // Once the delayed page arrives, the local row of the conversation is kept, first and current.
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(4);
  await expect(page.getByTestId("gai-conv-row").first()).toHaveAttribute("data-conv-id", id);
  await expect(currentRow(page)).toHaveAttribute("data-conv-id", id);
  await expect(currentRow(page).locator(".gai-conv-name")).toHaveText("Show my invoices");
  await expect.poll(async () => (await nameLookups(page, id)).length).toBe(1);
});

test("name_lookup_waits_for_first_successful_reply", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(3);
  const id = (await componentConversationId(page)) as string;

  await sendText(page, "fail");
  await expect(page.getByTestId("gai-error")).toContainText("ErrorRecord[boom]");
  await expect(page.getByTestId("gai-composer-input")).toBeEnabled();
  expect(await nameLookups(page, id)).toHaveLength(0);

  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect.poll(async () => (await nameLookups(page, id)).length).toBe(1);
  // A third reply does not ask again: the lookup answered (no row yet, so the local title stays).
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?", "Hello! How can I help?"]);
  await page.waitForTimeout(300);
  expect(await nameLookups(page, id)).toHaveLength(1);
  await expect(currentRow(page).locator(".gai-conv-name")).toHaveText("fail");
});

test("host_conversation_id_at_mount_loads_history", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "conv-1"; });
  await page.goto("/");
  await expect(page.locator(".gai-feed .gai-bubble")).toHaveText([
    "hello",
    "Hello! How can I help?",
    "Show my invoices",
    "You have 3 open invoices.",
  ]);
  await expect(currentRow(page)).toHaveAttribute("data-conv-id", "conv-1");
  expect(await componentConversationId(page)).toBe("conv-1");
  const msgs = (await mockRequests(page)).filter((r) => r.url.endsWith("/orchestrator/conversations/v1/conv-1/messages"));
  expect(msgs).toHaveLength(1);
});

test("host_conversation_id_unknown_to_pod_starts_fresh", async ({ page }) => {
  // A host-minted id: empty history and no BOSS row, so its first reply adds and names a row like a new conversation.
  await page.addInitScript(() => { (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "host-new-1"; });
  await page.goto("/");
  await expect(page.getByTestId("gai-conv-row")).toHaveCount(3);
  await expect(page.getByTestId("gai-history-loading")).toHaveCount(0);
  await expect(currentRow(page)).toHaveCount(0);

  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(currentRow(page)).toHaveAttribute("data-conv-id", "host-new-1");
  await expect(currentRow(page).locator(".gai-conv-name")).toHaveText("hello");
  await expect.poll(async () => (await nameLookups(page, "host-new-1")).length).toBe(1);
  const chat = (await mockRequests(page)).filter((r) => r.url.includes("/chat"));
  expect((chat.at(-1)?.body as { conversationId?: string }).conversationId).toBe("host-new-1");
});
