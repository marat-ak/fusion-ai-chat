import "oj-c/button";
import "oj-c/checkboxset";
import "oj-c/form-layout";
import "oj-c/highlight-text";
import "oj-c/radioset";
import "oj-c/rich-checkboxset";
import "oj-c/rich-radioset";
import "oj-c/select-multiple";
import "oj-c/select-single";
import "oj-c/table";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import type { DataProvider, Item } from "ojs/ojdataprovider";
import type { ImmutableKeySet } from "ojs/ojkeyset";
import * as EndpointDataProvider from "xxx-gnimsys-data/rest/endpoint-data-provider";
import * as ReportDataProvider from "xxx-gnimsys-data/rest/report-data-provider";
import { useMemo, useRef, useState } from "preact/hooks";
import type { EndpointFetch } from "../lib/endpoints/EndpointFetch";
import { messageOf } from "../lib/errors";
import type { Button, CheckboxField, Field, FormBlock, RadioField, Scalar, SelectField, TableColumn } from "../lib/widgets/block";
import { inlineRefusal, sourceRefusal } from "../lib/widgets/datasource";
import type { DataSourcePolicy, Option } from "../lib/widgets/datasource";
import { clickedButton, initialValues, missingRequired, submitsItems, submittedRows, submittedValues, submitText, unresolvedItems } from "../lib/widgets/submit";
import type { Items, Row, Submit, Value, Values } from "../lib/widgets/submit";

/** What the host needs from the chat: the datasource policy and endpoints, whether a message may go out, and where it goes. */
export interface WidgetHostDeps {
  policy: DataSourcePolicy;
  endpoints: EndpointFetch;
  /** The chat accepts a new message now (the buttons are enabled). */
  canSend: boolean;
  onSubmit: (text: string) => void;
}

/**
 * A select's data: inline options, a server-paged REST datasource provider, a report provider, the submitted rows of a
 * read-only item select, or unavailable (refused by the policy / unsupported).
 */
type Resolved = { data: DataProvider<Scalar, Row> } | { error: string };
/** A field element; its validate() (a Core Pack method on the element) shows the required message and reports the state. */
type Handle = EventTarget | null;
const validateField = (el: Handle): void => { const v = (el as { validate?: () => Promise<unknown> } | null)?.validate; if (typeof v === "function") void v.call(el); };

const testId = (part: string): string => `gai-widget-${part}`;

/**
 * The data of one select: decided once per block (gating, support, provider construction need no request). A block that
 * mounts already submitted (reopened from history) shows an item select's submitted rows: they are what was chosen, and
 * a datasource may no longer list them under an empty search. `onLoadError` gets a report run's failure (null once a
 * run succeeds).
 */
function resolveSelect(f: SelectField, deps: WidgetHostDeps, submitted: Submit | undefined, onLoadError: (message: string | null) => void): Resolved {
  if (submitted !== undefined && submitsItems(f) && f.source !== undefined) {
    return { data: new ArrayDataProvider<Scalar, Row>(submittedRows(f, submitted), { keyAttributes: f.source.valueField }) };
  }
  if (f.options !== undefined) return { data: new ArrayDataProvider<Scalar, Row>(f.options, { keyAttributes: "value" }) };
  const source = f.source;
  if (source === undefined) return { error: "no options" };
  const refusal = (source.fromConfig ? null : inlineRefusal(source.dataSource, deps.policy)) ?? sourceRefusal(source.dataSource);
  if (refusal !== null) return { error: refusal };
  const ds = source.dataSource;
  try {
    if (ds.type === "BIPReport") {
      // runReport through the FA endpoint (the report service is a pod path of it); the report searches with searchParam.
      const data = ReportDataProvider.createReportDataProvider<Scalar, Row>({
        createEndpoint: (url, headers) => deps.endpoints.endpoint(ds.target, url, headers),
        reportName: ds.reportName,
        recordsetSelector: ds.recordsetSelector,
        recordSelector: ds.recordSelector,
        columns: ds.columns,
        ...(ds.parameters !== undefined && { parameters: ds.parameters }),
        ...(ds.searchParam !== undefined && { searchParam: ds.searchParam }),
        valueField: source.valueField,
        labelField: source.labelField,
        ...(source.searchField !== undefined && { searchField: source.searchField }),
        pageSize: deps.policy.pageSize,
        ...(source.searchTemplate !== undefined && { searchTemplate: source.searchTemplate }),
        onError: onLoadError,
      });
      return { data };
    }
    const data = EndpointDataProvider.createEndpointDataProvider<Scalar, Row>({
      // The provider sends the datasource's headers plus what its filters need (REST-Framework-Version for Fusion REST).
      createEndpoint: (url, headers) => deps.endpoints.endpoint(ds.target, url, headers),
      // BOSS filters and pages with $filter / $limit / $offset; every other target is served as Fusion REST (q / limit /
      // offset), as before.
      dialect: ds.target === "BOSS" ? "boss" : "fa",
      url: ds.url,
      ...(ds.headers !== undefined && { headers: ds.headers }),
      valueField: source.valueField,
      labelField: source.labelField,
      ...(source.searchField !== undefined && { searchField: source.searchField }),
      pageSize: deps.policy.pageSize,
      ...(source.searchTemplate !== undefined && { searchTemplate: source.searchTemplate }),
      ...(ds.dataTransform !== undefined && { dataTransform: ds.dataTransform }),
    });
    return { data };
  } catch (e) {
    return { error: `datasource failed: ${messageOf(e)}` };
  }
}

/** What the select hands its `collectionTemplate` (JET 19 Core Pack; the context types are not exported by the pack). */
interface CollectionContext {
  data?: DataProvider<Scalar, Row> | null;
  searchText?: string;
  currentRowOverride?: { rowKey: Scalar };
  onCurrentRowChanged: (detail: { rowKey?: Scalar }) => void;
  selected: ImmutableKeySet<Scalar>;
  /** select-single: a row action (click / Enter) picks the row. */
  onRowAction?: (detail: { item: Item<Scalar, Row> }) => void;
  /** select-multiple: the table's row selection is the select's. */
  onSelectedChanged?: (detail: { value?: ImmutableKeySet<Scalar> }) => void;
}
type CurrentCell = { type: string; rowKey?: Scalar } | undefined;

/**
 * The dropdown as an `oj-c-table` (the select's `collectionTemplate`, the dashboard's `collectionTemplateTable`): the
 * configured columns, the typed text highlighted in every cell; one row picks for a single select (row action), the row
 * selection is the value for a multi select.
 */
function dropdownTable(columns: Record<string, { field: string; headerText: string }>, label: string, multi: boolean) {
  return (collection: CollectionContext) => (
    <oj-c-table aria-label={label} {...(collection.data != null && { data: collection.data })} columns={columns} horizontalGridVisible="disabled" verticalGridVisible="disabled"
      selectionMode={{ row: multi ? "multiple" : "single" }} selected={{ row: collection.selected }}
      {...(multi && { selectAllControl: "hidden" as const })}
      {...(collection.currentRowOverride !== undefined && { currentCellOverride: collection.currentRowOverride })}
      oncurrentCellChanged={(e) => {
        const cell = e.detail.value as CurrentCell;
        if (cell !== undefined) collection.onCurrentRowChanged({ ...(cell.type === "data" && cell.rowKey !== undefined && { rowKey: cell.rowKey }) });
      }}
      {...(multi
        ? { onselectedChanged: (e: { detail: { value?: { row?: ImmutableKeySet<Scalar> } } }) => collection.onSelectedChanged?.({ ...(e.detail.value?.row !== undefined && { value: e.detail.value.row }) }) }
        : { onojRowAction: (e: { detail: { context: { item: Item<Scalar, Row> } } }) => collection.onRowAction?.({ item: e.detail.context.item }) })}>
      <template slot="cellTemplate" render={(cell: { data?: unknown }) => (
        <oj-c-highlight-text text={cell.data === undefined || cell.data === null ? "" : String(cell.data)} matchText={collection.searchText ?? ""} />
      )} />
    </oj-c-table>
  );
}

/** The table columns of `collectionTemplateTable`, keyed by position (a field name need not be a valid key). */
const tableColumns = (table: TableColumn[]): Record<string, { field: string; headerText: string }> =>
  Object.fromEntries(table.map((c, i) => [`c${i}`, { field: c.field, headerText: c.headerText ?? c.field }]));

function SelectControl(props: {
  field: SelectField; resolved: Resolved; itemText: string; value: Value; readOnly: boolean; messages: string[];
  onChange: (v: Value) => void; onItems: (rows: Row[]) => void; handle: (h: Handle) => void;
}) {
  const { field, resolved } = props;
  const empty = useMemo(() => new ArrayDataProvider<Scalar, Row>([], { keyAttributes: "value" }), []);
  const columns = useMemo(() => (field.collectionTemplateTable !== undefined ? tableColumns(field.collectionTemplateTable) : undefined), [field]);
  const data = "data" in resolved ? resolved.data : empty;
  const details = [...("error" in resolved ? [resolved.error] : []), ...props.messages];
  const messages = details.map((detail) => ({ summary: "Unavailable", detail, severity: "error" as const }));
  const common = {
    "data-testid": `gai-widget-field-${field.id}`,
    labelHint: field.label ?? field.id,
    required: field.required,
    readonly: props.readOnly,
    labelEdge: "top" as const,
    userAssistanceDensity: "reflow" as const,
    ...(field.help !== undefined && { help: { instruction: field.help } }),
    ...(messages.length > 0 && { messagesCustom: messages }),
  };
  const label = field.label ?? field.id;
  // The multi value as ONE Set per content: a new Set on every render reads to oj-c-select-multiple as a new value, which
  // re-emits valueItemsChanged -> onItems -> a re-render -> a new Set ... (a render loop that wedges the page).
  const multiKeys = field.multi && Array.isArray(props.value) ? props.value : [];
  const multiValue = useMemo(() => new Set<Scalar>(multiKeys), [JSON.stringify(multiKeys)]);
  if (field.multi) {
    const value = multiValue;
    return (
      <oj-c-select-multiple {...common} data={data} itemText={props.itemText} value={value} ref={props.handle}
        onvalueChanged={(e) => props.onChange(e.detail.value ? [...e.detail.value] : [])}
        onvalueItemsChanged={(e) => props.onItems(e.detail.value ? [...e.detail.value.values()].map((i) => i.data as Row) : [])}>
        {columns !== undefined && <template slot="collectionTemplate" render={dropdownTable(columns, label, true)} />}
      </oj-c-select-multiple>
    );
  }
  const value = props.value === null || Array.isArray(props.value) ? null : props.value;
  return (
    <oj-c-select-single {...common} data={data} itemText={props.itemText} value={value} ref={props.handle}
      onvalueChanged={(e) => props.onChange(e.detail.value ?? null)}
      onvalueItemChanged={(e) => props.onItems(e.detail.value ? [e.detail.value.data as Row] : [])}>
      {columns !== undefined && <template slot="collectionTemplate" render={dropdownTable(columns, label, false)} />}
    </oj-c-select-single>
  );
}

/**
 * Radio / checkbox lists: the plain Core Pack sets, or the rich ones when an option carries a `description` — the plain
 * sets have no text under a label (their assistiveText is a help popup), the rich sets render it as the item's secondary
 * text (the engine's AskBox pattern).
 */
const described = (options: Option[]): boolean => options.some((o) => o.description !== undefined);
const plainItems = (options: Option[]) => options.map((o) => ({ value: o.value, label: o.label }));
const richItems = (options: Option[]) => options.map((o) => ({ value: o.value, label: o.label, ...(o.description !== undefined && { secondaryText: o.description }) }));

function RadioControl(props: { field: RadioField; value: Value; readOnly: boolean; onChange: (v: Value) => void; handle: (h: Handle) => void }) {
  const { field } = props;
  const value = props.value === null || Array.isArray(props.value) ? null : props.value;
  const common = {
    "data-testid": `gai-widget-field-${field.id}`,
    labelHint: field.label ?? field.id,
    required: field.required,
    readonly: props.readOnly,
    labelEdge: "top" as const,
    userAssistanceDensity: "reflow" as const,
    ...(field.help !== undefined && { help: { instruction: field.help } }),
  };
  return described(field.options)
    ? <oj-c-rich-radioset {...common} layout="sm" options={richItems(field.options)} value={value} ref={props.handle} onvalueChanged={(e) => props.onChange(e.detail.value ?? null)} />
    : <oj-c-radioset {...common} options={plainItems(field.options)} value={value} ref={props.handle} onvalueChanged={(e) => props.onChange(e.detail.value ?? null)} />;
}

function CheckboxControl(props: { field: CheckboxField; value: Value; readOnly: boolean; onChange: (v: Value) => void; handle: (h: Handle) => void }) {
  const { field } = props;
  const value = Array.isArray(props.value) ? props.value : [];
  const common = {
    "data-testid": `gai-widget-field-${field.id}`,
    labelHint: field.label ?? field.id,
    required: field.required,
    readonly: props.readOnly,
    labelEdge: "top" as const,
    userAssistanceDensity: "reflow" as const,
    ...(field.help !== undefined && { help: { instruction: field.help } }),
  };
  return described(field.options)
    ? <oj-c-rich-checkboxset {...common} layout="sm" options={richItems(field.options)} value={value} ref={props.handle} onvalueChanged={(e) => props.onChange(e.detail.value ?? [])} />
    : <oj-c-checkboxset {...common} options={plainItems(field.options)} value={value} ref={props.handle} onvalueChanged={(e) => props.onChange(e.detail.value ?? [])} />;
}

/** A field-keyed message map with one entry set (a message) or removed (null); the same map when nothing changes. */
const withMessage = (m: Record<string, string>, id: string, message: string | null): Record<string, string> => {
  if ((m[id] ?? null) === message) return m;
  const { [id]: _old, ...rest } = m;
  return message === null ? rest : { ...rest, [id]: message };
};

/**
 * One gnimsys-ui form block (contract §2–§4): the fields in a Redwood form layout, the buttons under them. Values stay
 * local until a button submits them (plus its `data`) as ONE user message (lib/widgets/submit). A select with inline
 * options sits on an ArrayDataProvider; one with a REST datasource on the data pack's endpoint data provider (server
 * search and paging through the page's endpoints; the selected label comes back through fetchByKeys); one with a report
 * datasource on the report data provider (runReport through the FA endpoint; a failed run shows on the field).
 * `collectionTemplateTable` shows the dropdown as a table. A `submit: "item"` select keeps the rows of its selection (the
 * value items the select reports) and submits them instead of the keys. A button with `validate` first asks each required
 * field to validate (the Core Pack shows the required message) and refuses while an item select's row is not known;
 * `confirm` asks inline before submitting. `submitted` (a later user turn carries this block's envelope, §3) renders the
 * block read-only with the submitted values and marks the button whose data the submit carries. Mounted only once the
 * turn has settled (see Content): a Core Pack control created with a `disabled` that flips within milliseconds keeps the
 * creation value (JET early-set replay, see ChatShell).
 */
export function WidgetHost(props: { block: FormBlock; deps: WidgetHostDeps; submitted?: Submit }) {
  const { block, deps, submitted } = props;
  const readOnly = submitted !== undefined;
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const resolved = useMemo(() => {
    const out: Record<string, Resolved> = {};
    for (const f of block.fields) {
      if (f.type === "select") out[f.id] = resolveSelect(f, deps, submitted, (m) => setLoadErrors((s) => withMessage(s, f.id, m)));
    }
    return out;
  }, [block]);
  const [values, setValues] = useState<Values>(() => initialValues(block));
  const [items, setItems] = useState<Items>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<Button | null>(null);
  const handles = useRef<Record<string, Handle>>({});
  const shown: Values = readOnly ? { ...initialValues(block), ...submittedValues(block, submitted) } : values;
  const clicked = submitted !== undefined ? clickedButton(block, submitted) : undefined;

  // A select whose datasource is unavailable blocks every validating button: only validate:false buttons (Back, Cancel)
  // still submit (§2.3). Decided before the buttons mount, so their `disabled` never flips during creation.
  const unavailable = Object.values(resolved).some((r) => "error" in r);

  const submit = (button: Button): void => {
    setConfirming(null);
    deps.onSubmit(submitText(block, values, button, items));
  };
  const click = (button: Button): void => {
    if (readOnly || !deps.canSend) return;
    if (button.validate) {
      const missing = missingRequired(block, values);
      if (missing.length > 0) {
        for (const id of missing) validateField(handles.current[id] ?? null);
        return;
      }
      // The envelope of an item select carries its rows: never submit a selection whose row is not known.
      const unresolved = unresolvedItems(block, values, items);
      if (unresolved.length > 0) {
        for (const id of unresolved) setItemErrors((s) => withMessage(s, id, "The selected item's data is not loaded: pick it again."));
        return;
      }
    }
    if (button.confirm !== undefined) setConfirming(button);
    else submit(button);
  };
  const set = (id: string) => (v: Value): void => setValues((s) => ({ ...s, [id]: v }));
  // The same rows again (a select re-reporting its value items) leave the state as it is: no re-render.
  const setRows = (f: SelectField) => (rows: Row[]): void => {
    setItems((s) => (JSON.stringify(s[f.id] ?? null) === JSON.stringify(rows) ? s : { ...s, [f.id]: rows }));
    setItemErrors((s) => withMessage(s, f.id, null));
  };
  const handle = (id: string) => (h: Handle): void => { handles.current[id] = h; };
  const messagesOf = (id: string): string[] => [loadErrors[id], itemErrors[id]].filter((m): m is string => m !== undefined);

  const control = (f: Field) => {
    switch (f.type) {
      case "hidden": return null;
      case "select": return (
        <SelectControl key={f.id} field={f} resolved={resolved[f.id] ?? { error: "no options" }} itemText={f.source !== undefined ? f.source.labelField : "label"}
          value={shown[f.id]} readOnly={readOnly} messages={messagesOf(f.id)} onChange={set(f.id)} onItems={setRows(f)} handle={handle(f.id)} />
      );
      case "radio": return <RadioControl key={f.id} field={f} value={shown[f.id]} readOnly={readOnly} onChange={set(f.id)} handle={handle(f.id)} />;
      case "checkbox": return <CheckboxControl key={f.id} field={f} value={shown[f.id]} readOnly={readOnly} onChange={set(f.id)} handle={handle(f.id)} />;
    }
  };

  return (
    <div data-testid="gai-widget" data-widget-id={block.id} {...(clicked !== undefined && { "data-submitted": clicked.id })}
      role="group" aria-label={block.title ?? block.id}>
      {block.title !== undefined && <div class="oj-typography-subheading-xs oj-sm-margin-2x-bottom" data-testid={testId("title")}>{block.title}</div>}
      <oj-c-form-layout columns={1} labelEdge="top" userAssistanceDensity="reflow">
        {block.fields.map(control)}
      </oj-c-form-layout>
      {confirming === null ? (
        <div class="oj-flex oj-sm-margin-2x-top" data-testid={testId("buttons")}>
          {block.buttons.map((b) => (
            <oj-c-button key={b.id} class="oj-sm-margin-2x-end oj-sm-margin-1x-bottom" data-testid={`gai-widget-button-${b.id}`}
              chroming={b.variant} label={b.label} disabled={readOnly || !deps.canSend || (b.validate && unavailable)} onojAction={() => click(b)}>
              {clicked !== undefined && clicked.id === b.id && <span slot="startIcon" class="oj-ux-ico-check" />}
            </oj-c-button>
          ))}
        </div>
      ) : (
        <div class="oj-flex oj-sm-align-items-center oj-sm-margin-2x-top" data-testid={testId("confirm")} role="group" aria-label={confirming.confirm}>
          <span class="oj-sm-margin-2x-end">{confirming.confirm} —</span>
          <oj-c-button class="oj-sm-margin-2x-end" data-testid={testId("confirm-ok")} chroming="callToAction" label="OK" disabled={!deps.canSend}
            onojAction={() => submit(confirming)} />
          <oj-c-button data-testid={testId("confirm-cancel")} chroming="outlined" label="Cancel" onojAction={() => setConfirming(null)} />
        </div>
      )}
    </div>
  );
}
