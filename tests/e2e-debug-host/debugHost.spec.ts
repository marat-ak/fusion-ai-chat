import { expect, test, type Page } from "@playwright/test";

// The debug host page (debug-host release build) at /ai-chat-debug/ behind the fake pod proxy (tests/fake-pod-proxy:
// instances "Dev 1" signed in as test.user, "No User" without a pod user, "Stale" listed as signed in but answering 401
// auth-required, "Off" not signed in, "No Config" whose FUAI calls answer 424 not-configured), in front of the mock pod.
const MOCK_POD = "http://localhost:8787";
const ORIGIN = "http://localhost:8790";

type ProxyCall = { method: string; instance: string; target: string; path: string; headers: Record<string, string> };
type PodCall = { method: string; url: string; headers: Record<string, string>; body: unknown };

const proxyCalls = async (page: Page): Promise<ProxyCall[]> => (await page.request.get(`${ORIGIN}/__proxy/requests`)).json();
const podCalls = async (page: Page): Promise<PodCall[]> => (await page.request.get(`${MOCK_POD}/__mock/requests`)).json();

// Core Pack (oj-c) testids sit on the custom element: typing and clicks go to its inner input/button.
async function pickInstance(page: Page, option: string): Promise<void> {
  await page.getByTestId("dbg-instance").locator("input").click();
  await page.getByRole("option", { name: option }).click();
}
async function fill(page: Page, testId: string, text: string): Promise<void> {
  await page.getByTestId(testId).locator("input").fill(text);
}
async function version(page: Page, label: "Published" | "Draft"): Promise<void> {
  await page.getByTestId("dbg-version").getByText(label, { exact: true }).click();
}
async function run(page: Page): Promise<void> {
  await page.getByTestId("dbg-run").locator("button").click();
}
async function start(page: Page, option: string, v: "Published" | "Draft"): Promise<void> {
  await page.goto("/ai-chat-debug/");
  await pickInstance(page, option);
  await fill(page, "dbg-workflow", "MOCK_WF");
  await version(page, v);
  await run(page);
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${ORIGIN}/__proxy/requests`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
  await page.request.post(`${MOCK_POD}/__mock/reset`);
});

test("picker_lists_instances_without_preselect_and_run_needs_input", async ({ page }) => {
  await page.goto("/ai-chat-debug/");
  const picker = page.getByTestId("dbg-instance").locator("input");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue("");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);

  await run(page);
  const notices = page.getByTestId("dbg-notices");
  await expect(notices).toContainText("Instance: pick one");
  await expect(notices).toContainText("Workflow code or app code: enter one");
  await expect(notices).toContainText("Version: pick PUBLISHED or DRAFT");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);

  await picker.click();
  await expect(page.getByRole("option")).toHaveText([
    "Dev 1 — test.user", "No User — pod user unknown", "Stale — test.user", "Off — not signed in", "No Config — test.user",
  ]);
  await page.getByRole("option", { name: "Off — not signed in" }).click();
  await expect(notices).toContainText("Sign in to Off through the agent chat, then Refresh.");
  await fill(page, "dbg-workflow", "MOCK_WF");
  await version(page, "Draft");
  await run(page);
  await expect(notices).toContainText("Instance: sign in to Off through the agent chat first, then Refresh");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toHaveCount(0);
  expect(await proxyCalls(page)).toEqual([]);
});

test("needs_input_without_pod_user", async ({ page }) => {
  await start(page, "No User — pod user unknown", "Draft");
  await expect(page.getByTestId("dbg-notices")).toContainText("The pod user of No User is unknown");
  // The chat's own needs-input panel: no user name, never the Keycloak one; nothing is fetched.
  await expect(page.getByTestId("gai-state-panel")).toContainText("user.userName");
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(await proxyCalls(page)).toEqual([]);
});

test("auth_required_shows_the_sign_in_banner", async ({ page }) => {
  await start(page, "Stale — test.user", "Published");
  await expect(page.getByTestId("gai-auth-banner")).toBeVisible();
  await expect(page.getByTestId("gai-auth-detail")).toHaveText("Sign in to Stale in the agent chat first.");
  const calls = await proxyCalls(page);
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) expect([c.instance, c.headers["x-gnimsys-pod-proxy"], c.headers.authorization]).toEqual(["stale", "1", undefined]);
  expect(await podCalls(page)).toEqual([]);
});

test("streamed_draft_turn_with_mode_switch_trace_and_raw_frames", async ({ page }) => {
  // JET, the theme, the Core Pack and the icon font come from the build: the page loads nothing from another origin.
  const foreign: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith(ORIGIN + "/")) foreign.push(r.url()); });
  // A side panel's width (the conversations drawer then starts closed, as an overlay).
  await page.setViewportSize({ width: 560, height: 900 });
  await start(page, "Dev 1 — test.user", "Draft");

  await expect(page.getByTestId("gai-mode-switch")).toContainText("Chat");
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);
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

  // Trace (the host pairs ui.trace.roles with the user's roles) and the raw frames of the reply.
  await expect(page.getByTestId("gai-trace-toggle")).toHaveText("Trace (3)");
  const raw = page.getByTestId("gai-raw-toggle");
  await expect(raw).toHaveText("Raw frames (7)");
  await raw.click();
  const frames = page.getByTestId("gai-raw-frame");
  await expect(frames).toHaveCount(7);
  await frames.last().scrollIntoViewIfNeeded();
  await expect(frames.last()).toBeVisible();
  await expect(frames.first()).toContainText('#1 {"nodeProgressMessage"');
  await expect(frames.last()).toContainText('"finishReason":"stop"');

  // The page called the proxy (CSRF header, no credentials of its own); the proxy called the pod's /debug with its bearer.
  const debug = (await proxyCalls(page)).filter((c) => c.path.endsWith("/debug"));
  expect(debug.map((c) => [c.method, c.instance, c.target, c.path, c.headers["x-gnimsys-pod-proxy"], c.headers.authorization]))
    .toEqual([["POST", "dev1", "FUAI", "/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/debug", "1", undefined]]);
  const pod = await podCalls(page);
  const run = pod.filter((c) => c.url.includes("/MOCK_WF/"));
  expect(run.map((c) => c.url)).toEqual(["/api/fusion-ai/orchestrator/agent/v2/MOCK_WF/debug"]);
  expect(run[0].headers.authorization).toBe("Bearer fake-pod-token");
  expect(typeof run[0].headers["x-ora-ai-api-v2-check"]).toBe("string");
  expect(run[0].body).toMatchObject({ message: "hello", workflowCode: "MOCK_WF", invocationMode: "ADMIN", debugParams: { isDebug: true, breakPoints: [] } });
  expect(pod.some((c) => c.url.includes("/workflows?") && decodeURIComponent(c.url).includes("status='DRAFT'"))).toBe(true);
  expect(foreign).toEqual([]);
  // Visual self-check (after the collapsible's expand animation).
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/debug-host-draft-turn.png" });
});

test("not_configured_turn_shows_the_proxy_reason", async ({ page }) => {
  await start(page, "No Config — test.user", "Published");
  await expect(page.getByTestId("dbg-notices")).toContainText("No Config is missing setup: FUAI token key");
  await page.getByTestId("gai-composer-input").locator("textarea").fill("hello");
  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-error")).toContainText("Instance No Config is not configured for FUAI calls (missing FUAI token key)");
});
