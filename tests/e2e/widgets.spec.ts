import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config: datasources.allowInline off). Mock pod chat fixtures (tests/mock-pod):
// "pick subinventory" -> a reply whose text carries a gnimsys-ui form (24-option required select `subinv`, hidden `txnRef`
// = "KRN-TXN-1", buttons Approve {decision: APPROVE} / Back {decision: BACK} with validate:false), the fence split
// across two deltas, follow-ups "Show more", "Cancel"; "pick from datasource" -> a select searched and paged through
// GET /fscmRestApi/resources/11.13.18.05/subinventories (300 rows, `Description LIKE '<typed>%'`, minChars 2);
// "choose next step" -> a radio (with descriptions) + checkbox + hidden block with a confirm button, then an invalid block.
const MOCK_POD = "http://localhost:8787";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };

async function mockRequests(page: Page): Promise<MockRequest[]> {
  const r = await page.request.get(`${MOCK_POD}/__mock/requests`);
  return (await r.json()) as MockRequest[];
}

async function chatMessages(page: Page): Promise<string[]> {
  return (await mockRequests(page)).filter((q) => q.url.includes("/chat")).map((q) => (q.body as { message: string }).message);
}

/** The subinventories datasource requests, as the pod saw them: their decoded query parameters. */
async function subinventoryQueries(page: Page): Promise<Array<Record<string, string>>> {
  return (await mockRequests(page))
    .filter((q) => q.url.includes("/subinventories"))
    .map((q) => Object.fromEntries(new URL(q.url, "http://mock-pod").searchParams.entries()));
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.getByTestId("gai-composer-input").locator("textarea").fill(text);
  await page.getByTestId("gai-composer-send").locator("button").click();
}

/** Picks an option of a Core Pack select-single by typing into its input and choosing the match from the dropdown. */
async function pickSingle(page: Page, fieldId: string, text: string, option: string): Promise<void> {
  // fill() focuses the input itself: a click could land on the field's own label.
  const input = page.getByTestId(`gai-widget-field-${fieldId}`).locator("input");
  await input.fill(text);
  await page.getByRole("option", { name: option }).click();
}

const APPROVE_12200 = 'Approve — Select the destination subinventory\n<gnimsysSubmit id="destSubinv">{"subinv":"12200","txnRef":"KRN-TXN-1","decision":"APPROVE"}</gnimsysSubmit>';
const BACK_EMPTY = 'Back — Select the destination subinventory\n<gnimsysSubmit id="destSubinv">{"subinv":null,"txnRef":"KRN-TXN-1","decision":"BACK"}</gnimsysSubmit>';

const DS_CONFIG = {
  mode: "chat",
  agent: { workflowCode: "MOCK_WF" },
  auth: { kind: "fusionShell" },
  protocol: { checkVersion: "2607100" },
  ui: { conversations: false },
  datasources: { allowInline: true, allowPrefixes: ["/fscmRestApi/resources/"], pageSize: 10 },
};

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK_POD}/__mock/reset`);
  await page.request.delete(`${MOCK_POD}/__mock/requests`);
});

test("form_block_renders_in_place_with_the_markdown_around_it", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "pick subinventory");
  const bubble = page.getByTestId("gai-bubble-assistant");
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toBeVisible();
  // The markdown before and after the block renders; the block's JSON is not shown as text.
  await expect(bubble.locator("strong")).toHaveText("Destination");
  await expect(bubble).toContainText("You can also go back to change the quantity.");
  await expect(bubble).not.toContainText('"kind"');
  await expect(bubble.locator("pre")).toHaveCount(0);
  await expect(page.getByTestId("gai-widget-title")).toHaveText("Select the destination subinventory");
  await expect(page.getByTestId("gai-widget-field-subinv")).toBeVisible();
  // The hidden field has no control; the two buttons are there; Oracle's follow-up chips stay.
  await expect(page.getByTestId("gai-widget-field-txnRef")).toHaveCount(0);
  await expect(page.getByTestId("gai-widget-button-approve").locator("button")).toBeEnabled();
  await expect(page.getByTestId("gai-widget-button-back").locator("button")).toBeEnabled();
  await expect(page.getByTestId("gai-followup")).toHaveText(["Show more", "Cancel"]);
  // 24 options in the dropdown.
  await page.getByTestId("gai-widget-field-subinv").locator("input").click();
  await expect(page.getByRole("option")).toHaveCount(24);
  await page.keyboard.press("Escape");
});

test("approve_submits_the_values_and_button_data_as_one_message_and_makes_the_block_read_only", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "pick subinventory");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  const approve = page.getByTestId("gai-widget-button-approve").locator("button");
  // Approve on the empty required select: nothing goes out, the field shows its required message.
  await approve.click();
  await expect(page.getByTestId("gai-widget-field-subinv")).toContainText("Select a value.");
  await expect.poll(() => chatMessages(page)).toEqual(["pick subinventory"]);

  await pickSingle(page, "subinv", "12200", "12200 — Main Store");
  await approve.click();
  // ONE user message: the readable line + the envelope, byte for byte (contract §3); the bubble shows the readable line.
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["pick subinventory", "Approve — Select the destination subinventory"]);
  await expect(page.getByTestId("gai-bubble-assistant").last()).toHaveText("Hello! How can I help?");
  await expect.poll(() => chatMessages(page)).toEqual(["pick subinventory", APPROVE_12200]);

  // The block is read-only: the value stays shown, every button is disabled, the clicked one is marked.
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toHaveAttribute("data-submitted", "approve");
  await expect(widget.getByTestId("gai-widget-field-subinv")).toContainText("12200 — Main Store");
  await expect(widget.getByTestId("gai-widget-field-subinv").locator("input")).toHaveCount(0);
  await expect(widget.getByTestId("gai-widget-button-approve").locator("button")).toBeDisabled();
  await expect(widget.getByTestId("gai-widget-button-back").locator("button")).toBeDisabled();
  await expect(widget.getByTestId("gai-widget-button-approve").locator(".oj-ux-ico-check")).toHaveCount(1);
});

test("back_with_validate_false_submits_null_for_the_empty_required_field", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "pick subinventory");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await page.getByTestId("gai-widget-button-back").locator("button").click();
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["pick subinventory", "Back — Select the destination subinventory"]);
  await expect.poll(() => chatMessages(page)).toEqual(["pick subinventory", BACK_EMPTY]);
  await expect(page.getByTestId("gai-widget")).toHaveAttribute("data-submitted", "back");
});

test("inline_datasource_is_refused_by_default", async ({ page }) => {
  // Default config: allowInline off -> the field is unavailable, OK (validates) is disabled, Back still submits.
  await page.goto("/");
  await sendText(page, "pick from datasource");
  const field = page.getByTestId("gai-widget-field-subinv");
  await expect(field).toContainText("datasource not allowed: datasources.allowInline is off");
  await expect(page.getByTestId("gai-widget-button-ok").locator("button")).toBeDisabled();
  await expect(page.getByTestId("gai-widget-button-back").locator("button")).toBeEnabled();
  expect(await subinventoryQueries(page)).toEqual([]);
  await page.getByTestId("gai-widget-button-back").locator("button").click();
  await expect.poll(async () => (await chatMessages(page)).at(-1)).toBe('Back — Pick a subinventory\n<gnimsysSubmit id="dsSubinv">{"subinv":null,"decision":"BACK"}</gnimsysSubmit>');
});

test("inline_datasource_searches_and_pages_on_the_server_and_submits_the_value_only", async ({ page }) => {
  // allowInline + a matching prefix: the dropdown's text goes to the pod as the q filter (after minChars 2), the page
  // size is the config's, the picked row's value (not its label) is submitted, and the read-only block fetches the
  // selected label back by key.
  await page.addInitScript((cfg) => { (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = cfg; }, DS_CONFIG);
  await page.goto("/");
  await sendText(page, "pick from datasource");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await expect(page.getByTestId("gai-widget-field-subinv")).not.toContainText("datasource not allowed");

  const input = page.getByTestId("gai-widget-field-subinv").locator("input");
  // Opening the dropdown lists the first page (empty query, 10 rows of 300).
  await input.click();
  await expect(page.getByRole("option").first()).toHaveText("Main Store 1");
  await expect.poll(async () => (await subinventoryQueries(page)).length).toBeGreaterThanOrEqual(1);
  expect((await subinventoryQueries(page))[0]).toMatchObject({ q: "Description LIKE '%'", limit: "10", offset: "0", fields: "SubinventoryCode,Description" });

  // One character is below minChars: no request; two characters filter on the server.
  await input.fill("R");
  await page.waitForTimeout(400);
  const afterOne = (await subinventoryQueries(page)).length;
  await input.fill("Ra");
  await expect(page.getByRole("option").first()).toHaveText("Raw Materials 2");
  const queries = await subinventoryQueries(page);
  expect(queries.length).toBeGreaterThan(afterOne);
  // Every request after the two characters carries the filter and the configured page size (a component asking for
  // more rows than a page iterates the pages: offsets 0, 10, …).
  expect(queries.slice(afterOne).map((q) => [q.q, q.limit])).toEqual(queries.slice(afterOne).map(() => ["Description LIKE 'Ra%'", "10"]));
  expect(queries[afterOne]).toMatchObject({ q: "Description LIKE 'Ra%'", limit: "10", offset: "0" });
  await page.getByRole("option", { name: "Raw Materials 2", exact: true }).click();

  await page.getByTestId("gai-widget-button-ok").locator("button").click();
  await expect.poll(async () => (await chatMessages(page)).at(-1)).toBe('OK — Pick a subinventory\n<gnimsysSubmit id="dsSubinv">{"subinv":"12002","decision":"OK"}</gnimsysSubmit>');
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toHaveAttribute("data-submitted", "ok");
  await expect(widget.getByTestId("gai-widget-field-subinv")).toContainText("Raw Materials 2");
});

test("datasource_select_rerendered_from_history_fetches_the_selected_label_by_key", async ({ page }) => {
  // A conversation reopened from history: the block mounts read-only with the submitted value only, so the label can
  // come from nowhere but fetchByKeys (an IN clause on the url without its q).
  const block = "```gnimsys-ui\n" + JSON.stringify({
    v: 1, kind: "form", id: "dsSubinv", title: "Pick a subinventory",
    fields: [{
      id: "subinv", type: "select", label: "Subinventory", required: true,
      dataSource: { type: "rest", target: "FA", method: "GET", url: "/fscmRestApi/resources/11.13.18.05/subinventories?q=Description LIKE '{{query}}%'&fields=SubinventoryCode,Description" },
      valueField: "SubinventoryCode", labelField: "Description",
    }],
    buttons: [{ id: "ok", label: "OK", data: { decision: "OK" } }],
  }) + "\n```";
  await page.route("**/api/fusion-ai/orchestrator/conversations/v1/*/messages", async (route) => {
    const items = [{ type: "USER", text: 'OK — Pick a subinventory\n<gnimsysSubmit id="dsSubinv">{"subinv":"12002","decision":"OK"}</gnimsysSubmit>' }, { type: "AI", text: block }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
  });
  await page.addInitScript((cfg) => {
    (window as unknown as { __CHAT_CONFIG__: object; __CHAT_CONVERSATION_ID__: string }).__CHAT_CONFIG__ = cfg;
    (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "ds-history";
  }, DS_CONFIG);
  await page.goto("/");
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toHaveAttribute("data-submitted", "ok");
  await expect(widget.getByTestId("gai-widget-field-subinv")).toContainText("Raw Materials 2");
  const byKeys = (await subinventoryQueries(page)).filter((q) => q.q?.startsWith("SubinventoryCode IN ("));
  expect(byKeys.length).toBeGreaterThanOrEqual(1);
  expect(byKeys[0]).toMatchObject({ q: "SubinventoryCode IN ('12002')", limit: "1", fields: "SubinventoryCode,Description" });
  expect(byKeys[0].offset).toBeUndefined();
});

test("config_overlay_datasource_wins_over_the_inline_options", async ({ page }) => {
  // The KRN block carries 24 inline options; the overlay points its `subinv` field at the pod's subinventories (a
  // customer-owned source: allowInline stays off).
  await page.addInitScript(() => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = {
      mode: "chat",
      agent: { workflowCode: "MOCK_WF" },
      auth: { kind: "fusionShell" },
      protocol: { checkVersion: "2607100" },
      ui: { conversations: false },
      widgets: {
        destSubinv: {
          fields: {
            subinv: {
              dataSource: { type: "rest", target: "FA", method: "GET", url: "/fscmRestApi/resources/11.13.18.05/subinventories?q=Description LIKE '{{query}}%'" },
              valueField: "SubinventoryCode", labelField: "Description", searchTemplate: { minChars: 1, debounceMs: 0 },
            },
          },
        },
      },
    };
  });
  await page.goto("/");
  await sendText(page, "pick subinventory");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await page.getByTestId("gai-widget-field-subinv").locator("input").fill("Scrap 2");
  await expect(page.getByRole("option")).toHaveText(["Scrap 21", "Scrap 213", "Scrap 237", "Scrap 261", "Scrap 285"]);
  expect((await subinventoryQueries(page)).at(-1)).toMatchObject({ q: "Description LIKE 'Scrap 2%'", limit: "25", offset: "0" });
  await page.keyboard.press("Escape");
});

test("radio_checkbox_confirm_and_an_invalid_block_error_box", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "choose next step");
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toBeVisible();
  // The invalid block after it: an error box with the reason and the raw text, the valid one still works.
  const error = page.getByTestId("gai-widget-error");
  await expect(error).toContainText("Widget block not shown");
  await expect(error).toContainText("fields[0]: options and dataSource are both present");
  await expect(page.getByTestId("gai-widget-raw")).toContainText('"id":"broken"');

  // Radio with descriptions, checkbox.
  const step = widget.getByTestId("gai-widget-field-step");
  await expect(step).toContainText("Post the transaction now");
  await step.getByText("Modify", { exact: true }).click();
  await widget.getByTestId("gai-widget-field-flags").getByText("Urgent", { exact: true }).click();

  // Go has a confirm: the inline question, Cancel keeps the block live, OK submits.
  await widget.getByTestId("gai-widget-button-go").locator("button").click();
  await expect(page.getByTestId("gai-widget-confirm")).toContainText("Post the transaction?");
  await page.getByTestId("gai-widget-confirm-cancel").locator("button").click();
  await expect(page.getByTestId("gai-widget-confirm")).toHaveCount(0);
  await expect.poll(() => chatMessages(page)).toEqual(["choose next step"]);
  await widget.getByTestId("gai-widget-button-go").locator("button").click();
  await page.getByTestId("gai-widget-confirm-ok").locator("button").click();
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["choose next step", "Go"]);
  await expect.poll(async () => (await chatMessages(page)).at(-1)).toBe('Go\n<gnimsysSubmit id="nextStep">{"step":"modify","flags":["urgent"],"txnRef":"KRN-TXN-1","decision":"GO"}</gnimsysSubmit>');
  await expect(widget).toHaveAttribute("data-submitted", "go");
});

test("history_rerender_shows_a_submitted_block_read_only", async ({ page }) => {
  // The conversation has the block, then the user's submit: reopened from history it renders read-only; reopened
  // without the submit it is live.
  const block = '```gnimsys-ui\n{"v":1,"kind":"form","id":"destSubinv","title":"T","fields":[{"id":"subinv","type":"select","options":[{"value":"12200","label":"Main"}]}],"buttons":[{"id":"submit","label":"Submit","data":{"decision":"SUBMIT"}}]}\n```';
  await page.route("**/api/fusion-ai/orchestrator/conversations/v1/*/messages", async (route) => {
    const id = decodeURIComponent(route.request().url().split("/conversations/v1/")[1].split("/")[0]);
    const items = id === "with-submit"
      ? [{ type: "AI", text: block }, { type: "USER", text: 'Submit — T\n<gnimsysSubmit id="destSubinv">{"subinv":"12200","decision":"SUBMIT"}</gnimsysSubmit>' }]
      : [{ type: "AI", text: block }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: items.reverse() }) });
  });
  await page.addInitScript(() => { (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "with-submit"; });
  await page.goto("/");
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toHaveAttribute("data-submitted", "submit");
  await expect(widget.getByTestId("gai-widget-field-subinv")).toContainText("Main");
  await expect(widget.getByTestId("gai-widget-button-submit").locator("button")).toBeDisabled();
  await expect(page.getByTestId("gai-bubble-user")).toHaveText(["Submit — T"]);

  await page.addInitScript(() => { (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "no-submit"; });
  await page.goto("/");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await expect(page.getByTestId("gai-widget")).not.toHaveAttribute("data-submitted");
  await expect(page.getByTestId("gai-widget-button-submit").locator("button")).toBeEnabled();
});
