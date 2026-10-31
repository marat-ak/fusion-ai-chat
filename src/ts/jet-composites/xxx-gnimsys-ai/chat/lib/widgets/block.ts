import type { Problem } from "../config/types";
import { checkSource, validateDataSource, validateSourceFields } from "./datasource";
import type { DataSourceOptions, Option, Scalar } from "./datasource";

/**
 * The gnimsys-ui v1 block (contract 2026-10-26 §2; published as schemas/gnimsys-ui-v1.schema.json): a fenced
 * ```gnimsys-ui JSON block in the assistant text, kind `form`, fields `select` / `radio` / `checkbox` / `hidden` and a row
 * of buttons that all submit the same values with their own `data`. parseBlock() is the validator the component runs
 * on every block (the hand-written mirror of the schema, as config-v1 is validated); splitBlocks() finds the blocks in a
 * reply before the markdown renders.
 */

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export type { Option, Scalar } from "./datasource";

interface FieldBase { id: string; label?: string; required: boolean; help?: string }
/** One column of a select's dropdown table (`collectionTemplateTable`): the row field it shows and its header (default the field). */
export interface TableColumn { field: string; headerText?: string }
/** What a select submits: its option value(s) (`value`), or the whole selected row(s) (`item`). */
export type SelectSubmit = "value" | "item";
/**
 * `options` inline, or `source` (a datasource + the row fields), never both; `fromConfig` marks a source the config overlay
 * set. `collectionTemplateTable` shows the dropdown as a table of these columns; `submit` says what the submit carries.
 */
interface SelectBase extends FieldBase {
  type: "select"; options?: Option[]; source?: DataSourceOptions & { fromConfig: boolean }; collectionTemplateTable?: TableColumn[]; submit: SelectSubmit;
}
export interface SelectSingleField extends SelectBase { multi: false; value: Scalar | null }
export interface SelectMultiField extends SelectBase { multi: true; value: Scalar[] }
export type SelectField = SelectSingleField | SelectMultiField;
export interface RadioField extends FieldBase { type: "radio"; value: Scalar | null; options: Option[] }
export interface CheckboxField extends FieldBase { type: "checkbox"; value: Scalar[]; options: Option[] }
export interface HiddenField { id: string; type: "hidden"; value: string | null }
export type Field = SelectField | RadioField | CheckboxField | HiddenField;

export type ButtonVariant = "callToAction" | "outlined" | "borderless";
/** `data` (required, non-empty, unique per block) is merged into the submit JSON: how the workflow learns the click. */
export interface Button { id: string; label: string; data: Record<string, Scalar | Scalar[]>; variant: ButtonVariant; validate: boolean; confirm?: string }
export interface FormBlock { v: 1; kind: "form"; id: string; title?: string; fields: Field[]; buttons: Button[] }

export type BlockResult = { ok: true; block: FormBlock } | { ok: false; reason: string };

const FIELD_TYPES = ["select", "radio", "checkbox", "hidden"] as const;
const VARIANTS: readonly ButtonVariant[] = ["callToAction", "outlined", "borderless"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is Scalar => typeof v === "string" || typeof v === "number";

// ---- fence extraction ---------------------------------------------------------------------------------------------

export type Segment = { kind: "text"; text: string } | { kind: "block"; index: number; raw: string };

const FENCE = /^ {0,3}(`{3,})[ \t]*([^`\s]*)[^\n]*$/;

/**
 * Splits a reply into markdown text and the ```gnimsys-ui blocks in it (§4). Only a block whose closing fence has
 * arrived is a block: an unclosed one stays text (a streaming reply shows it as plain text until the fence closes).
 * Fences of any other language pass through as text, and a gnimsys-ui fence inside them is not a block.
 */
export function splitBlocks(text: string): Segment[] {
  const out: Segment[] = [];
  let buf: string[] = [];
  let index = 0;
  const flush = (): void => {
    if (buf.length > 0) out.push({ kind: "text", text: buf.join("\n") });
    buf = [];
  };
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const open = FENCE.exec(lines[i]);
    if (open === null) { buf.push(lines[i++]); continue; }
    const ticks = open[1].length;
    const closes = (l: string): boolean => {
      const m = /^ {0,3}(`{3,})[ \t]*$/.exec(l);
      return m !== null && m[1].length >= ticks;
    };
    let j = i + 1;
    while (j < lines.length && !closes(lines[j])) j++;
    if (open[2] === "gnimsys-ui" && j < lines.length) {
      flush();
      out.push({ kind: "block", index: index++, raw: lines.slice(i + 1, j).join("\n") });
      i = j + 1;
    } else {
      // Another fence, or an unclosed one: text up to and including its closing line (or the end).
      const end = j < lines.length ? j + 1 : lines.length;
      for (; i < end; i++) buf.push(lines[i]);
    }
  }
  flush();
  return out;
}

/** One message of a reply as the feed shows it; `key` stays the same while the reply streams on. */
export type ReplyPart = Segment & { key: string };

/**
 * The messages a reply shows as, in order: each run of markdown text between blocks is one, each ```gnimsys-ui block
 * is one; blank text between, before or after blocks shows as nothing. A reply that is blank throughout is one (empty)
 * text message, as before any split.
 */
export function replyParts(text: string): ReplyPart[] {
  const parts: ReplyPart[] = splitBlocks(text).map((s, i) => ({ ...s, key: s.kind === "block" ? `b${s.index}` : `t${i}` }));
  const shown = parts.filter((p) => p.kind === "block" || p.text.trim() !== "");
  return shown.length > 0 ? shown : parts;
}

// ---- validation ---------------------------------------------------------------------------------------------------

/** Parses and validates one block's JSON text; a failure names every problem found (the error box shows them). */
export function parseBlock(raw: string): BlockResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `not valid JSON: ${(e as Error).message}` };
  }
  const problems: Problem[] = [];
  const block = validateBlock(json, problems);
  if (block === undefined || problems.length > 0) return { ok: false, reason: problems.map((p) => `${p.path}: ${p.message}`).join("; ") };
  return { ok: true, block };
}

function validateBlock(v: unknown, problems: Problem[]): FormBlock | undefined {
  const bad = (path: string, message: string): void => { problems.push({ path, message }); };
  if (!isObj(v)) { bad("", "block must be a JSON object"); return undefined; }
  for (const k of Object.keys(v)) if (!["v", "kind", "id", "title", "fields", "buttons"].includes(k)) bad(k, "unknown key");
  if (v.v !== 1) bad("v", "must be 1");
  if (v.kind !== "form") bad("kind", 'must be "form"');
  if (typeof v.id !== "string" || !ID_RE.test(v.id)) bad("id", "must match [A-Za-z0-9_-]{1,64}");
  if (v.title !== undefined && typeof v.title !== "string") bad("title", "must be a string");

  const fields: Field[] = [];
  if (!Array.isArray(v.fields) || v.fields.length === 0) bad("fields", "must be a non-empty array");
  else {
    const ids = new Set<string>();
    v.fields.forEach((f, i) => {
      const field = validateField(f, `fields[${i}]`, problems);
      if (field === undefined) return;
      if (ids.has(field.id)) bad(`fields[${i}].id`, `duplicate field id "${field.id}"`);
      ids.add(field.id);
      fields.push(field);
    });
  }

  const buttons: Button[] = [];
  if (!Array.isArray(v.buttons) || v.buttons.length === 0) bad("buttons", "must be a non-empty array");
  else {
    const ids = new Set<string>();
    const datas = new Map<string, number>();
    v.buttons.forEach((b, i) => {
      const button = validateButton(b, `buttons[${i}]`, i === 0, problems);
      if (button === undefined) return;
      if (ids.has(button.id)) bad(`buttons[${i}].id`, `duplicate button id "${button.id}"`);
      ids.add(button.id);
      // Two buttons with equal data are indistinguishable to the workflow (the data is what it routes on).
      const key = JSON.stringify(Object.keys(button.data).sort().map((k) => [k, button.data[k]]));
      const earlier = datas.get(key);
      if (earlier !== undefined) bad(`buttons[${i}].data`, `equals buttons[${earlier}].data`);
      else datas.set(key, i);
      buttons.push(button);
    });
  }
  if (problems.length > 0) return undefined;
  return { v: 1, kind: "form", id: v.id as string, ...(v.title !== undefined && { title: v.title as string }), fields, buttons };
}

/**
 * What an inline option may carry besides `value` and `label`: `description` (radio / checkbox), more row fields (a
 * select that shows a table or submits items: its options are rows), or nothing (any other select).
 */
type OptionExtras = "description" | "row" | "none";
const isRowValue = (v: unknown): v is Scalar | boolean | null => v === null || typeof v === "boolean" || isScalar(v);

function validateOptions(v: unknown, path: string, extras: OptionExtras, problems: Problem[]): Option[] | undefined {
  const bad = (p: string, message: string): void => { problems.push({ path: p, message }); };
  if (!Array.isArray(v) || v.length === 0) { bad(path, "must be a non-empty array"); return undefined; }
  const out: Option[] = [];
  const seen = new Set<string>();
  let ok = true;
  v.forEach((o, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(o)) { bad(p, "must be an object"); ok = false; return; }
    for (const [k, x] of Object.entries(o)) {
      if (k === "value" || k === "label" || (extras === "description" && k === "description")) continue;
      if (extras !== "row") { bad(`${p}.${k}`, "unknown key"); ok = false; }
      else if (!isRowValue(x)) { bad(`${p}.${k}`, "must be a string, number, boolean or null (a row field)"); ok = false; }
    }
    if (!isScalar(o.value)) { bad(`${p}.value`, "must be a string or number"); ok = false; }
    if (typeof o.label !== "string") { bad(`${p}.label`, "must be a string"); ok = false; }
    if (extras === "description" && o.description !== undefined && typeof o.description !== "string") { bad(`${p}.description`, "must be a string"); ok = false; }
    if (!ok) return;
    const key = `${typeof o.value}:${String(o.value)}`;
    if (seen.has(key)) { bad(`${p}.value`, `duplicate option value ${JSON.stringify(o.value)}`); ok = false; return; }
    seen.add(key);
    // The option as written (a row keeps its fields in the agent's order: the submitted item reads as the agent wrote it).
    out.push({ ...(o as Option) });
  });
  return ok ? out : undefined;
}

/** A select's `collectionTemplateTable`: a non-empty array of `{ field, headerText? }`, each field once. */
function validateTable(v: unknown, path: string, problems: Problem[]): TableColumn[] | undefined {
  const before = problems.length;
  const bad = (p: string, message: string): void => { problems.push({ path: p, message }); };
  if (!Array.isArray(v) || v.length === 0) { bad(path, "must be a non-empty array of { field, headerText? }"); return undefined; }
  const out: TableColumn[] = [];
  const seen = new Set<string>();
  v.forEach((c, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(c)) { bad(p, "must be an object"); return; }
    for (const k of Object.keys(c)) if (k !== "field" && k !== "headerText") bad(`${p}.${k}`, "unknown key");
    if (typeof c.field !== "string" || c.field === "") { bad(`${p}.field`, "must be a non-empty string"); return; }
    if (c.headerText !== undefined && typeof c.headerText !== "string") { bad(`${p}.headerText`, "must be a string"); return; }
    if (seen.has(c.field)) { bad(`${p}.field`, `duplicate column field "${c.field}"`); return; }
    seen.add(c.field);
    out.push({ field: c.field, ...(c.headerText !== undefined && { headerText: c.headerText as string }) });
  });
  return problems.length > before ? undefined : out;
}

/**
 * The table's fields must exist where that is known: in the report's columns (a report source), in at least one option
 * (inline options: `value`, `label` or an option's own field). A REST source's row fields are not known here.
 */
function checkTableFields(table: TableColumn[], options: Option[] | undefined, source: DataSourceOptions | undefined, path: string, problems: Problem[]): void {
  table.forEach((c, i) => {
    const p = `${path}.collectionTemplateTable[${i}].field`;
    if (source !== undefined && source.dataSource.type === "BIPReport") {
      if (!source.dataSource.columns.some((col) => col.name === c.field)) problems.push({ path: p, message: `"${c.field}" is not one of the report's columns` });
    } else if (options !== undefined && !options.some((o) => Object.prototype.hasOwnProperty.call(o, c.field))) {
      problems.push({ path: p, message: `"${c.field}" is not a field of any option` });
    }
  });
}

function validateField(v: unknown, path: string, problems: Problem[]): Field | undefined {
  const before = problems.length;
  const bad = (k: string, message: string): void => { problems.push({ path: k === "" ? path : `${path}.${k}`, message }); };
  if (!isObj(v)) { bad("", "must be an object"); return undefined; }
  const id = v.id;
  if (typeof id !== "string" || !ID_RE.test(id)) bad("id", "must match [A-Za-z0-9_-]{1,64}");
  const type = v.type;
  if (!(FIELD_TYPES as readonly unknown[]).includes(type)) { bad("type", `must be one of ${FIELD_TYPES.join(", ")}`); return undefined; }

  if (type === "hidden") {
    for (const k of Object.keys(v)) if (!["id", "type", "value"].includes(k)) bad(k, "unknown key (not for hidden)");
    if (v.value !== undefined && typeof v.value !== "string") bad("value", "must be a string");
    if (problems.length > before) return undefined;
    return { id: id as string, type: "hidden", value: v.value === undefined ? null : (v.value as string) };
  }

  const allowed = ["id", "type", "label", "required", "value", "help", "options"];
  if (type === "select") allowed.push("multi", "dataSource", "valueField", "labelField", "searchField", "searchTemplate", "collectionTemplateTable", "submit");
  for (const k of Object.keys(v)) if (!allowed.includes(k)) bad(k, "unknown key");
  if (v.label !== undefined && typeof v.label !== "string") bad("label", "must be a string");
  if (v.required !== undefined && typeof v.required !== "boolean") bad("required", "must be a boolean");
  if (v.help !== undefined && typeof v.help !== "string") bad("help", "must be a string");
  const base = {
    id: id as string,
    ...(v.label !== undefined && { label: v.label as string }),
    required: v.required === true,
    ...(v.help !== undefined && { help: v.help as string }),
  };
  const multi = type === "checkbox" || (type === "select" && v.multi === true);
  if (type === "select" && v.multi !== undefined && typeof v.multi !== "boolean") bad("multi", "must be a boolean");
  // value: scalar (or null) for a single value, an array of scalars for a multi value
  let value: Scalar | null | Scalar[] = multi ? [] : null;
  if (v.value !== undefined && v.value !== null) {
    if (multi) {
      if (!Array.isArray(v.value) || !v.value.every(isScalar)) bad("value", "must be an array of strings or numbers");
      else value = v.value as Scalar[];
    } else if (!isScalar(v.value)) bad("value", "must be a string or number");
    else value = v.value;
  }

  if (type === "radio" || type === "checkbox") {
    const options = validateOptions(v.options, `${path}.options`, "description", problems);
    if (problems.length > before || options === undefined) return undefined;
    return type === "radio"
      ? { ...base, type: "radio", value: value as Scalar | null, options }
      : { ...base, type: "checkbox", value: value as Scalar[], options };
  }

  // select: what it submits (its value(s) by default, or the whole row(s)), and its dropdown as a table
  if (v.submit !== undefined && v.submit !== "value" && v.submit !== "item") bad("submit", 'must be "value" or "item"');
  const submit: SelectSubmit = v.submit === "item" ? "item" : "value";
  const table = v.collectionTemplateTable !== undefined ? validateTable(v.collectionTemplateTable, `${path}.collectionTemplateTable`, problems) : undefined;
  // options inline or a datasource (dataSource + valueField + labelField), exactly one of them
  const hasOptions = v.options !== undefined;
  const hasSource = v.dataSource !== undefined || v.valueField !== undefined || v.labelField !== undefined || v.searchField !== undefined
    || v.searchTemplate !== undefined;
  if (hasOptions === hasSource) bad("", hasOptions ? "options and dataSource are both present" : "needs options or a dataSource with valueField and labelField");
  let options: Option[] | undefined;
  let source: (DataSourceOptions & { fromConfig: boolean }) | undefined;
  // An option is a row (more fields allowed) when the select shows a table or submits items.
  if (hasOptions) options = validateOptions(v.options, `${path}.options`, v.collectionTemplateTable !== undefined || v.submit === "item" ? "row" : "none", problems);
  else if (hasSource) {
    const ds = validateDataSource(v.dataSource, `${path}.dataSource`, problems);
    const fieldsOf = validateSourceFields(v, path, problems);
    if (ds !== undefined && fieldsOf !== undefined) {
      source = { dataSource: ds, ...fieldsOf, fromConfig: false };
      checkSource(source, path, problems);
    }
  }
  if (table !== undefined) checkTableFields(table, options, source, path, problems);
  if (problems.length > before) return undefined;
  const sel = {
    ...base, type: "select" as const, ...(options !== undefined && { options }), ...(source !== undefined && { source }),
    ...(table !== undefined && { collectionTemplateTable: table }), submit,
  };
  return multi ? { ...sel, multi: true, value: value as Scalar[] } : { ...sel, multi: false, value: value as Scalar | null };
}

function validateButton(v: unknown, path: string, first: boolean, problems: Problem[]): Button | undefined {
  const before = problems.length;
  const bad = (k: string, message: string): void => { problems.push({ path: k === "" ? path : `${path}.${k}`, message }); };
  if (!isObj(v)) { bad("", "must be an object"); return undefined; }
  for (const k of Object.keys(v)) if (!["id", "label", "data", "variant", "validate", "confirm"].includes(k)) bad(k, "unknown key");
  if (typeof v.id !== "string" || !ID_RE.test(v.id)) bad("id", "must match [A-Za-z0-9_-]{1,64}");
  if (typeof v.label !== "string" || v.label === "") bad("label", "must be a non-empty string");
  const data: Record<string, Scalar | Scalar[]> = {};
  if (!isObj(v.data) || Object.keys(v.data).length === 0) bad("data", "must be a non-empty object");
  else {
    for (const [k, val] of Object.entries(v.data)) {
      if (isScalar(val) || (Array.isArray(val) && val.every(isScalar))) data[k] = val as Scalar | Scalar[];
      else bad(`data.${k}`, "must be a string, number or array of them");
    }
  }
  if (v.variant !== undefined && !(VARIANTS as readonly unknown[]).includes(v.variant)) bad("variant", `must be one of ${VARIANTS.join(", ")}`);
  if (v.validate !== undefined && typeof v.validate !== "boolean") bad("validate", "must be a boolean");
  if (v.confirm !== undefined && (typeof v.confirm !== "string" || v.confirm === "")) bad("confirm", "must be a non-empty string");
  if (problems.length > before) return undefined;
  return {
    id: v.id as string,
    label: v.label as string,
    data,
    // [contract, my call] first button callToAction, the others outlined
    variant: v.variant !== undefined ? (v.variant as ButtonVariant) : first ? "callToAction" : "outlined",
    validate: v.validate !== false,
    ...(v.confirm !== undefined && { confirm: v.confirm as string }),
  };
}

// ---- config overlay -----------------------------------------------------------------------------------------------

/** The config overlay of one widget (`widgets[widgetId]`): per field, a datasource (+ searchTemplate) that wins over the block's own. */
export interface WidgetOverlay { fields: Record<string, DataSourceOptions> }

/** Applies `widgets[block.id].fields[field.id]` (D7): the overlay's datasource replaces the select's options or datasource. */
export function applyOverlay(block: FormBlock, overlay: WidgetOverlay | undefined): FormBlock {
  if (overlay === undefined) return block;
  return {
    ...block,
    fields: block.fields.map((f) => {
      const o = overlay.fields[f.id];
      if (o === undefined || f.type !== "select") return f;
      const { options: _options, ...rest } = f;
      return { ...rest, source: { ...o, fromConfig: true } } as SelectField;
    }),
  };
}
