import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config: workflow MOCK_WF, starters "fromWorkflow"; rest-helper = the mock VB
// RestHelper, endpoint = the six contract names -> mock service connections, every call to the mock pod).
// Mock pod chat fixtures by message: "hello" (any other text too) -> "Hel","lo!" deltas, final "Hello! How can I help?"
// + follow-ups; "fail" -> error final "ErrorRecord[boom]"; "unsafe html" -> a final with an overlay div, a remote image,
// a raw anchor and form controls; "long list" -> a heading, a paragraph and a 26-item numbered list + follow-ups
// "Show more", "Cancel". BOSS workflows -> starters "Show my invoices", "Create a PO".
const MOCK_POD = "http://localhost:8787";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };

async function mockRequests(page: Page): Promise<MockRequest[]> {
  const r = await page.request.get(`${MOCK_POD}/__mock/requests`);
  return (await r.json()) as MockRequest[];
}

async function chatRequests(page: Page): Promise<MockRequest[]> {
  return (await mockRequests(page)).filter((r) => r.url.includes("/chat"));
}

// The testids of Core Pack (oj-c) controls sit on the custom element: typing, clicks and enabled/disabled checks go to its
// inner <textarea>/<input>/<button> (a click on the custom element would not wait for the inner control to be enabled).
async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId("gai-composer-input").locator("textarea").fill(text);
  await page.getByTestId("gai-composer-send").locator("button").click();
}

test.beforeEach(async ({ page }) => {
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
});

test("starters_from_workflow_render_and_send", async ({ page }) => {
  await page.goto("/");
  const starters = page.getByTestId("gai-starter");
  await expect(starters).toHaveText(["Show my invoices", "Create a PO"]);
  // The starters sit in the agent's greeting bubble.
  await expect(page.getByTestId("gai-greeting-text")).toHaveText("How can I help you?");
  await expect(page.getByTestId("gai-greeting").getByTestId("gai-starter")).toHaveCount(2);

  await starters.first().locator("button").click();
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["Show my invoices"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(page.getByTestId("gai-starter")).toHaveCount(0);
  await expect(page.getByTestId("gai-greeting")).toHaveCount(0);
  expect(((await chatRequests(page)).at(-1)?.body as { message?: string }).message).toBe("Show my invoices");
});

test("send_hello_streams_and_shows_followups", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toBeEnabled();
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

test("enter_send_empties_composer", async ({ page }) => {
  await page.goto("/");
  const input = page.getByTestId("gai-composer-input").locator("textarea");
  // Enter keeps the focus in the field while the composer is disabled for the turn and enabled again after it.
  await input.fill("hello");
  await input.press("Enter");
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["hello"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(input).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("gai-composer-send").locator("button")).toBeDisabled();
});

test("followup_click_sends_text", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "hello");
  const followup = page.getByTestId("gai-followup").filter({ hasText: "Show invoices" });
  await expect(followup).toBeVisible();

  await followup.locator("button").click();
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
  // The error final and the error event are one reply: exactly one assistant bubble, and it is the errored one.
  await expect(page.locator(".gai-bubble--assistant")).toHaveCount(1);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(0);

  const input = page.getByTestId("gai-composer-input").locator("textarea");
  await expect(input).toBeEnabled();
  await input.fill("hello");
  await expect(page.getByTestId("gai-composer-send").locator("button")).toBeEnabled();
});

test("needs_input_makes_no_requests", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = {
      agent: {},
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

test("needs_input_lists_user_userName_when_user_missing", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_USER__: object }).__CHAT_USER__ = {};
  });
  await page.goto("/");
  await expect(page.getByTestId("gai-state-panel")).toContainText("user.userName");
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);

  await page.waitForLoadState("networkidle");
  expect(await mockRequests(page)).toEqual([]);
});

test("needs_input_lists_missing_endpoints", async ({ page }) => {
  // The page's endpoint map lacks FUAI and BOSS (and, with files on, FA): nothing may be called.
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_ENDPOINTS__: object }).__CHAT_ENDPOINTS__ = { KM: "mockKM" };
  });
  await page.goto("/");
  const panel = page.getByTestId("gai-state-panel");
  await expect(panel.getByRole("heading")).toHaveText("This chat needs more configuration");
  await expect(panel.locator("li")).toHaveText([
    "endpoint.FUAI: required",
    "endpoint.BOSS: required",
    "endpoint.FA: required when files.enabled",
  ]);
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);

  await page.waitForLoadState("networkidle");
  expect(await mockRequests(page)).toEqual([]);
});

test("needs_input_lists_missing_rest_helper", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_REST_HELPER_MODE__: string }).__CHAT_REST_HELPER_MODE__ = "none";
  });
  await page.goto("/");
  await expect(page.getByTestId("gai-state-panel").locator("li")).toHaveText(["rest-helper: required"]);
  await expect(page.getByTestId("gai-composer-input")).toHaveCount(0);

  await page.waitForLoadState("networkidle");
  expect(await mockRequests(page)).toEqual([]);
});

test("relogin_banner_on_endpoint_401", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("gai-starter")).toHaveCount(2);
  // The endpoint refuses the session: the next /chat answers 401.
  await page.request.get(`${MOCK_POD}/__mock/arm?chat=401`);

  await sendText(page, "hello");
  const banner = page.getByTestId("gai-auth-banner");
  await expect(banner).toContainText("Session expired");
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toBeDisabled();
  await expect(page.getByTestId("gai-composer-send").locator("button")).toBeDisabled();
  // The turn whose call was refused ends explicitly; nothing is retried.
  await expect(page.getByTestId("gai-error")).toHaveText("No reply received");
  expect(await chatRequests(page)).toHaveLength(1);

  await Promise.all([page.waitForEvent("load"), page.getByTestId("gai-auth-reload").locator("button").click()]);
  await expect(page.getByTestId("gai-starter")).toHaveCount(2);
  await expect(page.getByTestId("gai-auth-banner")).toHaveCount(0);
});

test("relogin_banner_on_boss_401_at_mount", async ({ page }) => {
  // The mount-time workflow lookup gets 401 from the BOSS endpoint: the re-login banner, not a starters notice.
  await page.request.get(`${MOCK_POD}/__mock/arm?workflows=401`);
  await page.goto("/");
  await expect(page.getByTestId("gai-auth-banner")).toContainText("Session expired");
  await expect(page.getByTestId("gai-workflow-error")).toHaveCount(0);
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toBeDisabled();
});

test("chat_streaming_unavailable_is_an_explicit_error", async ({ page }) => {
  // A rest helper with VB's interface only (VB's RestHelper has no streaming capability): BOSS calls work, the chat call
  // is never sent and never buffered.
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_REST_HELPER_MODE__: string }).__CHAT_REST_HELPER_MODE__ = "no-stream";
  });
  await page.goto("/");
  await expect(page.getByTestId("gai-starter")).toHaveText(["Show my invoices", "Create a PO"]);

  const errors: Array<{ message: string; status?: number }> = [];
  await page.exposeFunction("__chatError", (d: { message: string; status?: number }) => { errors.push(d); });
  await page.evaluate(() => {
    document.getElementById("chat")?.addEventListener("aiChatError", (e) => {
      (window as unknown as { __chatError: (d: unknown) => void }).__chatError((e as CustomEvent).detail);
    });
  });

  const input = page.getByTestId("gai-composer-input").locator("textarea");
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-error")).toHaveText("chat streaming not available through this endpoint");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(0);
  await expect(page.getByTestId("gai-auth-banner")).toHaveCount(0);
  // The message did not go out: no user turn; the composer is usable and keeps the text (also a moment later).
  await expect(page.getByTestId("gai-bubble-user")).toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("hello");
  await page.waitForTimeout(300);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("hello");
  // It can be sent again (Enter this time): the same explicit error, still nothing sent.
  await input.press("Enter");
  await expect(page.getByTestId("gai-error")).toHaveCount(2);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("hello");
  expect(await chatRequests(page)).toEqual([]);
  await expect.poll(() => errors).toEqual([
    { message: "chat streaming not available through this endpoint" },
    { message: "chat streaming not available through this endpoint" },
  ]);
});

test("network_failure_reenables_composer_and_it_can_send_again", async ({ page }) => {
  // The first chat call fails at once without an HTTP answer (the helper's fetch rejects, as when the network is down).
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_REST_HELPER_MODE__: string }).__CHAT_REST_HELPER_MODE__ = "stream-fails-once";
  });
  await page.goto("/");
  await expect(page.getByTestId("gai-starter")).toHaveCount(2);
  const input = page.getByTestId("gai-composer-input").locator("textarea");
  // Enter: the field has the focus when the send disables it.
  await input.fill("hello");
  await input.press("Enter");
  await expect(page.getByTestId("gai-error")).toContainText("Failed to fetch");
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["hello"]);
  // The composer is usable again: emptied by the send, it takes and keeps new text (also a moment later).
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("");
  await input.fill("again");
  await page.waitForTimeout(300);
  await expect(input).toHaveValue("again");

  await page.getByTestId("gai-composer-send").locator("button").click();
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["hello", "again"]);
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("");
  // The failed call never reached the pod; the second one did.
  const chat = await chatRequests(page);
  expect(chat.map((r) => (r.body as { message: string }).message)).toEqual(["again"]);
});

test("unsafe_reply_html_is_neutralized", async ({ page }) => {
  const remote: string[] = [];
  page.on("request", (r) => { if (r.url().includes("evil.example.com")) remote.push(r.url()); });
  await page.goto("/");
  await sendText(page, "unsafe html");
  const bubble = page.getByTestId("gai-bubble-assistant");
  await expect(bubble.locator("strong")).toHaveText("bold");
  await expect(bubble).toContainText("Overlay");
  await expect(bubble.locator("[style]")).toHaveCount(0);
  await expect(bubble.locator("img")).toHaveCount(0);
  await expect(bubble).toContainText("[image: https://evil.example.com/pixel.png]");
  const a = bubble.locator("a");
  await expect(a).toHaveAttribute("target", "_blank");
  await expect(a).toHaveAttribute("rel", "noopener noreferrer");
  await expect(bubble.locator("input, button, select, textarea")).toHaveCount(0);
  expect(remote).toEqual([]);
});

test("default_height_with_scrolling_feed_and_page_override", async ({ page }) => {
  await page.goto("/");
  const host = page.locator("#chat");
  await expect(page.getByTestId("gai-starter")).toHaveCount(2);
  expect((await host.boundingBox())?.height).toBe(560);

  // Replies pile up inside the feed: the element keeps its height and the feed scrolls.
  for (let i = 1; i <= 5; i++) {
    await sendText(page, "hello");
    await expect(page.getByTestId("gai-bubble-assistant")).toHaveCount(i);
    await expect(page.getByTestId("gai-followup")).toHaveCount(2);
  }
  expect((await host.boundingBox())?.height).toBe(560);
  const feed = await page.locator(".gai-feed").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, top: el.scrollTop }));
  expect(feed.scroll).toBeGreaterThan(feed.client);
  expect(feed.top).toBeGreaterThan(0); // kept scrolled to the latest turn
  const shell = await page.locator(".gai-shell").boundingBox();
  expect(shell?.height).toBe(560);

  // The page sets its own height.
  await page.addStyleTag({ content: "#chat { height: 320px; }" });
  await expect.poll(async () => (await host.boundingBox())?.height).toBe(320);
  expect((await page.locator(".gai-shell").boundingBox())?.height).toBe(320);
});

test("workflow_lookup_failure_shows_notice", async ({ page }) => {
  await page.request.get(`${MOCK_POD}/__mock/arm?workflows=404`);
  await page.goto("/");
  // A Redwood message banner also holds an off-screen live-region text: the summary is its heading.
  await expect(page.getByTestId("gai-workflow-error").getByRole("heading")).toHaveText("Starter questions unavailable (HTTP 404)");
  await expect(page.getByTestId("gai-starter")).toHaveCount(0);
  await expect(page.getByTestId("gai-auth-banner")).toHaveCount(0);

  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(page.getByTestId("gai-workflow-error")).toHaveCount(0);
});

test("greeting_shows_without_starters", async ({ page }) => {
  // Explicit empty starters and no sidebar: the greeting alone opens the conversation, with the default texts.
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = {
      agent: { workflowCode: "MOCK_WF" },
      auth: { kind: "fusionShell" },
      protocol: { checkVersion: "2607100" },
      ui: { starterQuestions: [], conversations: false },
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("gai-greeting-text")).toHaveText("How can I help you?");
  await expect(page.getByTestId("gai-starter")).toHaveCount(0);
  const input = page.getByTestId("gai-composer-input").locator("textarea");
  await expect(input).toHaveAttribute("placeholder", "Ask a question…");

  // The first send replaces the greeting with the conversation.
  await sendText(page, "hello");
  await expect(page.getByTestId("gai-bubble-assistant")).toHaveText(["Hello! How can I help?"]);
  await expect(page.getByTestId("gai-greeting")).toHaveCount(0);
});

test("greeting_and_placeholder_from_config", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = {
      agent: { workflowCode: "MOCK_WF" },
      auth: { kind: "fusionShell" },
      protocol: { checkVersion: "2607100" },
      ui: { greeting: "Hi! Ask me about your invoices.", placeholder: "Type a question", starterQuestions: ["Show my invoices"], conversations: false },
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("gai-greeting-text")).toHaveText("Hi! Ask me about your invoices.");
  await expect(page.getByTestId("gai-greeting").getByTestId("gai-starter")).toHaveText(["Show my invoices"]);
  await expect(page.getByTestId("gai-composer-input").locator("textarea")).toHaveAttribute("placeholder", "Type a question");
});

test("component_fills_container_width_empty_and_after_reply", async ({ page }) => {
  // The host page wraps the chat in a flex column that does not stretch its items, as VB page layouts do: a chat that
  // sized itself to its content would be narrow while empty and wider after a long reply.
  await page.goto("/");
  const container = page.locator("#chat-container");
  expect(await container.evaluate((el) => getComputedStyle(el).alignItems)).toBe("flex-start");
  const widthGap = async (): Promise<{ host: number; shell: number }> => {
    const [c, h, s] = await Promise.all([container.boundingBox(), page.locator("#chat").boundingBox(), page.locator(".gai-shell").boundingBox()]);
    if (c === null || h === null || s === null) throw new Error("chat not laid out");
    return { host: Math.abs(h.width - c.width), shell: Math.abs(s.width - c.width) };
  };

  await expect(page.getByTestId("gai-greeting")).toBeVisible();
  const empty = await widthGap();
  expect(empty.host).toBeLessThanOrEqual(2);
  expect(empty.shell).toBeLessThanOrEqual(2);

  await sendText(page, "long list");
  await expect(page.getByTestId("gai-followup")).toHaveText(["Show more", "Cancel"]);
  await expect(page.getByTestId("gai-bubble-assistant").locator("ol > li")).toHaveCount(26);
  const after = await widthGap();
  expect(after.host).toBeLessThanOrEqual(2);
  expect(after.shell).toBeLessThanOrEqual(2);
});
