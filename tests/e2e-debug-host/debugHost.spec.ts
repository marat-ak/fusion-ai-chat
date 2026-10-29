import { expect, test, type Page } from "@playwright/test";

// The debug host page (debug-host release build) at /ai-chat-debug/ behind the fake pod proxy's conversation form
// (tests/fake-pod-proxy: conversations u1__dev1 bound to dev1 as test.user, u1__nouser without a pod user, u1__unbound
// without a pod sign-in, u1__stale whose sign-in is gone by the first call, u1__noconf whose FUAI calls answer 424
// not-configured; any other conversation is unknown), in front of the mock pod. The agent chat opens the page as
// /ai-chat-debug/?pod=/api/pod/c/<conversationId>/&workflow=<code>&version=DRAFT|PUBLISHED&gnimsysUi=1|0; its header button opens the
// bare page.
const MOCK_POD = "http://localhost:8787";
const ORIGIN = "http://localhost:8790";
const OPEN_FROM_CHAT = "Open the debugger from the chat — ask the agent to debug a workflow";

type ProxyCall = { method: string; conversation?: string; target?: string; path: string; headers: Record<string, string> };
type PodCall = { method: string; url: string; headers: Record<string, string>; body: unknown };

const proxyCalls = async (page: Page): Promise<ProxyCall[]> => (await page.request.get(`${ORIGIN}/__proxy/requests`)).json();
const podCalls = async (page: Page): Promise<PodCall[]> => (await page.request.get(`${MOCK_POD}/__mock/requests`)).json();

/** The page as the agent chat opens it (the side panel's URL form: the base's slashes unencoded). */
const debuggerUrl = (conversation: string, version: "DRAFT" | "PUBLISHED", workflow = "MOCK_WF", gnimsysUi: 0 | 1 = 1): string =>
  `/ai-chat-debug/?pod=/api/pod/c/${conversation}/&workflow=${workflow}&version=${version}&gnimsysUi=${gnimsysUi}`;

/** Every request the page itself makes outside its static files (the proxy and anything else under /api/). */
function apiRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) seen.push(`${r.method()} ${r.url()}`); });
  return seen;
}

/** The Run tab holds the reply's run: two steps (START, and CHAT_LLM that never ends in this fixture), the raw frames. */
async function expectRunTab(page: Page): Promise<void> {
  await expect(page.getByTestId("dbg-tabs")).toContainText("Run (1)");
  await page.getByTestId("dbg-tabs").getByRole("tab", { name: /^Run/ }).click();
  await expect(page.getByTestId("dbg-step")).toHaveCount(2);
  await page.getByTestId("dbg-detail-tabs").getByRole("tab", { name: "Raw" }).click();
  await expect(page.getByTestId("dbg-raw-frame").first()).toContainText('{"nodeProgressMessage"');
}

/** No picker, no input, no Run: the page binds from its URL only. */
async function expectNoInputs(page: Page): Promise<void> {
  for (const id of ["dbg-instance", "dbg-version", "dbg-workflow", "dbg-app", "dbg-run", "dbg-refresh"]) await expect(page.getByTestId(id)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${ORIGIN}/__proxy/requests`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
  await page.request.post(`${MOCK_POD}/__mock/reset`);
});

test("missing_param_shows_open_from_chat_panel", async ({ page }) => {
  const api = apiRequests(page);
  // The agent UI's header button: the bare page.
  await page.goto("/ai-chat-debug/");
  const panel = page.getByTestId("dbg-open-from-chat");
  await expect(panel).toContainText(OPEN_FROM_CHAT);
  await expect(panel).toContainText("pod: missing; workflow: missing; version: missing; gnimsysUi: missing");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);
  await expect(page.getByTestId("dbg-bound")).toHaveCount(0);
  await expectNoInputs(page);
  // Visual self-check (after the banner's enter animation).
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/debug-host-open-from-chat.png" });

  // One parameter short: the panel names it.
  await page.goto("/ai-chat-debug/?pod=/api/pod/c/u1__dev1/&workflow=MOCK_WF&gnimsysUi=1");
  await expect(panel).toContainText(OPEN_FROM_CHAT);
  await expect(panel).toContainText("version: missing");
  await expect(panel).not.toContainText("workflow: missing");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);

  // gnimsysUi is required and exactly 0 or 1: the agent says whether the run talks to a gnimsys-ui chat.
  await page.goto("/ai-chat-debug/?pod=/api/pod/c/u1__dev1/&workflow=MOCK_WF&version=DRAFT");
  await expect(panel).toContainText("gnimsysUi: missing");
  await page.goto("/ai-chat-debug/?pod=/api/pod/c/u1__dev1/&workflow=MOCK_WF&version=DRAFT&gnimsysUi=yes");
  await expect(panel).toContainText('gnimsysUi: must be 0 or 1 (got "yes")');
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);

  // Zero requests: nothing reached the proxy, and the page asked nothing under /api/.
  await page.waitForLoadState("networkidle");
  expect(await proxyCalls(page)).toEqual([]);
  expect(api).toEqual([]);
});

test("invalid_pod_base_refused", async ({ page }) => {
  const api = apiRequests(page);
  for (const pod of ["/api/pod/dev1/", "/api/pod/c/../", "/api/pod/c/%2e%2e/", "https://evil.example.com/api/pod/c/u1__dev1/"]) {
    await page.goto(`/ai-chat-debug/?pod=${encodeURIComponent(pod)}&workflow=MOCK_WF&version=DRAFT&gnimsysUi=1`);
    const panel = page.getByTestId("dbg-open-from-chat");
    await expect(panel).toContainText(OPEN_FROM_CHAT);
    await expect(panel).toContainText(`pod: not the chat conversation's proxy base /api/pod/c/<conversation>/ (got ${JSON.stringify(pod)})`);
    await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);
  }
  await page.waitForLoadState("networkidle");
  expect(await proxyCalls(page)).toEqual([]);
  expect(api).toEqual([]);
});

test("binds_workflow_and_version_from_url_and_streams_a_draft_turn_through_the_conversation_base", async ({ page }) => {
  // JET, the theme, the Core Pack and the icon font come from the build: the page loads nothing from another origin.
  const foreign: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith(ORIGIN + "/")) foreign.push(r.url()); });
  // A side panel's width (the conversations drawer then starts closed, as an overlay).
  await page.setViewportSize({ width: 560, height: 900 });
  await page.goto(debuggerUrl("u1__dev1", "DRAFT"));

  await expect(page.getByTestId("dbg-bound")).toHaveText("Workflow MOCK_WF · DRAFT · dev1");
  await expectNoInputs(page);
  await expect(page.getByTestId("dbg-open-from-chat")).toHaveCount(0);
  await expect(page.getByTestId("gai-mode-switch")).toContainText("Chat");
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);
  // Agent and version both bound by the URL: no run choice at all (bridge design §5.1, first row); the draft is marked.
  await expect(page.getByTestId("gai-run-panel")).toHaveCount(0);
  await expect(page.getByTestId("gai-run-change")).toHaveCount(0);
  await expect(page.getByTestId("gai-draft-badge")).toBeVisible();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => {
      const t = document.querySelector('[data-testid="gai-bubble-assistant"]')?.textContent?.trim();
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId("gai-composer-input").locator("textarea").fill("hello");
  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  // Streamed through the proxy: partial text was on screen before the final.
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.some((t) => t === "Hel" || t === "Hello!")).toBe(true);

  // The run is in the Run tab: the Run Inspector replaces the chat's trace and raw-frame panels in the debugger.
  await expect(page.getByTestId("gai-trace-toggle")).toHaveCount(0);
  await expect(page.getByTestId("gai-raw-toggle")).toHaveCount(0);
  await expectRunTab(page);

  // Every call went to the conversation base with the CSRF header and no credentials of its own: first the binding
  // (_info), then the chat's calls; the run is the URL's workflow and version (DRAFT -> /debug).
  const calls = await proxyCalls(page);
  expect(calls[0]).toMatchObject({ method: "GET", conversation: "u1__dev1", target: "_info", path: "" });
  for (const c of calls) expect([c.conversation, c.headers["x-gnimsys-pod-proxy"], c.headers.authorization]).toEqual(["u1__dev1", "1", undefined]);
  const debug = calls.filter((c) => c.path.endsWith("/debug"));
  expect(debug.map((c) => [c.method, c.target, c.path])).toEqual([["POST", "FUAI", "/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/debug"]]);
  expect(calls.some((c) => c.path.endsWith("/chat"))).toBe(false);
  // The proxy called the pod's /debug with the bound sign-in's bearer.
  const pod = await podCalls(page);
  const run = pod.filter((c) => c.url.includes("/MOCK_WF/"));
  expect(run.map((c) => c.url)).toEqual(["/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/debug"]);
  expect(run[0].headers.authorization).toBe("Bearer fake-pod-token");
  expect(typeof run[0].headers["x-ora-ai-api-v2-check"]).toBe("string");
  expect(run[0].body).toMatchObject({ message: "hello", workflowCode: "MOCK_WF", invocationMode: "ADMIN", debugParams: { isDebug: true, breakPoints: [] } });
  // gnimsysUi=1: the run-start message tells the workflow it talks to a gnimsys-ui chat.
  expect((run[0].body as { parameters?: unknown }).parameters).toEqual({ additional_context: '{"gnimsysUi":1}' });
  expect(pod.some((c) => c.url.includes("/workflows?") && decodeURIComponent(c.url).includes("status='DRAFT'"))).toBe(true);
  expect(foreign).toEqual([]);
  // Visual self-check (after the collapsible's expand animation).
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/debug-host-draft-turn.png" });
});

test("streams_a_published_turn_and_its_resume_through_debug_with_status_published", async ({ page }) => {
  // The host sets agent.publishedVia "debug": a PUBLISHED run goes through Studio's /debug with status PUBLISHED (the
  // vendored CLI's shape), so the builder gets the node data; the page shows the same trace and raw frames as for a draft.
  await page.setViewportSize({ width: 560, height: 900 });
  // gnimsysUi=0: no additional context (the run looks like Oracle's own chat).
  await page.goto(debuggerUrl("u1__dev1", "PUBLISHED", "MOCK_WF", 0));
  await expect(page.getByTestId("dbg-bound")).toHaveText("Workflow MOCK_WF · PUBLISHED · dev1");
  await expectNoInputs(page);
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);
  await expect(page.getByTestId("gai-run-panel")).toHaveCount(0);
  // Still the published copy: no Draft badge.
  await expect(page.getByTestId("gai-draft-badge")).toHaveCount(0);

  await page.getByTestId("gai-composer-input").locator("textarea").fill("hello");
  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expectRunTab(page);
  await page.getByTestId("dbg-tabs").getByRole("tab", { name: "Chat" }).click();

  // A HITL wait and its resume take the same path.
  await page.getByTestId("gai-composer-input").locator("textarea").fill("approve me");
  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?", "Approve the transfer?"]);
  const approve = page.getByTestId("gai-hitl-approve").locator("button");
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?", "Approve the transfer?", "Approved and done"]);
  await expect(page.getByTestId("gai-hitl")).toHaveCount(0);

  // Through the conversation base: three /debug turns, no /chat.
  const calls = await proxyCalls(page);
  for (const c of calls) expect([c.conversation, c.headers["x-gnimsys-pod-proxy"], c.headers.authorization]).toEqual(["u1__dev1", "1", undefined]);
  expect(calls.filter((c) => c.path.includes("/MOCK_WF/")).map((c) => [c.method, c.target, c.path])).toEqual(
    Array(3).fill(["POST", "FUAI", "/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/debug"]),
  );
  // The pod got the CLI's published debug shape: run, run, resume (same base + jobId + resumeInput).
  const run = (await podCalls(page)).filter((c) => c.url.includes("/MOCK_WF/"));
  expect(run.map((c) => c.url)).toEqual(Array(3).fill("/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/debug"));
  expect(run[0].headers.authorization).toBe("Bearer fake-pod-token");
  const base = { workflowCode: "MOCK_WF", invocationMode: "ADMIN", status: "PUBLISHED", debugParams: { isDebug: true, breakPoints: [] } };
  expect(run[0].body).toMatchObject({ ...base, message: "hello" });
  expect(run[1].body).toMatchObject({ ...base, message: "approve me" });
  expect(run[2].body).toMatchObject({ ...base, message: "", jobId: "job-1", resumeInput: { messageInstanceId: "cb-1", userResponse: "APPROVE_ACTION" } });
  for (const c of run) expect("parameters" in (c.body as object)).toBe(false);
  const conversationIds = run.map((c) => (c.body as { conversationId: string }).conversationId);
  expect(new Set(conversationIds).size).toBe(1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/debug-host-published-turn.png" });
});

test("needs_input_without_pod_user", async ({ page }) => {
  await page.goto(debuggerUrl("u1__nouser", "DRAFT"));
  await expect(page.getByTestId("dbg-notices")).toContainText("The pod user of dev1 is unknown: the chat needs it as its user name.");
  // The chat's own needs-input panel: no user name, never the Keycloak one; nothing but the binding is fetched.
  await expect(page.getByTestId("gai-state-panel")).toContainText("user.userName");
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect((await proxyCalls(page)).map((c) => [c.conversation, c.target])).toEqual([["u1__nouser", "_info"]]);
});

test("info_auth_required_shows_the_sign_in_banner", async ({ page }) => {
  await page.goto(debuggerUrl("u1__unbound", "DRAFT"));
  await expect(page.getByTestId("dbg-notices")).toContainText("Sign in to the pod through the agent chat, then ask the agent to open the debugger again.");
  await expect(page.getByTestId("dbg-bound")).toHaveText("Workflow MOCK_WF · DRAFT");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect((await proxyCalls(page)).map((c) => [c.conversation, c.target])).toEqual([["u1__unbound", "_info"]]);
  expect(await podCalls(page)).toEqual([]);
});

test("call_auth_required_shows_the_chat_sign_in_banner", async ({ page }) => {
  await page.goto(debuggerUrl("u1__stale", "PUBLISHED"));
  await expect(page.getByTestId("gai-auth-banner")).toBeVisible();
  await expect(page.getByTestId("gai-auth-detail")).toHaveText("Sign in to dev1 in the agent chat first.");
  const calls = await proxyCalls(page);
  expect(calls.length).toBeGreaterThan(1);
  for (const c of calls) expect([c.conversation, c.headers["x-gnimsys-pod-proxy"], c.headers.authorization]).toEqual(["u1__stale", "1", undefined]);
  expect(await podCalls(page)).toEqual([]);
});

test("unknown_conversation_is_explicit", async ({ page }) => {
  await page.goto(debuggerUrl("u1__gone", "DRAFT"));
  await expect(page.getByTestId("dbg-notices")).toContainText("the debugger's pod binding is unavailable (HTTP 404 unknown-conversation): fake pod proxy: unknown-conversation");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);
});

test("not_configured_turn_shows_the_proxy_reason", async ({ page }) => {
  await page.goto(debuggerUrl("u1__noconf", "PUBLISHED"));
  await expect(page.getByTestId("dbg-bound")).toHaveText("Workflow MOCK_WF · PUBLISHED · noconf");
  await page.getByTestId("gai-composer-input").locator("textarea").fill("hello");
  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-error")).toContainText("Instance noconf is not configured for FUAI calls (missing FUAI token key)");
  // PUBLISHED goes through /debug in the debugger (agent.publishedVia "debug").
  expect((await proxyCalls(page)).some((c) => c.path.endsWith("/MOCK_WF/debug"))).toBe(true);
});
