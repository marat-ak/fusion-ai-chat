import { applyOverlay, parseBlock, splitBlocks } from "../widgets/block";
import type { FormBlock } from "../widgets/block";

const fence = (json: string, lang = "gnimsys-ui") => "```" + lang + "\n" + json + "\n```";
const buttons = [{ id: "approve", label: "Approve", data: { decision: "APPROVE" } }, { id: "back", label: "Back", validate: false, data: { decision: "BACK" } }];
const subinv = {
  v: 1, kind: "form", id: "destSubinv", title: "Select the destination subinventory",
  fields: [
    { id: "subinv", type: "select", label: "Destination", required: true, options: [{ value: "12200", label: "12200 — Main" }, { value: "12205", label: "12205 — Raw" }] },
    { id: "txnRef", type: "hidden", value: "KRN-TXN-1" },
  ],
  buttons,
};
const ok = (v: unknown): FormBlock => {
  const r = parseBlock(JSON.stringify(v));
  if (!r.ok) throw new Error(r.reason);
  return r.block;
};
const reason = (v: unknown): string => {
  const r = parseBlock(typeof v === "string" ? v : JSON.stringify(v));
  if (r.ok) throw new Error("expected a failure");
  return r.reason;
};

describe("splitBlocks", () => {
  test("extracts_closed_blocks_and_keeps_the_markdown_around_them", () => {
    const text = `Intro\n\n${fence("{\"a\":1}")}\n\nMiddle\n\n${fence("{\"b\":2}")}\nTail`;
    expect(splitBlocks(text)).toEqual([
      { kind: "text", text: "Intro\n" },
      { kind: "block", index: 0, raw: "{\"a\":1}" },
      { kind: "text", text: "\nMiddle\n" },
      { kind: "block", index: 1, raw: "{\"b\":2}" },
      { kind: "text", text: "Tail" },
    ]);
  });

  test("an_unclosed_fence_stays_text_until_it_closes", () => {
    const partial = "Pick:\n\n```gnimsys-ui\n{ \"v\": 1,";
    expect(splitBlocks(partial)).toEqual([{ kind: "text", text: partial }]);
    expect(splitBlocks(partial + " \"kind\": \"form\" }\n```")).toEqual([
      { kind: "text", text: "Pick:\n" },
      { kind: "block", index: 0, raw: "{ \"v\": 1, \"kind\": \"form\" }" },
    ]);
  });

  test("other_fences_pass_through_and_hide_a_nested_gnimsys_ui_fence", () => {
    const text = "````markdown\n```gnimsys-ui\n{}\n```\n````\n" + fence("{}");
    expect(splitBlocks(text)).toEqual([
      { kind: "text", text: "````markdown\n```gnimsys-ui\n{}\n```\n````" },
      { kind: "block", index: 0, raw: "{}" },
    ]);
    expect(splitBlocks(fence("x = 1", "python"))).toEqual([{ kind: "text", text: fence("x = 1", "python") }]);
  });

  test("plain_text_is_one_segment", () => {
    expect(splitBlocks("Hello")).toEqual([{ kind: "text", text: "Hello" }]);
    expect(splitBlocks("")).toEqual([{ kind: "text", text: "" }]);
  });
});

describe("parseBlock", () => {
  test("the_krn_block_parses_with_defaults_applied", () => {
    const b = ok(subinv);
    expect(b.id).toBe("destSubinv");
    expect(b.fields[0]).toMatchObject({ type: "select", multi: false, required: true, value: null });
    expect(b.fields[1]).toEqual({ id: "txnRef", type: "hidden", value: "KRN-TXN-1" });
    expect(b.buttons).toEqual([
      { id: "approve", label: "Approve", data: { decision: "APPROVE" }, variant: "callToAction", validate: true },
      { id: "back", label: "Back", data: { decision: "BACK" }, variant: "outlined", validate: false },
    ]);
  });

  test("buttons_are_required_each_with_non_empty_unique_data", () => {
    const { buttons: _b, ...noButtons } = subinv;
    expect(reason(noButtons)).toContain("buttons: must be a non-empty array");
    expect(reason({ ...subinv, buttons: [] })).toContain("buttons: must be a non-empty array");
    expect(reason({ ...subinv, buttons: [{ id: "a", label: "A" }] })).toContain("buttons[0].data: must be a non-empty object");
    expect(reason({ ...subinv, buttons: [{ id: "a", label: "A", data: {} }] })).toContain("buttons[0].data: must be a non-empty object");
    expect(reason({ ...subinv, buttons: [{ id: "a", label: "A", data: { x: { nested: 1 } } }] })).toContain("buttons[0].data.x: must be a string, number or array of them");
    expect(reason({ ...subinv, buttons: [{ id: "a", label: "A", data: { d: "X" } }, { id: "b", label: "B", data: { d: "X" } }] })).toContain("buttons[1].data: equals buttons[0].data");
    // Same keys in another order are the same data.
    expect(reason({ ...subinv, buttons: [{ id: "a", label: "A", data: { d: "X", e: [1, 2] } }, { id: "b", label: "B", data: { e: [1, 2], d: "X" } }] })).toContain("buttons[1].data: equals buttons[0].data");
    // Different data (a different value, or an extra key) is fine.
    const b = ok({ ...subinv, buttons: [{ id: "a", label: "A", data: { d: "X" } }, { id: "b", label: "B", data: { d: "X", more: 1 } }] });
    expect(b.buttons.map((x) => x.data)).toEqual([{ d: "X" }, { d: "X", more: 1 }]);
  });

  test("radio_and_checkbox_with_descriptions_and_initial_values", () => {
    const b = ok({
      v: 1, kind: "form", id: "c", buttons, fields: [
        { id: "step", type: "radio", options: [{ value: "a", label: "A", description: "first" }, { value: "b", label: "B" }], value: "a" },
        { id: "flags", type: "checkbox", options: [{ value: 1, label: "One" }], value: [1] },
        { id: "many", type: "select", multi: true, options: [{ value: "x", label: "X" }], value: ["x"] },
      ],
    });
    expect(b.fields[0]).toMatchObject({ type: "radio", value: "a", options: [{ value: "a", label: "A", description: "first" }, { value: "b", label: "B" }] });
    expect(b.fields[1]).toMatchObject({ type: "checkbox", value: [1] });
    expect(b.fields[2]).toMatchObject({ type: "select", multi: true, value: ["x"] });
  });

  test("select_from_a_datasource_with_a_search_template", () => {
    const ds = { type: "rest", target: "FA", method: "GET", url: "/fscmRestApi/resources/x?q=Name LIKE '{{query}}%'" };
    const b = ok({ v: 1, kind: "form", id: "d", buttons, fields: [{ id: "s", type: "select", dataSource: ds, valueField: "Code", labelField: "Name", searchTemplate: { minChars: 2, debounceMs: 100 } }] });
    expect(b.fields[0]).toMatchObject({ type: "select", source: { dataSource: { target: "FA", url: ds.url }, valueField: "Code", labelField: "Name", searchTemplate: { minChars: 2, debounceMs: 100 }, fromConfig: false } });
    expect(reason({ v: 1, kind: "form", id: "d", buttons, fields: [{ id: "s", type: "select", dataSource: ds, valueField: "Code", labelField: "Name", searchTemplate: { minChars: -1 } }] }))
      .toContain("fields[0].searchTemplate.minChars: must be a non-negative integer");
    expect(reason({ v: 1, kind: "form", id: "d", buttons, fields: [{ id: "s", type: "select", dataSource: ds, valueField: "Code", labelField: "Name", searchTemplate: { param: "q" } }] }))
      .toContain("fields[0].searchTemplate.param: unknown key");
    expect(reason({ v: 1, kind: "form", id: "d", buttons, fields: [{ id: "s", type: "select", options: [{ value: 1, label: "1" }], searchTemplate: {} }] }))
      .toContain("fields[0]: options and dataSource are both present");
  });

  test("invalid_json_names_the_parse_error", () => {
    expect(reason("{ not json")).toMatch(/^not valid JSON: /);
  });

  test("wrong_version_kind_and_id", () => {
    expect(reason({ ...subinv, v: 2 })).toContain("v: must be 1");
    expect(reason({ ...subinv, kind: "table" })).toContain('kind: must be "form"');
    expect(reason({ ...subinv, kind: "choice" })).toContain('kind: must be "form"');
    expect(reason({ ...subinv, id: "bad id!" })).toContain("id: must match");
  });

  test("unknown_keys_and_duplicate_ids", () => {
    expect(reason({ ...subinv, extra: 1 })).toContain("extra: unknown key");
    expect(reason({ ...subinv, fields: [subinv.fields[0], subinv.fields[0]] })).toContain('fields[1].id: duplicate field id "subinv"');
    expect(reason({ ...subinv, buttons: [buttons[0], { ...buttons[0], data: { decision: "OTHER" } }] })).toContain('buttons[1].id: duplicate button id "approve"');
    expect(reason({ ...subinv, fields: [{ id: "h", type: "hidden", label: "x" }] })).toContain("fields[0].label: unknown key (not for hidden)");
    expect(reason({ ...subinv, fields: [{ id: "r", type: "radio", multi: true, options: [{ value: 1, label: "1" }] }] })).toContain("fields[0].multi: unknown key");
    expect(reason({ ...subinv, buttons: [{ ...buttons[0], action: "x" }] })).toContain("buttons[0].action: unknown key");
  });

  test("select_needs_exactly_one_option_source", () => {
    const ds = { type: "rest", target: "FA", method: "GET", url: "/fscmRestApi/resources/x" };
    expect(reason({ ...subinv, fields: [{ id: "s", type: "select" }] })).toContain("fields[0]: needs options or a dataSource with valueField and labelField");
    expect(reason({ ...subinv, fields: [{ id: "s", type: "select", options: [{ value: 1, label: "1" }], dataSource: ds, valueField: "a", labelField: "b" }] }))
      .toContain("fields[0]: options and dataSource are both present");
    expect(reason({ ...subinv, fields: [{ id: "s", type: "select", dataSource: ds }] })).toContain("fields[0].valueField: must be a non-empty string");
    expect(reason({ ...subinv, fields: [{ id: "s", type: "select", dataSource: { ...ds, target: "X" }, valueField: "a", labelField: "b" }] }))
      .toContain("fields[0].dataSource.target: must be one of");
  });

  test("unknown_field_type_empty_fields_and_bad_values", () => {
    expect(reason({ ...subinv, fields: [{ id: "t", type: "text" }] })).toContain("fields[0].type: must be one of select, radio, checkbox, hidden");
    expect(reason({ ...subinv, fields: [] })).toContain("fields: must be a non-empty array");
    expect(reason({ ...subinv, fields: [{ id: "s", type: "select", options: [{ value: "a", label: "A" }], value: ["a"] }] })).toContain("fields[0].value: must be a string or number");
    expect(reason({ ...subinv, fields: [{ id: "c", type: "checkbox", options: [{ value: "a", label: "A" }], value: "a" }] })).toContain("fields[0].value: must be an array");
    expect(reason({ ...subinv, fields: [{ id: "s", type: "select", options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }] })).toContain("duplicate option value \"a\"");
    expect(reason({ ...subinv, fields: [{ id: "s", type: "select", options: [{ value: "a", label: "A", description: "d" }] }] })).toContain("fields[0].options[0].description: unknown key");
  });

  test("button_rules", () => {
    expect(reason({ ...subinv, buttons: [{ id: "a", data: { d: 1 } }] })).toContain("buttons[0].label: must be a non-empty string");
    expect(reason({ ...subinv, buttons: [{ id: "a", label: "A", data: { d: 1 }, variant: "danger" }] })).toContain("buttons[0].variant: must be one of");
    expect(reason({ ...subinv, buttons: [{ id: "a", label: "A", data: { d: 1 }, confirm: "" }] })).toContain("buttons[0].confirm: must be a non-empty string");
    const b = ok({ ...subinv, buttons: [{ id: "a", label: "A", data: { d: [1, "x"] }, variant: "borderless", confirm: "Sure?" }] });
    expect(b.buttons[0]).toEqual({ id: "a", label: "A", data: { d: [1, "x"] }, variant: "borderless", validate: true, confirm: "Sure?" });
  });
});

describe("applyOverlay", () => {
  const ds = { dataSource: { type: "rest" as const, target: "FA" as const, method: "GET" as const, url: "/fscmRestApi/resources/subinventories?q=Name LIKE '{{query}}%'" }, valueField: "Code", labelField: "Name", searchTemplate: { minChars: 3 } };

  test("the_overlay_datasource_replaces_the_inline_options", () => {
    const b = applyOverlay(ok(subinv), { fields: { subinv: ds } });
    expect(b.fields[0]).toMatchObject({ type: "select", source: { ...ds, fromConfig: true } });
    expect((b.fields[0] as { options?: unknown }).options).toBeUndefined();
    expect(b.fields[1]).toEqual({ id: "txnRef", type: "hidden", value: "KRN-TXN-1" });
  });

  test("no_overlay_or_a_foreign_field_leaves_the_block_alone", () => {
    const b = ok(subinv);
    expect(applyOverlay(b, undefined)).toBe(b);
    expect(applyOverlay(b, { fields: { other: ds } })).toEqual(b);
  });
});
