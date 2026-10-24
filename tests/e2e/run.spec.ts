import { expect, test, type Page } from "@playwright/test";

// Run selection (design §5.1) on the dev host page (src/index.html, path "/"): the page binds what the config's `agent`
// names; `ui.runSettings` + the user's roles decide what the user may choose. Mock pod BOSS workflows
// (tests/mock-pod/fixtures/workflows.json + PAGED_WF_01..30): MOCK_WF (Published + Draft, starters "Show my invoices",
// "Create a PO"), INVOICE_WF (Published), DRAFT_ONLY_WF (Draft), TEMPLATE_WF (template), HIDDEN_WF (hidden), MOCK_WF_CUST
// (customization row), 30 Published PAGED_WF_nn — 32 Published agents listed, 25 pod rows a page.
const MOCK_POD = "http://localhost:8787";
const SETTINGS = { allAgentsRoles: ["PICK_AGENTS"], draftRoles: ["RUN_DRAFTS"] };
const UNBOUND_KEY = "xxx-gnimsys-ai-chat:run:/:agent=-,version=-";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };
type RunEvent = { workflowCode: string; version: string };

const mockRequests = async (page: Page): Promise<MockRequest[]> => (await (await page.request.get(`${MOCK_POD}/__mock/requests`)).json()) as MockRequest[];
const turnCalls = async (page: Page) => (await mockRequests(page)).filter((r) => r.method === "POST" && /\/agent\/v2\/[^/]+\/(chat|debug)$/.test(r.url));
const workflowQueries = async (page: Page) =>
  (await mockRequests(page)).filter((r) => r.url.includes("/workflows?")).map((r) => decodeURIComponent(new URL(r.url, MOCK_POD).search));

/** `runSettings` null = absent (nobody may choose). */
function config(agent: object, runSettings: object | null = SETTINGS): object {
  return {
    mode: "chat", agent, auth: { kind: "fusionShell" }, protocol: { checkVersion: "2607100" },
    ui: { starterQuestions: "fromWorkflow", ...(runSettings !== null && { runSettings }) },
  };
}

/** The host page with this config and roles; every aiChatRunChanged detail lands in window.__runEvents. */
async function open(page: Page, opts: { config: object; roles: string[]; stored?: string; storedKey?: string }): Promise<void> {
  await page.addInitScript((o) => {
    const w = window as unknown as { __CHAT_CONFIG__: object; __CHAT_USER__: object; __runEvents: unknown[] };
    w.__CHAT_CONFIG__ = o.config;
    w.__CHAT_USER__ = { userName: "test.user@example.com", roles: o.roles };
    w.__runEvents = [];
    // Capture on window: the component's events do not bubble, the capture phase still passes here.
    window.addEventListener("aiChatRunChanged", (e) => w.__runEvents.push((e as CustomEvent).detail), true);
    if (o.stored !== undefined && sessionStorage.getItem("__seeded") === null) {
      sessionStorage.setItem("__seeded", "1");
      sessionStorage.setItem(o.key, o.stored);
    }
  }, { ...opts, key: opts.storedKey ?? UNBOUND_KEY });
  await page.goto("/");
}

const runEvents = (page: Page) => page.evaluate(() => (window as unknown as { __runEvents: RunEvent[] }).__runEvents);
const agentRows = (page: Page) => page.getByTestId("gai-run-agent");
const agentRow = (page: Page, code: string) => page.locator(`[data-testid="gai-run-agent"][data-workflow-code="${code}"]`);
const codes = (page: Page) => agentRows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-workflow-code")));
const conversationId = (page: Page) => page.evaluate(() => (document.getElementById("chat") as unknown as { conversationId?: string }).conversationId);

async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId("gai-composer-input").locator("textarea").fill(text);
  await page.getByTestId("gai-composer-send").locator("button").click();
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK_POD}/__mock/reset`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
});

test("version_then_agent_list_then_agent_streams_a_draft_turn_and_refresh_restores", async ({ page }) => {
  await open(page, { config: config({}), roles: ["PICK_AGENTS", "RUN_DRAFTS"] });
  const panel = page.getByTestId("gai-run-panel");
  await expect(page.getByTestId("gai-run-title")).toHaveText("Choose a version and an agent");
  // Version first: nothing is preselected and no agent is listed until the user picks one.
  await expect(page.getByTestId("gai-run-hint")).toHaveText("Choose Published or Draft to list the agents.");
  await expect(page.getByTestId("gai-run-agents")).toHaveCount(0);
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);

  await page.getByTestId("gai-run-version").getByText("Draft", { exact: true }).click();
  // The Draft list: templates and customization rows are not agents to pick; draft-only agents appear here only.
  await expect.poll(() => codes(page)).toEqual(["MOCK_WF", "DRAFT_ONLY_WF"]);
  await expect(agentRow(page, "MOCK_WF").getByTestId("gai-run-marker")).toHaveText(["Published", "Draft"]);
  await expect(agentRow(page, "DRAFT_ONLY_WF").getByTestId("gai-run-marker")).toHaveText(["Draft"]);
  await page.screenshot({ path: "test-results/run-version-then-list.png" });
  expect(await workflowQueries(page)).toEqual(expect.arrayContaining([
    expect.stringContaining("$filter=(status = 'DRAFT' and sourceWorkflowCode = null)"),
  ]));

  await agentRow(page, "MOCK_WF").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("gai-draft-badge")).toBeVisible();
  await expect(page.getByTestId("gai-run-change")).toHaveText("Change agent");
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  const turns = await turnCalls(page);
  expect(turns.map((t) => new URL(t.url, MOCK_POD).pathname)).toEqual(["/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/debug"]);
  expect(turns[0].body).toMatchObject({ workflowCode: "MOCK_WF", invocationMode: "ADMIN" });
  expect(await runEvents(page)).toEqual([{ workflowCode: "MOCK_WF", version: "DRAFT" }]);
  // Only the unbound parts the user chose, under the page + binding key.
  expect(await page.evaluate((k) => sessionStorage.getItem(k), UNBOUND_KEY)).toBe('{"workflowCode":"MOCK_WF","version":"DRAFT"}');

  // Refresh: the choice is re-checked (the agent still has a draft) and runs without the picker.
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
  await page.reload();
  await expect(page.getByTestId("gai-draft-badge")).toBeVisible();
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);
  await expect(panel).toHaveCount(0);
  expect(await workflowQueries(page)).toEqual(expect.arrayContaining([
    "?$filter=(workflowCode = 'MOCK_WF' and sourceWorkflowCode = null and (status = 'DRAFT' or status = 'PUBLISHED'))&$fields=workflowCode,status,sourceWorkflowCode,isTemplate,hiddenFlag",
  ]));
  expect(await runEvents(page)).toEqual([{ workflowCode: "MOCK_WF", version: "DRAFT" }]);
  // The conversations drawer animates open after a load: the screenshot waits for it to settle.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/run-draft-restored.png" });
});

test("published_list_filters_searches_pages_and_change_starts_a_new_conversation", async ({ page }) => {
  await open(page, { config: config({}), roles: ["PICK_AGENTS"] });
  await expect(page.getByTestId("gai-run-title")).toHaveText("Choose an agent");
  await expect(page.getByTestId("gai-run-context")).toHaveText("Published agents");
  await expect(page.getByTestId("gai-run-version")).toHaveCount(0);
  // Page 1 (25 pod rows): the template and the hidden row are dropped; the customization row is excluded by the query.
  await expect(agentRow(page, "PAGED_WF_01")).toBeVisible();
  const first = await codes(page);
  expect(first.slice(0, 3)).toEqual(["MOCK_WF", "INVOICE_WF", "PAGED_WF_01"]);
  expect(first).not.toContain("TEMPLATE_WF");
  expect(first).not.toContain("HIDDEN_WF");
  expect(first).not.toContain("MOCK_WF_CUST");
  await page.screenshot({ path: "test-results/run-published-list.png" });
  // Scrolling to the end loads the next page.
  await expect.poll(async () => {
    await agentRows(page).last().scrollIntoViewIfNeeded();
    return agentRows(page).count();
  }).toBe(32);
  expect((await workflowQueries(page)).filter((q) => q.includes("&$offset=25"))).toHaveLength(1);

  // Search by name or code.
  await page.getByTestId("gai-run-search").locator("input").fill("invoice");
  await expect.poll(() => codes(page)).toEqual(["INVOICE_WF"]);
  expect(await workflowQueries(page)).toEqual(expect.arrayContaining([
    expect.stringContaining("(status = 'PUBLISHED' and sourceWorkflowCode = null and (name ~LIKE '%invoice%' or workflowCode ~LIKE '%invoice%'))"),
  ]));
  await page.getByTestId("gai-run-search").locator("input").fill("zzz");
  await expect(page.getByTestId("gai-run-no-agents")).toHaveText('No agents with a published version match "zzz".');
  await page.getByTestId("gai-run-search").locator("input").fill("invoice");
  await agentRow(page, "INVOICE_WF").click();

  await expect(page.getByTestId("gai-draft-badge")).toHaveCount(0);
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  expect((await turnCalls(page)).map((t) => new URL(t.url, MOCK_POD).pathname)).toEqual(["/api/fusion-ai/orchestrator/agent/v2/INVOICE_WF/chat"]);
  // Only the agent was chosen (Published came from the roles): only the agent is stored.
  expect(await page.evaluate((k) => sessionStorage.getItem(k), UNBOUND_KEY)).toBe('{"workflowCode":"INVOICE_WF"}');
  const firstConversation = await conversationId(page);

  // Change, then Cancel: back to the same chat, unchanged.
  await page.getByTestId("gai-run-change").locator("button").click();
  await expect(page.getByTestId("gai-run-panel")).toBeVisible();
  await page.getByTestId("gai-run-cancel").locator("button").click();
  await expect(page.getByTestId("gai-run-panel")).toHaveCount(0);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  expect(await conversationId(page)).toBe(firstConversation);

  // Change to another agent: a new conversation.
  await page.getByTestId("gai-run-change").locator("button").click();
  await agentRow(page, "MOCK_WF").click();
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(0);
  await expect.poll(() => conversationId(page)).not.toBe(firstConversation);
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  const turns = await turnCalls(page);
  expect((turns.at(-1)?.body as { conversationId?: string }).conversationId).not.toBe(firstConversation);
  expect(await runEvents(page)).toEqual([{ workflowCode: "INVOICE_WF", version: "PUBLISHED" }, { workflowCode: "MOCK_WF", version: "PUBLISHED" }]);
});

test("bound_agent_with_draft_role_chooses_among_its_versions", async ({ page }) => {
  await open(page, { config: config({ workflowCode: "DRAFT_ONLY_WF" }), roles: ["RUN_DRAFTS"] });
  await expect(page.getByTestId("gai-run-title")).toHaveText("Choose a version");
  await expect(page.getByTestId("gai-run-context")).toHaveText("Agent DRAFT_ONLY_WF");
  // Limited to the versions that agent has.
  await expect(page.getByTestId("gai-run-version")).toHaveText("Draft");
  await page.getByTestId("gai-run-version").getByText("Draft", { exact: true }).click();
  await page.screenshot({ path: "test-results/run-bound-agent-version.png" });
  await page.getByTestId("gai-run-start").locator("button").click();
  await expect(page.getByTestId("gai-draft-badge")).toBeVisible();
  await expect(page.getByTestId("gai-run-change")).toHaveText("Change version");
  // The bound agent is never stored: only the chosen version, under a key naming the bound agent.
  expect(await page.evaluate(() => sessionStorage.getItem("xxx-gnimsys-ai-chat:run:/:agent=DRAFT_ONLY_WF,version=-"))).toBe('{"version":"DRAFT"}');
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  expect((await turnCalls(page)).map((t) => new URL(t.url, MOCK_POD).pathname)).toEqual(["/api/fusion-ai/orchestrator/agent/v2/DRAFT_ONLY_WF/debug"]);
});

test("bound_agent_without_draft_role_runs_published_and_names_a_missing_publication", async ({ page }) => {
  // DRAFT_ONLY_WF has no published row: the notice says so instead of a made-up HTTP 404.
  await open(page, { config: config({ workflowCode: "DRAFT_ONLY_WF" }), roles: ["PICK_AGENTS"] });
  await expect(page.getByTestId("gai-workflow-error").getByRole("heading")).toHaveText("Starter questions unavailable (workflow not published)");
  await expect(page.getByTestId("gai-run-panel")).toHaveCount(0);
  await expect(page.getByTestId("gai-run-change")).toHaveCount(0);
  await expect(page.getByTestId("gai-draft-badge")).toHaveCount(0);
});

test("no_agent_in_link_makes_no_requests", async ({ page }) => {
  for (const [agent, runSettings, roles] of [[{}, null, ["PICK_AGENTS"]], [{ version: "DRAFT" }, SETTINGS, ["RUN_DRAFTS"]]] as const) {
    await page.request.delete(`${MOCK_POD}/__mock/requests`);
    await open(page, { config: config(agent, runSettings), roles: [...roles] });
    await expect(page.getByTestId("gai-no-agent").getByRole("heading")).toHaveText("No agent in this link");
    await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(await mockRequests(page)).toEqual([]);
    expect(await runEvents(page)).toEqual([]);
  }
});

test("restored_choice_dropped_with_a_note_when_the_draft_role_is_gone", async ({ page }) => {
  await open(page, { config: config({}), roles: ["PICK_AGENTS"], stored: '{"workflowCode":"MOCK_WF","version":"DRAFT"}' });
  await expect(page.getByTestId("gai-run-note").getByRole("heading"))
    .toHaveText("Your earlier choice (MOCK_WF · Draft) is no longer available: running drafts needs a role you no longer hold. Choose again.");
  await expect(agentRows(page).first()).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), UNBOUND_KEY)).toBeNull();
});

// Review fixes (round 1).

test("bound_hidden_agent_with_draft_role_offers_all_its_versions", async ({ page }) => {
  // HIDDEN_WF is hidden from the agent list, but a page that binds it is never checked against the list.
  await open(page, { config: config({ workflowCode: "HIDDEN_WF" }), roles: ["RUN_DRAFTS"] });
  await expect(page.getByTestId("gai-run-version")).toContainText("Published");
  await expect(page.getByTestId("gai-run-version")).toContainText("Draft");
  await expect(page.getByTestId("gai-run-no-version")).toHaveCount(0);
  expect(await workflowQueries(page)).toEqual(expect.arrayContaining([
    "?$filter=(workflowCode = 'HIDDEN_WF' and (status = 'DRAFT' or status = 'PUBLISHED'))&$fields=workflowCode,status,sourceWorkflowCode,isTemplate,hiddenFlag",
  ]));
});

test("stored_draft_dropped_with_a_note_when_a_bound_agent_page_runs_published", async ({ page }) => {
  // Stored while the user held the draft role (row 2); without it the page runs Published (row 3).
  const key = "xxx-gnimsys-ai-chat:run:/:agent=MOCK_WF,version=-";
  await open(page, { config: config({ workflowCode: "MOCK_WF" }), roles: ["PICK_AGENTS"], stored: '{"version":"DRAFT"}', storedKey: key });
  await expect(page.getByTestId("gai-run-note").getByRole("heading"))
    .toHaveText("Your earlier choice (MOCK_WF · Draft) is no longer available: running drafts needs a role you no longer hold.");
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);
  await expect(page.getByTestId("gai-draft-badge")).toHaveCount(0);
  await expect(page.getByTestId("gai-run-change")).toHaveCount(0);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  expect((await turnCalls(page)).map((t) => new URL(t.url, MOCK_POD).pathname)).toEqual(["/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/chat"]);
});

test("a_pod_reporting_more_agents_without_rows_ends_the_list_with_an_error", async ({ page }) => {
  await page.request.get(`${MOCK_POD}/__mock/arm?workflowsStall=1`);
  await open(page, { config: config({}), roles: ["PICK_AGENTS"] });
  await expect(page.getByTestId("gai-run-error").getByRole("heading"))
    .toHaveText("Agents unavailable (the agent list stopped at row 0: the pod reports more agents but returned no rows)");
  // Bounded: one list call, and none after it (the list view would otherwise keep asking for the next block).
  await page.waitForTimeout(1500);
  expect((await workflowQueries(page)).filter((q) => q.includes("&$offset="))).toHaveLength(1);
});
