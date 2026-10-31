import { expect, test, type Page } from "@playwright/test";

// Host page = src/index.html (default mock config: datasources.allowInline off). Mock pod chat fixtures (tests/mock-pod):
// "pick subinventory" -> a reply whose text carries a gnimsys-ui form (24-option required select `subinv`, hidden `txnRef`
// = "KRN-TXN-1", buttons Approve {decision: APPROVE} / Back {decision: BACK} with validate:false), the fence split
// across two deltas, follow-ups "Show more", "Cancel"; "pick from datasource" -> a select searched and paged through
// GET /fscmRestApi/resources/11.13.18.05/subinventories (300 rows; the url's fixed q `OrganizationCode='M1'` and the
// typed text as `UPPER(Description) LIKE '%<TYPED>%'`, minChars 2);
// "choose next step" -> a radio (with descriptions) + checkbox + hidden block with a confirm button, then an invalid block.
const MOCK_POD = "http://localhost:8787";

type MockRequest = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** The REST-Framework-Version of every subinventories request the pod got (the provider's expression syntax needs >= 2). */
async function subinventoryVersions(page: Page): Promise<string[]> {
  return [...new Set((await mockRequests(page)).filter((q) => q.url.includes("/subinventories")).map((q) => q.headers["rest-framework-version"]))];
}

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

/** The avatars beside assistant bubbles (one per reply: the reply's further messages are indented, without one). */
const replyAvatars = (page: Page) => page.locator("div:has(> [data-testid='gai-bubble-assistant']) > .gai-avatar");

test("a_reply_shows_as_separate_messages_the_markdown_and_each_form_block_in_its_own_bubble", async ({ page }) => {
  await page.goto("/");
  await sendText(page, "pick subinventory");
  const bubbles = page.getByTestId("gai-bubble-assistant");
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toBeVisible();
  // Streamed (the fence split across two deltas), then replaced by the final output: the markdown before the block, the
  // block alone, the markdown after it, in order; one avatar for the reply; the block's JSON is not shown as text.
  await expect(bubbles).toHaveCount(3);
  expect(await bubbles.evaluateAll((els) => els.map((e) => e.getAttribute("data-part")))).toEqual(["text", "block", "text"]);
  await expect(bubbles.nth(0).locator("strong")).toHaveText("Destination");
  await expect(bubbles.nth(0)).toContainText("Pick the destination subinventory and approve.");
  await expect(bubbles.nth(1).getByTestId("gai-widget")).toBeVisible();
  await expect(bubbles.nth(1)).not.toContainText("Pick the destination");
  await expect(bubbles.nth(2)).toHaveText("You can also go back to change the quantity.");
  await expect(replyAvatars(page)).toHaveCount(1);
  await expect(page.locator(".gai-feed")).not.toContainText('"kind"');
  await expect(bubbles.locator("pre")).toHaveCount(0);
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
  // allowInline + a matching prefix: the url's fixed q alone lists the first page; the dropdown's text (after minChars 2)
  // is and-ed to it as a case-insensitive contains on the label; the page size is the config's, the picked row's value
  // (not its label) is submitted, and the read-only block fetches the selected label back by key.
  await page.addInitScript((cfg) => { (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = cfg; }, DS_CONFIG);
  await page.goto("/");
  await sendText(page, "pick from datasource");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await expect(page.getByTestId("gai-widget-field-subinv")).not.toContainText("datasource not allowed");

  const input = page.getByTestId("gai-widget-field-subinv").locator("input");
  // Opening the dropdown lists the first page (the fixed filter only, 10 rows of 300).
  await input.click();
  await expect(page.getByRole("option").first()).toHaveText("Main Store 1");
  await expect.poll(async () => (await subinventoryQueries(page)).length).toBeGreaterThanOrEqual(1);
  expect((await subinventoryQueries(page))[0]).toMatchObject({ q: "OrganizationCode='M1'", limit: "10", offset: "0", fields: "SubinventoryCode,Description" });

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
  const searched = "(OrganizationCode='M1') and UPPER(Description) LIKE '%RA%'";
  expect(queries.slice(afterOne).map((q) => [q.q, q.limit])).toEqual(queries.slice(afterOne).map(() => [searched, "10"]));
  expect(queries[afterOne]).toMatchObject({ q: searched, limit: "10", offset: "0" });
  expect(await subinventoryVersions(page)).toEqual(["4"]);
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
      dataSource: { type: "rest", target: "FA", method: "GET", url: "/fscmRestApi/resources/11.13.18.05/subinventories?q=OrganizationCode='M1'&fields=SubinventoryCode,Description" },
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
  // customer-owned source: allowInline stays off), searched on the code (searchField) while the label is shown.
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
              dataSource: { type: "rest", target: "FA", method: "GET", url: "/fscmRestApi/resources/11.13.18.05/subinventories" },
              valueField: "SubinventoryCode", labelField: "Description", searchField: "SubinventoryCode", searchTemplate: { minChars: 1, debounceMs: 0 },
            },
          },
        },
      },
    };
  });
  await page.goto("/");
  await sendText(page, "pick subinventory");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await page.getByTestId("gai-widget-field-subinv").locator("input").fill("1230");
  await expect(page.getByRole("option")).toHaveText(["Line 2 Floor Stock 300"]);
  expect((await subinventoryQueries(page)).at(-1)).toMatchObject({ q: "UPPER(SubinventoryCode) LIKE '%1230%'", limit: "25", offset: "0" });
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

test("a_paused_reply_and_a_reply_reopened_from_history_split_at_their_block_too", async ({ page }) => {
  // The AP supplier pick's shape: an explanation, a prompt line, one block.
  const block = '```gnimsys-ui\n{"v":1,"kind":"form","id":"pick","title":"Pick","fields":[{"id":"x","type":"select","options":[{"value":"1","label":"One"}]}],"buttons":[{"id":"ok","label":"OK","data":{"decision":"OK"}}]}\n```';
  const reply = `The supplier was not matched: no candidate has its tax registration.\n\nPick the supplier:\n\n${block}\n`;
  const expectSplit = async (): Promise<void> => {
    const bubbles = page.getByTestId("gai-bubble-assistant");
    await expect(bubbles).toHaveCount(2);
    expect(await bubbles.evaluateAll((els) => els.map((e) => e.getAttribute("data-part")))).toEqual(["text", "block"]);
    await expect(bubbles.nth(0)).toContainText("no candidate has its tax registration.");
    await expect(bubbles.nth(0)).toContainText("Pick the supplier:");
    await expect(bubbles.nth(1).getByTestId("gai-widget")).toBeVisible();
    await expect(replyAvatars(page)).toHaveCount(1);
  };
  // A HUMAN wait whose message is the reply: the reply splits; the HITL bar stays below it.
  await page.route("**/api/fusion-ai/orchestrator/agent/v2/*/chat", (route) => route.fulfill({
    status: 200, contentType: "text/event-stream",
    body: `data: ${JSON.stringify({ jobId: "job-p" })}\n\n` + `data: ${JSON.stringify({ message: { finishReason: "wait" },
      waitingNodeDetails: { type: "HUMAN", initialMessage: reply, callbackToken: "cb-p", approvalEnabledFlag: true } })}\n\n`,
  }));
  await page.goto("/");
  await sendText(page, "pause with a pick");
  await expect(page.getByTestId("gai-hitl")).toBeVisible();
  await expectSplit();

  // The same reply reopened from Oracle's history.
  await page.route("**/api/fusion-ai/orchestrator/conversations/v1/*/messages", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ type: "AI", text: reply }] }) }));
  await page.addInitScript(() => { (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "split-reply"; });
  await page.goto("/");
  await expectSplit();
});

// ---- BI Publisher report datasource, dropdown tables, item submit (rev 5) ---------------------------------------------

const REPORT_PATH = "/xmlpserver/services/ExternalReportWSSService";
const REPORT_CONFIG = { ...DS_CONFIG, datasources: { allowInline: true, allowPrefixes: ["/xmlpserver/"], pageSize: 10 } };

/** The runReport calls the mock pod got: their content type and parameters (name -> values) as the SOAP body carries them. */
async function reportRuns(page: Page): Promise<Array<{ contentType: string; report: string; params: Record<string, string[]> }>> {
  return (await mockRequests(page)).filter((q) => q.method === "POST" && q.url === REPORT_PATH).map((q) => {
    const body = String(q.body);
    const params: Record<string, string[]> = {};
    for (const m of body.matchAll(/<pub:item><pub:name>([^<]*)<\/pub:name><pub:values>(.*?)<\/pub:values><\/pub:item>/g)) {
      params[m[1]] = [...m[2].matchAll(/<pub:item>([^<]*)<\/pub:item>/g)].map((v) => v[1]);
    }
    return { contentType: q.headers["content-type"], report: /<pub:reportAbsolutePath>([^<]*)</.exec(body)?.[1] ?? "", params };
  });
}

const SITE_ROW = '{"VENDOR_SITE_ID":400002,"VENDOR_NAME":"Smith & Sons","VENDOR_NUMBER":"S1001","VENDOR_SITE_CODE":"CHI-01","CITY":"Chicago","SITE_LABEL":"Smith & Sons — CHI-01"}';

test("report_select_shows_a_table_searches_through_the_report_and_submits_whole_items_single_and_multi", async ({ page }) => {
  // Mock pod "pick supplier site": `site` = a single select over the SUPPLIER_SITES report searched by its P_SEARCH
  // (minChars 2), `notify` = a multi select over the same report run once and filtered here on VENDOR_SITE_CODE; both
  // show their dropdown as a table and submit whole rows. Two selects, two dropdowns, debounced runs: past the 30 s default.
  test.setTimeout(90_000);
  await page.addInitScript((cfg) => { (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = cfg; }, REPORT_CONFIG);
  await page.goto("/");
  await sendText(page, "pick supplier site");
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toBeVisible();
  const site = widget.getByTestId("gai-widget-field-site");
  await expect(site).not.toContainText("datasource not allowed");

  // Opening lists the report's unsearched rows as a table with the configured columns.
  await site.locator("input").click();
  await expect(page.getByRole("columnheader")).toHaveText(["Supplier", "Number", "Site", "City"]);
  // oj-c-table renders the first column as each row's header cell.
  await expect(page.getByRole("rowheader").first()).toHaveText("Smith & Sons");
  await expect.poll(async () => (await reportRuns(page)).length).toBe(1);
  expect((await reportRuns(page))[0]).toEqual({
    contentType: "application/soap+xml; charset=utf-8", report: "/Custom/Gnimsys/LOV/SUPPLIER_SITES.xdo", params: { P_BU_NAME: ["US1 Business Unit"], P_SEARCH: [""] },
  });

  // The typed text is the report's P_SEARCH (the report matches); a row click picks the row.
  await site.locator("input").fill("smith");
  await expect(page.getByRole("row").filter({ has: page.getByRole("gridcell") })).toHaveCount(3);
  expect((await reportRuns(page)).map((r) => r.params.P_SEARCH)).toEqual([[""], ["smith"]]);
  await page.getByRole("gridcell", { name: "CHI-01" }).click();
  await expect(site.locator("input")).toHaveValue("Smith & Sons — CHI-01");

  // The multi select: one run (no P_SEARCH), the text filters its rows here; the table's row selection is the value.
  const notify = widget.getByTestId("gai-widget-field-notify");
  await notify.locator("input").click();
  await notify.locator("input").fill("SFO");
  await expect(page.getByRole("gridcell", { name: "SFO-02" })).toBeVisible();
  // A multi table row's first cell is its selector (the checkbox inside is a visual, aria-disabled): clicking it toggles.
  const selector = (code: string) => page.getByRole("row").filter({ has: page.getByRole("gridcell", { name: code }) }).getByRole("gridcell").first();
  await selector("SFO-02").click();
  await selector("SFO-03").click();
  await page.keyboard.press("Escape");
  await expect(notify).toContainText("Acme Corp — SFO-02");
  await expect(notify).toContainText("Northwind Traders — SFO-03");
  expect((await reportRuns(page)).filter((r) => r.params.P_SEARCH === undefined)).toHaveLength(1);

  await widget.getByTestId("gai-widget-button-ok").locator("button").click();
  await expect.poll(async () => (await chatMessages(page)).at(-1)).toBe(
    `OK — Pick the supplier site\n<gnimsysSubmit id="supplierSite">{"site":${SITE_ROW},"notify":[`
    + '{"VENDOR_SITE_ID":400013,"VENDOR_NAME":"Acme Corp","VENDOR_SITE_CODE":"SFO-02","SITE_LABEL":"Acme Corp — SFO-02"},'
    + '{"VENDOR_SITE_ID":400023,"VENDOR_NAME":"Northwind Traders","VENDOR_SITE_CODE":"SFO-03","SITE_LABEL":"Northwind Traders — SFO-03"}'
    + '],"decision":"OK"}</gnimsysSubmit>',
  );
  await expect(widget).toHaveAttribute("data-submitted", "ok");
  await expect(site).toContainText("Smith & Sons — CHI-01");
});

/** The report block of the mock fixture with a single `site` field (the report and its columns as given). */
const reportBlock = (reportName: string): string => "```gnimsys-ui\n" + JSON.stringify({
  v: 1, kind: "form", id: "supplierSite", title: "Pick the supplier site",
  fields: [{
    id: "site", type: "select", label: "Supplier site", required: true,
    dataSource: {
      type: "BIPReport", target: "FA", reportName, recordsetSelector: "DATA_DS", recordSelector: "G_1",
      columns: [{ name: "VENDOR_SITE_ID", type: 2 }, { name: "VENDOR_NAME" }, { name: "VENDOR_NUMBER" }, { name: "VENDOR_SITE_CODE" }, { name: "CITY" }, { name: "SITE_LABEL" }],
      parameters: [{ name: "P_BU_NAME", value: "US1 Business Unit" }], searchParam: "P_SEARCH",
    },
    valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL", searchTemplate: { minChars: 2 },
    collectionTemplateTable: [{ field: "VENDOR_NAME", headerText: "Supplier" }, { field: "VENDOR_SITE_CODE", headerText: "Site" }],
    submit: "item",
  }],
  buttons: [{ id: "ok", label: "OK", data: { decision: "OK" } }],
}) + "\n```";

/** Opens a conversation from history whose messages are `items` (oldest first) under `config`. */
async function openHistory(page: Page, id: string, items: Array<{ type: string; text: string }>, config: object): Promise<void> {
  await page.route("**/api/fusion-ai/orchestrator/conversations/v1/*/messages", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [...items].reverse() }) }));
  await page.addInitScript(([cfg, conv]) => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = cfg as object;
    (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = conv as string;
  }, [config, id] as const);
  await page.goto("/");
}

test("item_select_reopened_from_history_shows_its_submitted_row_without_running_the_report", async ({ page }) => {
  const submit = `OK — Pick the supplier site\n<gnimsysSubmit id="supplierSite">{"site":${SITE_ROW},"decision":"OK"}</gnimsysSubmit>`;
  await openHistory(page, "report-history", [{ type: "AI", text: reportBlock("/Custom/Gnimsys/LOV/SUPPLIER_SITES.xdo") }, { type: "USER", text: submit }], REPORT_CONFIG);
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toHaveAttribute("data-submitted", "ok");
  await expect(widget.getByTestId("gai-widget-field-site")).toContainText("Smith & Sons — CHI-01");
  await page.waitForTimeout(500);
  expect(await reportRuns(page)).toEqual([]);
});

test("a_report_fault_shows_on_the_field", async ({ page }) => {
  await openHistory(page, "report-fault", [{ type: "AI", text: reportBlock("/Custom/Gnimsys/LOV/MISSING.xdo") }], REPORT_CONFIG);
  const field = page.getByTestId("gai-widget-field-site");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await field.locator("input").click();
  await expect(field).toContainText("report /Custom/Gnimsys/LOV/MISSING.xdo failed: oracle.xdo.webservice.exception.AccessDeniedException: "
    + "PublicReportService::executeReport Failure: Failed to read the report /Custom/Gnimsys/LOV/MISSING.xdo");
  expect((await reportRuns(page)).map((r) => r.report)).toContain("/Custom/Gnimsys/LOV/MISSING.xdo");
});

test("inline_row_options_show_as_a_table_and_submit_the_picked_option_row", async ({ page }) => {
  // The agent's own candidates (a CODE node's rows): value + label + more fields, a table over them, the whole row submitted.
  const block = "```gnimsys-ui\n" + JSON.stringify({
    v: 1, kind: "form", id: "candidate", title: "Pick the supplier",
    fields: [{
      id: "cand", type: "select", label: "Candidate", required: true, submit: "item",
      options: [
        { value: "C1", label: "Smith & Sons — NYC-01", supplier: "Smith & Sons", site: "NYC-01", taxId: "11-111" },
        { value: "C2", label: "Acme Corp — SFO-02", supplier: "Acme Corp", site: "SFO-02", taxId: null },
      ],
      collectionTemplateTable: [{ field: "supplier", headerText: "Supplier" }, { field: "site", headerText: "Site" }, { field: "taxId", headerText: "Tax ID" }],
    }],
    buttons: [{ id: "ok", label: "OK", data: { decision: "OK" } }],
  }) + "\n```";
  await openHistory(page, "inline-rows", [{ type: "AI", text: block }], DS_CONFIG);
  const field = page.getByTestId("gai-widget-field-cand");
  await field.locator("input").click();
  await expect(page.getByRole("columnheader")).toHaveText(["Supplier", "Site", "Tax ID"]);
  await page.getByRole("gridcell", { name: "SFO-02" }).click();
  await expect(field.locator("input")).toHaveValue("Acme Corp — SFO-02");
  await page.getByTestId("gai-widget-button-ok").locator("button").click();
  await expect.poll(async () => (await chatMessages(page)).at(-1)).toBe(
    'OK — Pick the supplier\n<gnimsysSubmit id="candidate">{"cand":{"value":"C2","label":"Acme Corp — SFO-02","supplier":"Acme Corp","site":"SFO-02","taxId":null},"decision":"OK"}</gnimsysSubmit>',
  );
});

// ---- BOSS datasource (Business Objects API: $filter / $limit / $offset) -----------------------------------------------

/** A mock BOSS object (no such object on a pod): the page's route serves it, the mock pod has none. */
const BOSS_OBJECT = "/api/boss/data/objects/ora/mockFamily/mockProduct/v1/$en/subinventories";
const BOSS_BLOCK = "```gnimsys-ui\n" + JSON.stringify({
  v: 1, kind: "form", id: "bossSubinv", title: "Pick a subinventory",
  fields: [{
    id: "subinv", type: "select", label: "Subinventory", required: true,
    dataSource: { type: "rest", target: "BOSS", method: "GET", url: `${BOSS_OBJECT}?$fields=subinventoryCode,description` },
    valueField: "subinventoryCode", labelField: "description", searchTemplate: { minChars: 2 },
  }],
  buttons: [{ id: "ok", label: "OK", data: { decision: "OK" } }],
}) + "\n```";
const BOSS_CONFIG = { ...DS_CONFIG, datasources: { allowInline: true, allowPrefixes: ["/api/boss/data/objects/ora/"], pageSize: 10 } };

/**
 * Serves BOSS_OBJECT as a BOSS collection: 300 rows; `$filter` as the endpoint data provider writes it for BOSS
 * (`description ~LIKE '%<text>%'`, a case-insensitive contains, or `(subinventoryCode = 'k1' or …)`), `$limit` / `$offset`, answer
 * `{items, hasMore, count, limit, offset}`; anything else in `$filter` answers 400. Returns the requests' decoded query
 * parameters.
 */
async function serveBossSubinventories(page: Page): Promise<Array<Record<string, string>>> {
  const seen: Array<Record<string, string>> = [];
  const names = ["Main Store", "Raw Materials", "Finished Goods"];
  const rows = Array.from({ length: 300 }, (_, i) => ({ subinventoryCode: String(12001 + i), description: `${names[i % names.length]} ${i + 1}` }));
  await page.route("**/api/boss/data/objects/ora/mockFamily/**", async (route) => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams.entries());
    seen.push(q);
    let hits = rows;
    if (q.$filter !== undefined) {
      const like = /^description ~LIKE '%(.*)%'$/.exec(q.$filter);
      const anyOf = /^\((.*)\)$/.exec(q.$filter);
      if (like) {
        const text = like[1].replace(/''/g, "'").toLowerCase();
        hits = rows.filter((r) => r.description.toLowerCase().includes(text));
      } else if (anyOf) {
        const keys = anyOf[1].split(" or ").map((c) => /^subinventoryCode = '(.*)'$/.exec(c)?.[1]?.replace(/''/g, "'"));
        if (keys.some((k) => k === undefined)) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: `bad $filter: ${q.$filter}` }) });
        hits = rows.filter((r) => keys.includes(r.subinventoryCode));
      } else {
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: `bad $filter: ${q.$filter}` }) });
      }
    }
    const offset = Number(q.$offset ?? 0);
    const limit = q.$limit !== undefined ? Number(q.$limit) : hits.length;
    const items = hits.slice(offset, offset + limit);
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items, hasMore: offset + items.length < hits.length, count: items.length, limit, offset }),
    });
  });
  return seen;
}

test("boss_datasource_searches_with_filter_and_pages_with_limit_and_offset", async ({ page }) => {
  // A live block (reopened from history with no submit after it) whose select reads a BOSS object (no fixed filter): the
  // first page has no $filter, the typed text becomes the $filter clause, the page size $limit, the position $offset; no
  // Fusion REST parameter is sent.
  const boss = await serveBossSubinventories(page);
  await page.route("**/api/fusion-ai/orchestrator/conversations/v1/*/messages", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ type: "AI", text: BOSS_BLOCK }] }) }));
  await page.addInitScript((cfg) => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = cfg;
    (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "boss-live";
  }, BOSS_CONFIG);
  await page.goto("/");
  const field = page.getByTestId("gai-widget-field-subinv");
  await expect(page.getByTestId("gai-widget")).toBeVisible();
  await expect(field).not.toContainText("datasource not allowed");

  const input = field.locator("input");
  await input.click();
  await expect(page.getByRole("option").first()).toHaveText("Main Store 1");
  expect(boss[0]).toEqual({ $fields: "subinventoryCode,description", $limit: "10", $offset: "0" });

  await input.fill("Ra");
  await expect(page.getByRole("option").first()).toHaveText("Raw Materials 2");
  expect(boss.some((q) => q.$filter === "description ~LIKE '%Ra%'" && q.$limit === "10" && q.$offset === "0")).toBe(true);
  for (const q of boss) expect([q.q, q.limit, q.offset, q.totalResults]).toEqual([undefined, undefined, undefined, undefined]);
  await page.getByRole("option", { name: "Raw Materials 2", exact: true }).click();

  await page.getByTestId("gai-widget-button-ok").locator("button").click();
  await expect.poll(async () => (await chatMessages(page)).at(-1)).toBe('OK — Pick a subinventory\n<gnimsysSubmit id="bossSubinv">{"subinv":"12002","decision":"OK"}</gnimsysSubmit>');
  await expect(page.getByTestId("gai-widget")).toHaveAttribute("data-submitted", "ok");
  await expect(field).toContainText("Raw Materials 2");
});

test("boss_datasource_select_rerendered_from_history_fetches_the_label_by_key", async ({ page }) => {
  // Read-only from history: the label comes from fetchByKeys, an or-chain $filter on the url without its own $filter.
  const boss = await serveBossSubinventories(page);
  await page.route("**/api/fusion-ai/orchestrator/conversations/v1/*/messages", (route) => {
    const items = [{ type: "USER", text: 'OK — Pick a subinventory\n<gnimsysSubmit id="bossSubinv">{"subinv":"12002","decision":"OK"}</gnimsysSubmit>' }, { type: "AI", text: BOSS_BLOCK }];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
  });
  await page.addInitScript((cfg) => {
    (window as unknown as { __CHAT_CONFIG__: object }).__CHAT_CONFIG__ = cfg;
    (window as unknown as { __CHAT_CONVERSATION_ID__: string }).__CHAT_CONVERSATION_ID__ = "boss-history";
  }, BOSS_CONFIG);
  await page.goto("/");
  const widget = page.getByTestId("gai-widget");
  await expect(widget).toHaveAttribute("data-submitted", "ok");
  await expect(widget.getByTestId("gai-widget-field-subinv")).toContainText("Raw Materials 2");
  const byKeys = boss.filter((q) => q.$filter?.startsWith("("));
  expect(byKeys.length).toBeGreaterThanOrEqual(1);
  expect(byKeys[0]).toEqual({ $fields: "subinventoryCode,description", $filter: "(subinventoryCode = '12002')", $limit: "1" });
});
