import "oj-c/button";
import "oj-c/checkboxset";
import "oj-c/form-layout";
import "oj-c/radioset";
import "oj-c/rich-checkboxset";
import "oj-c/rich-radioset";
import "oj-c/select-multiple";
import "oj-c/select-single";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import type { DataProvider } from "ojs/ojdataprovider";
import * as EndpointDataProvider from "xxx-gnimsys-data/rest/endpoint-data-provider";
import { useMemo, useRef, useState } from "preact/hooks";
import type { EndpointFetch } from "../lib/endpoints/EndpointFetch";
import { messageOf } from "../lib/errors";
import type { Button, CheckboxField, Field, FormBlock, RadioField, Scalar, SelectField } from "../lib/widgets/block";
import { inlineRefusal, sourceRefusal } from "../lib/widgets/datasource";
import type { DataSourcePolicy, Option } from "../lib/widgets/datasource";
import { clickedButton, initialValues, missingRequired, submitText } from "../lib/widgets/submit";
import type { Submit, Value, Values } from "../lib/widgets/submit";

/** What the host needs from the chat: the datasource policy and endpoints, whether a message may go out, and where it goes. */
export interface WidgetHostDeps {
  policy: DataSourcePolicy;
  endpoints: EndpointFetch;
  /** The chat accepts a new message now (the buttons are enabled). */
  canSend: boolean;
  onSubmit: (text: string) => void;
}

/** A select's data: inline options, a server-paged datasource provider, or unavailable (refused by the policy / unsupported). */
type Resolved = { data: DataProvider<Scalar, Option> } | { error: string };
/** A field element; its validate() (a Core Pack method on the element) shows the required message and reports the state. */
type Handle = EventTarget | null;
const validateField = (el: Handle): void => { const v = (el as { validate?: () => Promise<unknown> } | null)?.validate; if (typeof v === "function") void v.call(el); };

const testId = (part: string): string => `gai-widget-${part}`;

/** The data of one select: decided once per block (gating, support, provider construction need no request). */
function resolveSelect(f: SelectField, deps: WidgetHostDeps): Resolved {
  if (f.options !== undefined) return { data: new ArrayDataProvider<Scalar, Option>(f.options, { keyAttributes: "value" }) };
  const source = f.source;
  if (source === undefined) return { error: "no options" };
  const refusal = (source.fromConfig ? null : inlineRefusal(source.dataSource, deps.policy)) ?? sourceRefusal(source.dataSource);
  if (refusal !== null) return { error: refusal };
  const ds = source.dataSource;
  try {
    const data = EndpointDataProvider.createEndpointDataProvider<Scalar, Option>({
      createEndpoint: (url) => deps.endpoints.endpoint(ds.target, url, ds.headers),
      // BOSS filters and pages with $filter / $limit / $offset; every other target is served as Fusion REST (q / limit /
      // offset), as before.
      dialect: ds.target === "BOSS" ? "boss" : "fa",
      url: ds.url,
      valueField: source.valueField,
      labelField: source.labelField,
      pageSize: deps.policy.pageSize,
      ...(source.searchTemplate !== undefined && { searchTemplate: source.searchTemplate }),
      ...(ds.dataTransform !== undefined && { dataTransform: ds.dataTransform }),
    });
    return { data };
  } catch (e) {
    return { error: `datasource failed: ${messageOf(e)}` };
  }
}

function SelectControl(props: {
  field: SelectField; resolved: Resolved; itemText: string; value: Value; readOnly: boolean; onChange: (v: Value) => void; handle: (h: Handle) => void;
}) {
  const { field, resolved } = props;
  const empty = useMemo(() => new ArrayDataProvider<Scalar, Option>([], { keyAttributes: "value" }), []);
  const data = "data" in resolved ? resolved.data : empty;
  const messages = "error" in resolved ? [{ summary: "Unavailable", detail: resolved.error, severity: "error" as const }] : undefined;
  const common = {
    "data-testid": `gai-widget-field-${field.id}`,
    labelHint: field.label ?? field.id,
    required: field.required,
    readonly: props.readOnly,
    labelEdge: "top" as const,
    userAssistanceDensity: "reflow" as const,
    ...(field.help !== undefined && { help: { instruction: field.help } }),
    ...(messages !== undefined && { messagesCustom: messages }),
  };
  if (field.multi) {
    const value = new Set<Scalar>(Array.isArray(props.value) ? props.value : []);
    return (
      <oj-c-select-multiple {...common} data={data} itemText={props.itemText} value={value} ref={props.handle}
        onvalueChanged={(e) => props.onChange(e.detail.value ? [...e.detail.value] : [])} />
    );
  }
  const value = props.value === null || Array.isArray(props.value) ? null : props.value;
  return (
    <oj-c-select-single {...common} data={data} itemText={props.itemText} value={value} ref={props.handle}
      onvalueChanged={(e) => props.onChange(e.detail.value ?? null)} />
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

/**
 * One gnimsys-ui form block (contract rev 2 §2–§4): the fields in a Redwood form layout, the buttons under them. Values
 * stay local until a button submits them (plus its `data`) as ONE user message (lib/widgets/submit). A select with inline
 * options sits on an ArrayDataProvider; one with a datasource on the data pack's endpoint data provider (server search
 * and paging through the page's endpoints; the selected label comes back through fetchByKeys). A button with `validate`
 * first asks each required field to validate (the Core Pack shows the required message); `confirm` asks inline before
 * submitting. `submitted` (a later user turn carries this block's envelope, §3) renders the block read-only with the
 * submitted values and marks the button whose data the submit carries. Mounted only once the turn has settled (see
 * Content): a Core Pack control created with a `disabled` that flips within milliseconds keeps the creation value (JET
 * early-set replay, see ChatShell).
 */
export function WidgetHost(props: { block: FormBlock; deps: WidgetHostDeps; submitted?: Submit }) {
  const { block, deps, submitted } = props;
  const readOnly = submitted !== undefined;
  const resolved = useMemo(() => {
    const out: Record<string, Resolved> = {};
    for (const f of block.fields) if (f.type === "select") out[f.id] = resolveSelect(f, deps);
    return out;
  }, [block]);
  const [values, setValues] = useState<Values>(() => initialValues(block));
  const [confirming, setConfirming] = useState<Button | null>(null);
  const handles = useRef<Record<string, Handle>>({});
  const shown: Values = readOnly ? { ...initialValues(block), ...submitted.values } : values;
  const clicked = submitted !== undefined ? clickedButton(block, submitted) : undefined;

  // A select whose datasource is unavailable blocks every validating button: only validate:false buttons (Back, Cancel)
  // still submit (§2.3). Decided before the buttons mount, so their `disabled` never flips during creation.
  const unavailable = Object.values(resolved).some((r) => "error" in r);

  const submit = (button: Button): void => {
    setConfirming(null);
    deps.onSubmit(submitText(block, values, button));
  };
  const click = (button: Button): void => {
    if (readOnly || !deps.canSend) return;
    if (button.validate) {
      const missing = missingRequired(block, values);
      if (missing.length > 0) {
        for (const id of missing) validateField(handles.current[id] ?? null);
        return;
      }
    }
    if (button.confirm !== undefined) setConfirming(button);
    else submit(button);
  };
  const set = (id: string) => (v: Value): void => setValues((s) => ({ ...s, [id]: v }));
  const handle = (id: string) => (h: Handle): void => { handles.current[id] = h; };

  const control = (f: Field) => {
    switch (f.type) {
      case "hidden": return null;
      case "select": return (
        <SelectControl key={f.id} field={f} resolved={resolved[f.id] ?? { error: "no options" }} itemText={f.source !== undefined ? f.source.labelField : "label"}
          value={shown[f.id]} readOnly={readOnly} onChange={set(f.id)} handle={handle(f.id)} />
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
