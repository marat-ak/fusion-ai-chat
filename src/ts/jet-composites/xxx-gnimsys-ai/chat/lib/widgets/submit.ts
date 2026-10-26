import type { Button, Field, FormBlock, Scalar } from "./block";

/**
 * The submit (contract rev 2 §3): ONE user message per click = a readable line, a newline and the envelope
 * `<gnimsysSubmit id="<widgetId>">{json}</gnimsysSubmit>`, whose JSON holds every field (hidden included) under its id —
 * the option values (never labels); an unset single value is null, an unset multi value is [] — with the clicked
 * button's `data` merged on top (button keys win). The workflow parses the envelope from
 * `$context.$system.$inputMessage` with ENVELOPE_RE and routes on the button's data keys.
 */
export type Value = Scalar | null | Scalar[];
export type Values = Record<string, Value>;

export const ENVELOPE_RE = /<gnimsysSubmit id="([^"]+)">(.*?)<\/gnimsysSubmit>/;
const ENVELOPE_LINE_RE = /^<gnimsysSubmit id="[^"]+">.*<\/gnimsysSubmit>$/;

const isMulti = (f: Field): boolean => f.type === "checkbox" || (f.type === "select" && f.multi);

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

/** The ids of the required fields that have no value (a button with `validate` refuses to submit while there are any). */
export function missingRequired(block: FormBlock, values: Values): string[] {
  return block.fields
    .filter((f) => f.type !== "hidden" && f.required)
    .filter((f) => {
      const v = normalize(f, values[f.id]);
      return v === null || (Array.isArray(v) && v.length === 0);
    })
    .map((f) => f.id);
}

/** The readable line: `<button label> — <title>`, the label alone without a title. */
export function readableLine(block: FormBlock, button: Button): string {
  return block.title !== undefined ? `${button.label} — ${block.title}` : button.label;
}

/** The whole user message of a click. */
export function submitText(block: FormBlock, values: Values, button: Button): string {
  const json: Values = {};
  // A hidden field is never edited: it always echoes the block's value.
  for (const f of block.fields) json[f.id] = f.type === "hidden" ? f.value : normalize(f, values[f.id]);
  Object.assign(json, button.data);
  return `${readableLine(block, button)}\n<gnimsysSubmit id="${block.id}">${JSON.stringify(json)}</gnimsysSubmit>`;
}

/** A submit found in a user message. */
export interface Submit { id: string; values: Values }

/** Every envelope in a user message (an envelope whose JSON does not parse is skipped). */
export function submitsIn(text: string): Submit[] {
  const out: Submit[] = [];
  const re = new RegExp(ENVELOPE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const values = JSON.parse(m[2]) as unknown;
      if (typeof values === "object" && values !== null && !Array.isArray(values)) out.push({ id: m[1], values: values as Values });
    } catch {
      // not a submit of ours
    }
  }
  return out;
}

const sameValue = (a: Value | undefined, b: Value): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/** The button a submit was made with: the one whose every `data` entry is in the submitted JSON (button data is unique per block). */
export function clickedButton(block: FormBlock, submit: Submit): Button | undefined {
  return block.buttons.find((b) => Object.entries(b.data).every(([k, v]) => sameValue(submit.values[k], v)));
}

/** The user message without its envelope lines (what the user's bubble shows: the readable line). */
export function withoutEnvelopes(text: string): string {
  return text.split("\n").filter((l) => !ENVELOPE_LINE_RE.test(l)).join("\n");
}
