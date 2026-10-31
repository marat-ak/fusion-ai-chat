import type { Button, Field, FormBlock, Scalar, SelectField } from "./block";

/**
 * The submit (contract §3): ONE user message per click = a readable line, a newline and the envelope
 * `<gnimsysSubmit id="<widgetId>">{json}</gnimsysSubmit>`, whose JSON holds every field (hidden included) under its id —
 * the option values (never labels); an unset single value is null, an unset multi value is [] — with the clicked
 * button's `data` merged on top (button keys win). A select with `submit: "item"` (rev 5) carries the whole selected
 * row instead of its value: an object for a single select (null when unset), an array of objects in the selection's
 * order for a multi select ([] when unset). The workflow parses the envelope from `$context.$system.$inputMessage` with
 * ENVELOPE_RE and routes on the button's data keys.
 */
export type Value = Scalar | null | Scalar[];
export type Values = Record<string, Value>;
/** A selected row as the select's data has it: an inline option, a REST row, a report row. */
export type Row = Record<string, unknown>;
/** What one field carries in an envelope: a value (or values), or a row (or rows) of an item select. */
export type SubmitValue = Value | Row | Row[];
/** The rows of the current selection of each `submit: "item"` select (by field id), as its data provider gave them. */
export type Items = Record<string, Row[]>;

export const ENVELOPE_RE = /<gnimsysSubmit id="([^"]+)">(.*?)<\/gnimsysSubmit>/;
const ENVELOPE_LINE_RE = /^<gnimsysSubmit id="[^"]+">.*<\/gnimsysSubmit>$/;

const isMulti = (f: Field): boolean => f.type === "checkbox" || (f.type === "select" && f.multi);
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/** A select that submits whole rows. */
export const submitsItems = (f: Field): f is SelectField => f.type === "select" && f.submit === "item";
/** The row field that is a select's option value (its key): the datasource's `valueField`, an inline option's `value`. */
export const keyFieldOf = (f: SelectField): string => (f.source !== undefined ? f.source.valueField : "value");

/** The block's initial values: each field's `value` (null / [] when it has none). */
export function initialValues(block: FormBlock): Values {
  const out: Values = {};
  for (const f of block.fields) out[f.id] = f.value;
  return out;
}

/** One field's value as the submit carries it (null / [] when unset). */
function normalize(f: Field, v: Value | undefined): Value {
  if (isMulti(f)) return Array.isArray(v) ? v : [];
  if (Array.isArray(v) || v === undefined || v === "") return null;
  return v;
}

/** The selected keys of a field (none for an unset value). */
const keysOf = (f: Field, v: Value | undefined): Scalar[] => {
  const n = normalize(f, v);
  return n === null ? [] : Array.isArray(n) ? n : [n];
};

/** The known rows of an item select's selected keys, in the selection's order (a key without a known row is left out). */
function rowsOf(f: SelectField, v: Value | undefined, items: Items): Row[] {
  const key = keyFieldOf(f);
  const rows = items[f.id] ?? [];
  return keysOf(f, v).map((k) => rows.find((r) => r[key] === k)).filter((r): r is Row => r !== undefined);
}

/** The ids of the required fields that have no value (a button with `validate` refuses to submit while there are any). */
export function missingRequired(block: FormBlock, values: Values): string[] {
  return block.fields
    .filter((f) => f.type !== "hidden" && f.required)
    .filter((f) => keysOf(f, values[f.id]).length === 0)
    .map((f) => f.id);
}

/**
 * The ids of the `submit: "item"` selects with a selected key whose row is not known (the data provider has not given
 * it): a button with `validate` refuses to submit while there are any, since the envelope would lack the row.
 */
export function unresolvedItems(block: FormBlock, values: Values, items: Items): string[] {
  return block.fields.filter(submitsItems).filter((f) => rowsOf(f, values[f.id], items).length < keysOf(f, values[f.id]).length).map((f) => f.id);
}

/** The readable line: `<button label> — <title>`, the label alone without a title. */
export function readableLine(block: FormBlock, button: Button): string {
  return block.title !== undefined ? `${button.label} — ${block.title}` : button.label;
}

/** The whole user message of a click; `items` holds the selected rows of the `submit: "item"` selects. */
export function submitText(block: FormBlock, values: Values, button: Button, items: Items = {}): string {
  const json: Record<string, SubmitValue> = {};
  for (const f of block.fields) {
    // A hidden field is never edited: it always echoes the block's value.
    if (f.type === "hidden") json[f.id] = f.value;
    else if (submitsItems(f)) {
      const rows = rowsOf(f, values[f.id], items);
      json[f.id] = f.multi ? rows : rows[0] ?? null;
    } else json[f.id] = normalize(f, values[f.id]);
  }
  Object.assign(json, button.data);
  return `${readableLine(block, button)}\n<gnimsysSubmit id="${block.id}">${JSON.stringify(json)}</gnimsysSubmit>`;
}

/** A submit found in a user message. */
export interface Submit { id: string; values: Record<string, SubmitValue> }

/** Every envelope in a user message (an envelope whose JSON does not parse is skipped). */
export function submitsIn(text: string): Submit[] {
  const out: Submit[] = [];
  const re = new RegExp(ENVELOPE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const values = JSON.parse(m[2]) as unknown;
      if (isRow(values)) out.push({ id: m[1], values: values as Record<string, SubmitValue> });
    } catch {
      // not a submit of ours
    }
  }
  return out;
}

/**
 * The submitted rows of an item select (what its read-only re-render shows when nothing else knows them); none for a
 * field that does not submit items or whose submitted value is not a row / an array of rows.
 */
export function submittedRows(f: Field, submit: Submit): Row[] {
  if (!submitsItems(f)) return [];
  const v = submit.values[f.id];
  return (Array.isArray(v) ? v : [v]).filter(isRow);
}

/**
 * The field values a submit shows in the read-only block: as submitted, an item select's row(s) turned back into its
 * key(s) (the select shows a value by its key).
 */
export function submittedValues(block: FormBlock, submit: Submit): Values {
  const out: Values = {};
  for (const [id, v] of Object.entries(submit.values)) {
    const f = block.fields.find((x) => x.id === id);
    if (f !== undefined && submitsItems(f)) {
      const key = keyFieldOf(f);
      const keys = submittedRows(f, submit).map((r) => r[key]).filter((k): k is Scalar => typeof k === "string" || typeof k === "number");
      out[id] = f.multi ? keys : keys[0] ?? null;
    } else if (!isRow(v) && !(Array.isArray(v) && v.some(isRow))) out[id] = v as Value;
  }
  return out;
}

const sameValue = (a: SubmitValue | undefined, b: Scalar | Scalar[]): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/** The button a submit was made with: the one whose every `data` entry is in the submitted JSON (button data is unique per block). */
export function clickedButton(block: FormBlock, submit: Submit): Button | undefined {
  return block.buttons.find((b) => Object.entries(b.data).every(([k, v]) => sameValue(submit.values[k], v)));
}

/** The user message without its envelope lines (what the user's bubble shows: the readable line). */
export function withoutEnvelopes(text: string): string {
  return text.split("\n").filter((l) => !ENVELOPE_LINE_RE.test(l)).join("\n");
}
