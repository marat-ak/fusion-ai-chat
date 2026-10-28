import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// The Run Inspector of the debug host (bridge design §13): the golden workflow WIZARD_WF (fixtures/debug-wizard-*: a real
// 72-node DRAFT and two real /debug turns of it, sanitized) served by the mock pod behind the fake pod proxy; NOXY_WF is the
// same workflow without Studio positions; MOCK_WF has no specification in its row. The mock pod answers message "start"
// with turn 1 and anything else with turn 2, and stops a run before its breakpoints as Oracle does.
const MOCK_POD = "http://localhost:8787";
const ORIGIN = "http://localhost:8790";
const HCM_REST_BASE = "/hcmRestApi/rest/latest/en/11.13.18.05:9";

type ProxyCall = { method: string; conversation?: string; target?: string; path: string; headers: Record<string, string> };
type PodCall = { method: string; url: string; headers: Record<string, string>; body: unknown };
const proxyCalls = async (page: Page): Promise<ProxyCall[]> => (await page.request.get(`${ORIGIN}/__proxy/requests`)).json();
const podCalls = async (page: Page): Promise<PodCall[]> => (await page.request.get(`${MOCK_POD}/__mock/requests`)).json();
const debugCalls = async (page: Page): Promise<PodCall[]> => (await podCalls(page)).filter((c) => c.url.endsWith("/debug"));

/** The small BOSS read of the definition's version, done when a turn ends. */
const isVersionRead = (c: ProxyCall): boolean => c.target === "BOSS" && decodeURIComponent(c.path).includes("$fields=workflowCode,status,version&");

const debuggerUrl = (workflow = "WIZARD_WF", conversation = "u1__dev1"): string =>
  `/ai-chat-debug/?pod=/api/pod/c/${conversation}/&workflow=${workflow}&version=DRAFT`;

type Scope = Page | FrameLocator;

async function send(s: Scope, text: string): Promise<void> {
  await s.getByTestId("gai-composer-input").locator("textarea").fill(text);
  await s.getByTestId("gai-composer-send").locator("button").click();
}

async function tab(s: Scope, name: "Chat" | "Run"): Promise<void> {
  await s.getByTestId("dbg-tabs").getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

async function detailTab(s: Scope, name: string): Promise<void> {
  await s.getByTestId("dbg-detail-tabs").getByRole("tab", { name }).click();
}

/** The agent UI's side panel frame attributes (gnimsys-agent-core webc sidePanelModel.ts, engine commit 3141e5d). */
const PANEL_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads";
const PANEL_ALLOW = "fullscreen";

/** The debugger framed by a page of the same origin with the side panel's own iframe attributes. */
async function framed(page: Page, workflow = "WIZARD_WF"): Promise<FrameLocator> {
  await page.goto(`${ORIGIN}/ai-chat-debug/not-a-file`); // any page of the origin, to own its document
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0"><iframe id="panel" style="width:1200px;height:950px;border:0"
    sandbox="${PANEL_SANDBOX}" allow="${PANEL_ALLOW}" src="${ORIGIN}${debuggerUrl(workflow)}"></iframe></body></html>`);
  const frame = page.frameLocator("#panel");
  await expect(frame.getByTestId("dbg-bound")).toContainText(`Workflow ${workflow} · DRAFT · dev1`);
  return frame;
}

/** The breakpoint set as the Run tab's node multi-select holds it (its value). */
const breakpoints = (s: Scope): Promise<string[]> =>
  s.getByTestId("dbg-breakpoint-select").evaluate((el) => [...(((el as unknown as { value?: Set<string> | null }).value) ?? [])]);

/** Picks (or unpicks) a node in the Run tab's multi-select: search by its code, click its option. */
async function pickNode(s: Scope, code: string): Promise<void> {
  const input = s.getByTestId("dbg-breakpoint-select").locator("input");
  await input.click();
  await input.fill(code);
  // The dropdown's rows (the field's own chips carry the option role too).
  const row = s.locator('div[role="option"]').filter({ hasText: new RegExp(`^${code} [—(]`) });
  // Core Pack 19 now and then opens no dropdown at all for a row that a data change added (the agent's unknown code;
  // about 1 run in 8): closing and searching again shows it, as a user would.
  if (!(await row.waitFor({ timeout: 3000 }).then(() => true, () => false))) {
    await input.press("Escape");
    await input.click();
    await input.fill(code);
  }
  await row.click();
  await input.press("Escape");
  await expect(s.locator('div[role="option"]')).toHaveCount(0); // the dropdown is closed before anything else is clicked
}

/** The agent UI's panel message, posted by the parent to the framed page. */
async function panelMessage(page: Page, message: Record<string, string>): Promise<void> {
  await page.evaluate((m) => {
    const f = document.getElementById("panel") as HTMLIFrameElement;
    f.contentWindow?.postMessage({ gnimsys: "side-panel-message", id: "ai-chat-debug", message: m }, location.origin);
  }, message);
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${ORIGIN}/__proxy/requests`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
  await page.request.post(`${MOCK_POD}/__mock/reset`);
});

test("inspector_shows_the_golden_run_on_the_graph_and_in_detail", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(debuggerUrl());
  // No trace or raw-frame panels in the chat any more: the inspector shows the run.
  await send(page, "start");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  await expect(page.getByTestId("gai-trace-toggle")).toHaveCount(0);
  await expect(page.getByTestId("gai-raw-toggle")).toHaveCount(0);
  await expect(page.getByTestId("dbg-tabs")).toContainText("Run (1)");
  await tab(page, "Run");
  await expect(page.getByTestId("dbg-metrics")).toContainText("1 LLM call (410 in / 285 out tokens) · 3 function calls · 2 steps with a value cut by Oracle · job job-wizard-1");
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 17 of 17 · LLM_07");
  // The graph: the definition's drawn nodes at Studio's positions; the run's 17 marked with their step numbers.
  await expect.poll(() => page.locator("g[data-node-code]").count(), { timeout: 20_000 }).toBe(71);
  await expect(page.locator("g.dbg-node--done, g.dbg-node--cut")).toHaveCount(17);
  await expect(page.locator('g[data-node-code="LLM_01"]')).toHaveClass(/dbg-node--not-run/);
  await expect(page.locator('g[data-node-code="CODE_09"]')).toHaveClass(/dbg-node--cut/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/inspector-graph.png" });

  // Stepping: first step, then to the branch.
  await page.getByTestId("dbg-first").click();
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 1 of 17 · START");
  for (let i = 0; i < 4; i++) await page.getByTestId("dbg-next").click();
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 5 of 17 · CONDITION_01");
  await expect(page.getByTestId("dbg-fact-branch")).toContainText("false → CODE_04");
  await expect(page.getByTestId("dbg-fact-duration")).toContainText("ms (time since the previous node");
  // Arrow keys step too.
  await page.getByTestId("dbg-inspector").press("ArrowRight");
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 6 of 17 · CODE_04");
  // A click on a card (the next one, in view below the current step) selects its step.
  await page.locator('g[data-node-code="BO_FUNCTION_06"]').click({ force: true });
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 7 of 17 · BO_FUNCTION_06");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/inspector-graph-step.png" });
  expect(errors).toEqual([]);
});

test("steps_view_and_detail_tabs_decode_oracles_json_in_strings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(debuggerUrl());
  await send(page, "start");
  await expect(page.getByTestId("dbg-tabs")).toContainText("Run (1)");
  await tab(page, "Run");
  await page.getByTestId("dbg-view").getByText("Steps", { exact: true }).click();
  const steps = page.getByTestId("dbg-step");
  await expect(steps).toHaveCount(17);
  await expect(steps.nth(12)).toContainText("#13");
  await expect(steps.nth(12)).toContainText("BO_FUNCTION_08");
  await expect(steps.nth(12)).toContainText("cut");
  await steps.nth(12).click();
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 13 of 17 · BO_FUNCTION_08");
  await expect(page.getByTestId("dbg-fact-cut")).toContainText("Oracle cut a value longer than 10 000 characters");
  // Output: Oracle's cut value is text, marked.
  await detailTab(page, "Output");
  await expect(page.getByTestId("dbg-output")).toContainText("cut by Oracle at 10 000 characters");
  // Calls: the function call, its HTTP status, its response decoded from a JSON string inside a JSON string.
  await detailTab(page, "Calls");
  await expect(page.getByTestId("dbg-call")).toHaveCount(1);
  await expect(page.getByTestId("dbg-call").locator("p").first()).toContainText("FUNCTION_CALL · getRecords");
  await expect(page.getByTestId("dbg-call").locator("p").first()).toContainText("HTTP 200");
  // Vars Δ at the step that stored the wizard state.
  await steps.nth(14).click();
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 15 of 17 · SET_FIELDS_02");
  await detailTab(page, "Vars Δ");
  await expect(page.getByTestId("dbg-vars")).toContainText("$variables after #15 against after #14 (CODE_09)");
  await expect(page.getByTestId("dbg-vars-table")).toContainText("$.wizardState");
  // Context: the state after the step, decoded; the JSON tree marks decoded strings.
  await detailTab(page, "Context");
  await expect(page.getByTestId("dbg-context")).toContainText("$system");
  await expect(page.getByTestId("dbg-context")).toContainText("decoded from JSON text");
  await page.screenshot({ path: "test-results/inspector-steps-context.png" });
  // Raw: the step's frame verbatim.
  await detailTab(page, "Raw");
  await expect(page.getByTestId("dbg-raw-frame")).toHaveCount(1);
  await expect(page.getByTestId("dbg-raw-frame")).toContainText('"nodeCode":"SET_FIELDS_02"');
  // Search: every step's data; a hit opens its step and tab.
  await page.getByTestId("dbg-search").locator("input").fill("getRecords");
  await expect(page.getByTestId("dbg-hit").first()).toContainText("BO_FUNCTION_06 · calls");
  await page.getByTestId("dbg-hit").first().click();
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 7 of 17 · BO_FUNCTION_06");
  await expect(page.getByTestId("dbg-calls")).toBeVisible();
});

test("two_turns_are_selectable_compared_and_a_saved_draft_is_named", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(debuggerUrl());
  await send(page, "start");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  // Turn 1 has ended and its definition version (7) was read: then the draft is saved (a new BOSS version).
  await expect.poll(async () => (await proxyCalls(page)).filter(isVersionRead).length).toBe(1);
  await page.request.get(`${MOCK_POD}/__mock/arm?wizardVersion=8`);
  await send(page, "Move 5 units");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(2);
  await expect(page.getByTestId("dbg-tabs")).toContainText("Run (2)");
  await tab(page, "Run");
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 24 of 24 · LLM_07");
  // Compare: the same node in the other turn.
  await detailTab(page, "Compare");
  await expect(page.getByTestId("dbg-compare")).toContainText("Turn 1");
  await expect(page.getByTestId("dbg-compare")).toContainText("Input");
  // Turn 1 ran on version 7; the definition is now version 8.
  await page.getByTestId("dbg-turn").locator("input").click();
  await page.getByRole("option", { name: /^Turn 1/ }).click();
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 17 of 17 · LLM_07");
  await expect(page.getByTestId("dbg-inspector-notices")).toContainText("The workflow definition changed since this run (version 7 at the run, 8 now)");
  // Both definition version reads went through the conversation's proxy (BOSS).
  expect((await proxyCalls(page)).filter(isVersionRead)).toHaveLength(2);
});

test("a_workflow_without_studio_positions_gets_the_steps_view_only", async ({ page }) => {
  await page.goto(debuggerUrl("NOXY_WF"));
  await send(page, "start");
  await expect(page.getByTestId("dbg-tabs")).toContainText("Run (1)");
  await tab(page, "Run");
  await expect(page.getByTestId("dbg-inspector-notices")).toContainText("No graph: the workflow has no Studio positions for 70 nodes");
  await expect(page.getByTestId("dbg-view")).toHaveCount(0);
  await expect(page.getByTestId("dbg-graph")).toHaveCount(0);
  await expect(page.getByTestId("dbg-step")).toHaveCount(17);
});

test("a_row_without_a_specification_gets_the_steps_view_with_the_reason", async ({ page }) => {
  await page.goto(debuggerUrl("MOCK_WF"));
  await send(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await tab(page, "Run");
  await expect(page.getByTestId("dbg-inspector-notices")).toContainText("No graph: the workflow row has no specification. The Steps view shows the run.");
  // START ran (a START/END pair); CHAT_LLM started and never sent its end in this fixture: listed without a step number.
  await expect(page.getByTestId("dbg-step")).toHaveCount(2);
  await expect(page.getByTestId("dbg-step").first()).toContainText("#1");
  await expect(page.getByTestId("dbg-step").nth(1)).toContainText("CHAT_LLM");
  await expect(page.getByTestId("dbg-step").nth(1)).toContainText("no end");
});

test("files_upload_with_person_id_minus_one_through_the_proxy", async ({ page }) => {
  await page.goto(debuggerUrl());
  await expect(page.getByTestId("gai-attach").locator("button")).toBeEnabled();
  await page.getByTestId("gai-attach-input").setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") });
  await send(page, "start");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  await expect(page.getByTestId("gai-bubble-user").getByTestId("gai-bubble-attachment")).toHaveText(["orders.csv"]);
  const pod = await podCalls(page);
  const row = pod.find((c) => c.url === `${HCM_REST_BASE}/hcmAiStudioConversations`);
  const conversationId = ((await debugCalls(page))[0].body as { conversationId: string }).conversationId;
  // PersonId "-1", as Oracle's own chat client sends without a user id (the pod refuses a row without PersonId).
  expect(row?.body).toEqual({ ConversationId: conversationId, ObjectCode: "WIZARD_WF", ObjectType: "AGENT_TEAM", PersonId: "-1" });
  expect(pod.filter((c) => c.method === "POST" && !c.url.endsWith("/debug")).map((c) => c.url)).toEqual([
    `${HCM_REST_BASE}/hcmAiStudioConversations`, "/fscmRestApi/applcoreApi/v1/attachDocTracker/", "/fscmRestApi/applcoreApi/v1/attachUpload", `${HCM_REST_BASE}/`,
  ]);
  // Every attachment call went through the conversation's proxy as FA calls with the CSRF header and no credentials.
  const fa = (await proxyCalls(page)).filter((c) => c.target === "FA");
  expect(fa.map((c) => [c.method, c.path])).toEqual([
    ["POST", `${HCM_REST_BASE}/hcmAiStudioConversations`], ["POST", "/fscmRestApi/applcoreApi/v1/attachDocTracker/"],
    ["POST", "/fscmRestApi/applcoreApi/v1/attachUpload"], ["POST", `${HCM_REST_BASE}/`],
  ]);
  for (const c of fa) expect([c.headers["x-gnimsys-pod-proxy"], c.headers.authorization]).toEqual(["1", undefined]);
});

test("export_downloads_the_masked_debug_conversation", async ({ page }) => {
  await page.goto(debuggerUrl("MOCK_WF"));
  await send(page, "approve me");
  await expect(page.getByTestId("gai-hitl-approve").locator("button")).toBeEnabled();
  await page.getByTestId("gai-hitl-approve").locator("button").click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(2);
  await tab(page, "Run");
  const download = page.waitForEvent("download");
  await page.getByTestId("dbg-export").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^debug-MOCK_WF-DRAFT-\d{4}-\d\d-\d\dT[\d-]+Z\.json$/);
  const json = JSON.parse(readFileSync(await file.path() as string, "utf8"));
  expect([json.kind, json.formatVersion, json.binding]).toEqual(["gnimsys-ai-chat-debug-export", 1,
    { pod: "/api/pod/c/u1__dev1/", instance: "dev1", podUser: "test.user", workflowCode: "MOCK_WF", version: "DRAFT" }]);
  expect(json.conversations).toHaveLength(1);
  const [run, resume] = json.conversations[0].turns;
  expect(run.request).toMatchObject({ message: "approve me", workflowCode: "MOCK_WF", invocationMode: "ADMIN", debugParams: { isDebug: true, breakPoints: [] } });
  expect(run.frames.length).toBeGreaterThan(0);
  expect(typeof run.frames[0].at).toBe("string");
  // The HITL credential is masked in the wait frame and in the resume request.
  expect(resume.request.resumeInput).toEqual({ messageInstanceId: "[redacted]", userResponse: "APPROVE_ACTION" });
  expect(JSON.stringify(json)).not.toContain("cb-1");
  expect(json.masked).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("dbg-notices")).toContainText("Exported 2 turns");
});

test("panel_messages_set_breakpoints_and_the_run_stops_before_the_node_verified", async ({ page }) => {
  const frame = await framed(page);
  await panelMessage(page, { type: "breakpoints", nodes: "CODE_04" });
  await expect(frame.getByTestId("dbg-notices")).toContainText("Breakpoints: the next runs stop before CODE_04");
  await send(frame, "start");
  await expect(frame.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  // The run carried the breakpoint; the mock pod (as Oracle) stopped before CODE_04.
  expect(((await debugCalls(page))[0].body as { debugParams: unknown }).debugParams).toEqual({ isDebug: true, breakPoints: ["CODE_04"] });
  await tab(frame, "Run");
  await expect.poll(() => breakpoints(frame)).toEqual(["CODE_04"]);
  await expect(frame.getByTestId("dbg-inspector-notices")).toContainText("Stopped before CODE_04 (breakpoint; verified against the graph)");
  await expect(frame.getByTestId("dbg-position")).toHaveText("Step 5 of 5 · CONDITION_01");
  await expect(frame.locator('g[data-node-code="CODE_04"]')).toHaveClass(/dbg-node--stopped-before/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/inspector-breakpoint.png" });
  // Removed in the inspector (unpicked in the node select): the next run carries none.
  await pickNode(frame, "CODE_04");
  await expect.poll(() => breakpoints(frame)).toEqual([]);
  await tab(frame, "Chat");
  await send(frame, "next");
  await expect(frame.getByTestId("gai-bubble-assistant")).toHaveCount(2);
  expect(((await debugCalls(page))[1].body as { debugParams: unknown }).debugParams).toEqual({ isDebug: true, breakPoints: [] });
});

test("panel_messages_export_and_reset_to_a_fresh_conversation", async ({ page }) => {
  const frame = await framed(page, "MOCK_WF");
  await send(frame, "hello");
  await expect(frame.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  // export
  let download = page.waitForEvent("download");
  await panelMessage(page, { type: "export" });
  expect((await download).suggestedFilename()).toMatch(/^debug-MOCK_WF-DRAFT-/);
  // reset with export first: a file, then a fresh conversation and an empty run record.
  download = page.waitForEvent("download");
  await panelMessage(page, { type: "reset", export: "true" });
  const exported = JSON.parse(readFileSync(await (await download).path() as string, "utf8"));
  expect(exported.conversations[0].turns).toHaveLength(1);
  await expect(frame.getByTestId("gai-bubble-assistant")).toHaveCount(0);
  await expect(frame.getByTestId("dbg-tabs")).not.toContainText("Run (1)");
  await expect(frame.getByTestId("dbg-notices")).toContainText("Exported, then started a fresh conversation.");
  await send(frame, "hello again");
  await expect(frame.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  const ids = (await debugCalls(page)).map((c) => (c.body as { conversationId: string }).conversationId);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  // reset without export: no file.
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await panelMessage(page, { type: "reset", export: "false" });
  await expect(frame.getByTestId("dbg-notices")).toContainText("Started a fresh conversation (not exported).");
  expect(downloaded).toBe(false);
  // A message of ours with a bad shape is refused with its reason.
  await panelMessage(page, { type: "breakpoints", nodes: "A B" });
  await expect(frame.getByTestId("dbg-notices")).toContainText('A panel message was refused: "breakpoints" nodes must be "" or node codes separated by commas');
});

test("the_user_sets_breakpoints_on_the_map_in_the_node_select_and_in_the_step_detail", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(debuggerUrl());
  // Before any run: the Run tab already shows the workflow, and its nodes can be picked.
  await tab(page, "Run");
  await expect(page.getByTestId("dbg-no-run")).toBeVisible();
  await expect.poll(() => page.locator("g[data-node-code]").count(), { timeout: 20_000 }).toBe(71);
  expect(await breakpoints(page)).toEqual([]);
  // The user's zoom survives the breakpoint edits (the banner they bring resizes the graph's frame).
  const card = page.locator('g[data-node-code="SET_FIELDS_01"] .dbg-node__box');
  const graph = (await page.getByTestId("dbg-graph").boundingBox())!;
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThan(118);
  const zoomed = (await card.boundingBox())!.width;
  // (b) The multi-select of ALL nodes (nodes not executed yet included), searchable: its value is the set.
  await pickNode(page, "CODE_04");
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04"]);
  await expect(page.locator('g[data-breakpoint-toggle="CODE_04"]')).toHaveClass(/dbg-node__bp--on/);
  // (a) On the map: a card's corner marker sets and removes "stop before" (and selects the card).
  const marker = page.locator('g[data-breakpoint-toggle="SET_FIELDS_01"]');
  await expect(marker).not.toHaveClass(/dbg-node__bp--on/);
  await marker.click(); // (actionable: waits until the banner that the first breakpoint brought has settled)
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04", "SET_FIELDS_01"]);
  await expect(page.locator('g[data-breakpoint-toggle="SET_FIELDS_01"]')).toHaveClass(/dbg-node__bp--on/);
  await expect(page.getByTestId("dbg-node-info")).toContainText("no run yet");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/inspector-user-breakpoints.png" });
  await page.locator('g[data-breakpoint-toggle="SET_FIELDS_01"]').click();
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04"]);
  // The node panel's action is the same toggle.
  await page.getByTestId("dbg-node-info").getByTestId("dbg-toggle-breakpoint").click();
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04", "SET_FIELDS_01"]);
  await pickNode(page, "SET_FIELDS_01");
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04"]);
  expect(Math.abs((await card.boundingBox())!.width - zoomed)).toBeLessThan(0.5);
  expect(consoleErrors).toEqual([]);
  // The banner above the chat names them; the run carries them and stops before CODE_04, verified.
  await tab(page, "Chat");
  await expect(page.getByTestId("dbg-notices")).toContainText("Breakpoints: the next runs stop before CODE_04");
  await send(page, "start");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  expect(((await debugCalls(page))[0].body as { debugParams: unknown }).debugParams).toEqual({ isDebug: true, breakPoints: ["CODE_04"] });
  await tab(page, "Run");
  await expect(page.getByTestId("dbg-inspector-notices")).toContainText("Stopped before CODE_04 (breakpoint; verified against the graph)");
  // The step detail's toggle (the same code path).
  await expect(page.getByTestId("dbg-position")).toHaveText("Step 5 of 5 · CONDITION_01");
  await page.getByTestId("dbg-detail").getByTestId("dbg-toggle-breakpoint").click();
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04", "CONDITION_01"]);
  await page.getByTestId("dbg-detail").getByTestId("dbg-toggle-breakpoint").click();
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04"]);
  // The export carries the user's breakpoints in the request and as the current set.
  const download = page.waitForEvent("download");
  await page.getByTestId("dbg-export").click();
  const json = JSON.parse(readFileSync(await (await download).path() as string, "utf8"));
  expect(json.breakpoints).toEqual(["CODE_04"]);
  expect(json.conversations[0].turns[0].request.debugParams).toEqual({ isDebug: true, breakPoints: ["CODE_04"] });
  // A reload of the page keeps them (this browser tab's sessionStorage), and says so.
  await page.reload();
  await expect(page.getByTestId("dbg-notices")).toContainText("Breakpoints kept in this browser tab were restored: CODE_04.");
  await tab(page, "Run");
  await expect.poll(() => breakpoints(page)).toEqual(["CODE_04"]);
  // Removed: gone after a reload too.
  await pickNode(page, "CODE_04");
  await expect.poll(() => breakpoints(page)).toEqual([]);
  await page.reload();
  await expect(page.getByTestId("dbg-bound")).toBeVisible();
  await expect(page.getByText("Breakpoints kept in this browser tab")).toHaveCount(0);
  await tab(page, "Run");
  await expect.poll(() => breakpoints(page)).toEqual([]);
});

test("an_agent_message_replaces_the_users_breakpoints", async ({ page }) => {
  const frame = await framed(page);
  await tab(frame, "Run");
  await pickNode(frame, "LLM_01");
  await expect.poll(() => breakpoints(frame)).toEqual(["LLM_01"]);
  await panelMessage(page, { type: "breakpoints", nodes: "CODE_04,BO_FUNCTION_06,NOT_A_NODE" });
  await expect.poll(() => breakpoints(frame)).toEqual(["CODE_04", "BO_FUNCTION_06", "NOT_A_NODE"]);
  await expect(frame.getByTestId("dbg-notices")).toContainText("The agent set breakpoints: CODE_04, BO_FUNCTION_06, NOT_A_NODE (replacing LLM_01).");
  // A code the definition does not have stays visible (marked) and removable; it is named in a warning.
  await expect(frame.getByTestId("dbg-inspector-notices")).toContainText("Breakpoint NOT_A_NODE names no node of the current definition.");
  await pickNode(frame, "NOT_A_NODE");
  await pickNode(frame, "BO_FUNCTION_06");
  await expect.poll(() => breakpoints(frame)).toEqual(["CODE_04"]);
});

test("full_screen_takes_the_whole_page_and_comes_back", async ({ page }) => {
  // The debugger opened on its own: full screen is allowed.
  await page.goto(debuggerUrl());
  const button = page.getByTestId("dbg-fullscreen");
  await expect(button).toHaveText("Full screen");
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await expect(button).toHaveText("Exit full screen");
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(button).toHaveText("Full screen");
  // A refusal is shown, never swallowed.
  await page.evaluate(() => { document.documentElement.requestFullscreen = () => Promise.reject(new TypeError("Permissions check failed")); });
  await button.click();
  await expect(page.getByTestId("dbg-notices")).toContainText("Full screen was refused (Permissions check failed). In the agent UI's side panel the panel's frame must allow full screen");
});

test("full_screen_in_the_side_panel_frame", async ({ page }) => {
  // The agent UI's panel frame (sandbox + allow="fullscreen"): the whole debugger page goes full screen and back.
  const frame = await framed(page);
  await frame.getByTestId("dbg-fullscreen").click();
  await expect(frame.getByTestId("dbg-fullscreen")).toHaveText("Exit full screen");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/debug-host-fullscreen.png" });
  await frame.getByTestId("dbg-fullscreen").click();
  await expect(frame.getByTestId("dbg-fullscreen")).toHaveText("Full screen");
});

test("without_a_readable_definition_breakpoints_are_typed_and_named_as_unchecked", async ({ page }) => {
  await page.goto(debuggerUrl("MOCK_WF"));
  await tab(page, "Run");
  await expect(page.getByTestId("dbg-breakpoint-unchecked")).toHaveText(
    "Node codes cannot be checked: the workflow definition is unavailable (the workflow row has no specification).");
  await expect(page.getByTestId("dbg-breakpoint-add")).toHaveCount(0);
  const codes = page.getByTestId("dbg-breakpoint-codes").locator("input");
  await codes.fill("NODE_A NODE_B");
  await page.getByTestId("dbg-breakpoint-codes-add").click();
  await expect(page.getByTestId("dbg-breakpoints")).toContainText('Not added: nodes must be "" or node codes separated by commas');
  await codes.fill("NODE_A, NODE_B");
  await page.getByTestId("dbg-breakpoint-codes-add").click();
  await expect(page.getByTestId("dbg-breakpoint")).toHaveText(["NODE_A", "NODE_B"]);
  await tab(page, "Chat");
  await send(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(1);
  expect(((await debugCalls(page))[0].body as { debugParams: unknown }).debugParams).toEqual({ isDebug: true, breakPoints: ["NODE_A", "NODE_B"] });
});
