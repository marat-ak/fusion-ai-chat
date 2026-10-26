import { parseBlock } from "../widgets/block";
import type { FormBlock } from "../widgets/block";
import { ENVELOPE_RE, clickedButton, initialValues, missingRequired, readableLine, submitText, submitsIn, withoutEnvelopes } from "../widgets/submit";

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

  test("clicked_button_matches_array_data", () => {
    const b = block();
    b.buttons[0].data = { decision: ["A", "B"] };
    expect(clickedButton(b, { id: "destSubinv", values: { decision: ["A", "B"] } })?.id).toBe("approve");
    expect(clickedButton(b, { id: "destSubinv", values: { decision: ["A"] } })).toBeUndefined();
  });
});
