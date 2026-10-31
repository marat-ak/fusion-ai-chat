import { parseBlock } from "../widgets/block";
import type { FormBlock } from "../widgets/block";
import {
  ENVELOPE_RE, clickedButton, initialValues, missingRequired, readableLine, submitText, submitsIn, submittedRows, submittedValues, unresolvedItems, withoutEnvelopes,
} from "../widgets/submit";

const block = (): FormBlock => {
  const r = parseBlock(JSON.stringify({
    v: 1, kind: "form", id: "destSubinv", title: "Select the destination subinventory",
    fields: [
      { id: "subinv", type: "select", required: true, options: [{ value: "12200", label: "12200 — Main" }] },
      { id: "flags", type: "checkbox", options: [{ value: "urgent", label: "Urgent" }] },
      { id: "txnRef", type: "hidden", value: "ABC-1" },
    ],
    buttons: [{ id: "approve", label: "Approve", data: { decision: "APPROVE" } }, { id: "back", label: "Back", validate: false, data: { decision: "BACK" } }],
  }));
  if (!r.ok) throw new Error(r.reason);
  return r.block;
};

describe("submit builder (rev 2)", () => {
  test("the_contract_example_byte_for_byte", () => {
    const b = block();
    const text = submitText(b, { subinv: "12200", flags: ["urgent"] }, b.buttons[0]);
    expect(text).toBe('Approve — Select the destination subinventory\n<gnimsysSubmit id="destSubinv">{"subinv":"12200","flags":["urgent"],"txnRef":"ABC-1","decision":"APPROVE"}</gnimsysSubmit>');
  });

  test("unset_values_are_null_or_empty_array_and_the_back_button_merges_its_own_data", () => {
    const b = block();
    expect(submitText(b, initialValues(b), b.buttons[1]))
      .toBe('Back — Select the destination subinventory\n<gnimsysSubmit id="destSubinv">{"subinv":null,"flags":[],"txnRef":"ABC-1","decision":"BACK"}</gnimsysSubmit>');
  });

  test("button_data_wins_over_a_field_of_the_same_id", () => {
    const b = block();
    b.buttons[0].data = { subinv: "FORCED", decision: "APPROVE" };
    expect(submitText(b, { subinv: "12200" }, b.buttons[0])).toContain('{"subinv":"FORCED","flags":[],"txnRef":"ABC-1","decision":"APPROVE"}');
  });

  test("without_a_title_the_readable_line_is_the_label_alone", () => {
    const { title: _t, ...b } = block();
    expect(readableLine(b, b.buttons[0])).toBe("Approve");
    expect(submitText(b, {}, b.buttons[0]).split("\n")[0]).toBe("Approve");
  });

  test("the_envelope_is_one_line_the_workflow_regex_parses", () => {
    const b = block();
    const text = submitText(b, { subinv: 12200, flags: [] }, b.buttons[0]);
    const m = ENVELOPE_RE.exec(text);
    expect(m).not.toBeNull();
    expect([m![1], JSON.parse(m![2])]).toEqual(["destSubinv", { subinv: 12200, flags: [], txnRef: "ABC-1", decision: "APPROVE" }]);
    expect(text.split("\n")).toHaveLength(2);
    expect(text).not.toContain("kind=");
    expect(text).not.toContain("action=");
  });

  test("missing_required_ignores_hidden_and_optional_fields", () => {
    const b = block();
    expect(missingRequired(b, initialValues(b))).toEqual(["subinv"]);
    expect(missingRequired(b, { subinv: "" })).toEqual(["subinv"]);
    expect(missingRequired(b, { subinv: "12200" })).toEqual([]);
    const multi = parseBlock(JSON.stringify({ v: 1, kind: "form", id: "m", buttons: [{ id: "a", label: "A", data: { d: 1 } }], fields: [{ id: "f", type: "checkbox", required: true, options: [{ value: 1, label: "1" }] }] }));
    if (!multi.ok) throw new Error(multi.reason);
    expect(missingRequired(multi.block, { f: [] })).toEqual(["f"]);
    expect(missingRequired(multi.block, { f: [1] })).toEqual([]);
  });

  test("submits_in_a_user_message_the_clicked_button_and_the_bubble_text_without_envelopes", () => {
    const b = block();
    const text = submitText(b, { subinv: "12200" }, b.buttons[1]);
    const submits = submitsIn(text);
    expect(submits).toEqual([{ id: "destSubinv", values: { subinv: "12200", flags: [], txnRef: "ABC-1", decision: "BACK" } }]);
    expect(clickedButton(b, submits[0])?.id).toBe("back");
    expect(clickedButton(b, { id: "destSubinv", values: { subinv: "12200" } })).toBeUndefined();
    expect(withoutEnvelopes(text)).toBe("Back — Select the destination subinventory");
    expect(submitsIn("hello")).toEqual([]);
    expect(withoutEnvelopes("hello")).toBe("hello");
    expect(submitsIn('<gnimsysSubmit id="x">not json</gnimsysSubmit>')).toEqual([]);
    // The rev-1 envelope (with attributes) is not a submit any more.
    expect(submitsIn('<gnimsysSubmit id="x" kind="form" action="a">{"a":1}</gnimsysSubmit>')).toEqual([]);
  });

  test("item_selects_submit_whole_rows_single_an_object_multi_an_array_in_selection_order", () => {
    const report = {
      type: "BIPReport", target: "FA", reportName: "/Custom/R.xdo", recordsetSelector: "DATA_DS", recordSelector: "G_1",
      columns: [{ name: "SITE_ID", type: 2 }, { name: "SUPPLIER" }, { name: "SITE" }],
    };
    const r = parseBlock(JSON.stringify({
      v: 1, kind: "form", id: "pick", title: "Pick",
      fields: [
        { id: "site", type: "select", required: true, dataSource: report, valueField: "SITE_ID", labelField: "SITE", submit: "item" },
        { id: "notify", type: "select", multi: true, dataSource: report, valueField: "SITE_ID", labelField: "SITE", submit: "item" },
        { id: "cand", type: "select", submit: "item", options: [{ value: "C1", label: "Smith — NYC", supplier: "Smith" }, { value: "C2", label: "Acme — SFO", supplier: "Acme" }] },
        { id: "plain", type: "select", options: [{ value: "P", label: "Plain" }] },
      ],
      buttons: [{ id: "ok", label: "OK", data: { decision: "OK" } }, { id: "back", label: "Back", validate: false, data: { decision: "BACK" } }],
    }));
    if (!r.ok) throw new Error(r.reason);
    const b = r.block;
    const s1 = { SITE_ID: 400002, SUPPLIER: "Smith & Sons", SITE: "CHI-01" };
    const s2 = { SITE_ID: 400013, SUPPLIER: "Acme Corp", SITE: "SFO-02" };
    const s3 = { SITE_ID: 400023, SUPPLIER: "Northwind", SITE: "SFO-03" };
    const c2 = { value: "C2", label: "Acme — SFO", supplier: "Acme" };
    const items = { site: [s1], notify: [s3, s2], cand: [c2], plain: [{ value: "P", label: "Plain" }] };
    const values = { site: 400002, notify: [400013, 400023], cand: "C2", plain: "P" };
    const text = submitText(b, values, b.buttons[0], items);
    expect(text).toBe('OK — Pick\n<gnimsysSubmit id="pick">{"site":{"SITE_ID":400002,"SUPPLIER":"Smith & Sons","SITE":"CHI-01"},'
      + '"notify":[{"SITE_ID":400013,"SUPPLIER":"Acme Corp","SITE":"SFO-02"},{"SITE_ID":400023,"SUPPLIER":"Northwind","SITE":"SFO-03"}],'
      + '"cand":{"value":"C2","label":"Acme — SFO","supplier":"Acme"},"plain":"P","decision":"OK"}</gnimsysSubmit>');
    // The envelope is still one line the workflow regex parses.
    expect(JSON.parse(ENVELOPE_RE.exec(text)![2]).notify.map((x: { SITE_ID: number }) => x.SITE_ID)).toEqual([400013, 400023]);
    // Unset: null / [].
    expect(submitText(b, initialValues(b), b.buttons[1], {})).toContain('{"site":null,"notify":[],"cand":null,"plain":null,"decision":"BACK"}');
    // A selected key whose row is not known yet: unresolved (a validating button refuses); validate:false sends what is known.
    expect(unresolvedItems(b, values, items)).toEqual([]);
    expect(unresolvedItems(b, values, { ...items, notify: [s2] })).toEqual(["notify"]);
    expect(unresolvedItems(b, values, {})).toEqual(["site", "notify", "cand"]);
    expect(submitText(b, values, b.buttons[1], { notify: [s2] })).toContain('{"site":null,"notify":[{"SITE_ID":400013,"SUPPLIER":"Acme Corp","SITE":"SFO-02"}],"cand":null,"plain":"P","decision":"BACK"}');
    expect(missingRequired(b, values)).toEqual([]);

    // Read back from the envelope: the rows (a history re-render's data), the keys the select shows, the clicked button.
    const submit = submitsIn(text)[0];
    expect(submittedRows(b.fields[1], submit)).toEqual([s2, s3]);
    expect(submittedRows(b.fields[3], submit)).toEqual([]);
    expect(submittedValues(b, submit)).toEqual({ site: 400002, notify: [400013, 400023], cand: "C2", plain: "P", decision: "OK" });
    expect(clickedButton(b, submit)?.id).toBe("ok");
  });

  test("clicked_button_matches_array_data", () => {
    const b = block();
    b.buttons[0].data = { decision: ["A", "B"] };
    expect(clickedButton(b, { id: "destSubinv", values: { decision: ["A", "B"] } })?.id).toBe("approve");
    expect(clickedButton(b, { id: "destSubinv", values: { decision: ["A"] } })).toBeUndefined();
  });
});
