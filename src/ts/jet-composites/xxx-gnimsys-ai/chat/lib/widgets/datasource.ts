import { ENDPOINT_NAMES } from "../endpoints/EndpointFetch";
import type { EndpointMethod, EndpointName } from "../endpoints/EndpointFetch";
import type { Problem } from "../config/types";

/**
 * A select field's datasource (gnimsys-ui v1 §2.3), carried inline by the agent or by the config overlay
 * `widgets[widgetId].fields[fieldId]`, one of:
 * - `rest` (rev 2): the dashboard's REST datasource shape, served by the data pack's endpoint data provider
 *   (xxx-gnimsys-data/rest/endpoint-data-provider: a JET RESTDataProvider that pages and searches on the server through
 *   the page's endpoints, in the target's query language: BOSS = `$filter` / `$limit` / `$offset`, the others Fusion REST
 *   `q` / `limit` / `offset`);
 * - `BIPReport` (rev 5): the dashboard's BI Publisher report datasource in its explicit form (report path, row shape,
 *   fixed parameters, the parameter that takes the typed text), served by the data pack's report data provider
 *   (xxx-gnimsys-data/rest/report-data-provider: runReport through the FA endpoint).
 * This module validates the shape and decides what may be loaded; the loading is the providers'.
 */
export type Scalar = string | number;
export interface DataTransform { type: "lodash" | "map"; expression: string }
export interface RestDataSourceDef {
  type: "rest";
  target: EndpointName;
  method: EndpointMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  dataTransform?: DataTransform;
}
/** A report output column: `type` 2 = a number, 1 (or none) = text. */
export interface ReportColumn { name: string; type?: 1 | 2 }
/** A fixed report parameter: one value, or several (a multi-value parameter). */
export interface ReportParameter { name: string; value: Scalar | Scalar[] }
export interface ReportDataSourceDef {
  type: "BIPReport";
  /** The endpoint the report service is called through: FA (the service is a pod path of it). */
  target: "FA";
  /** The report's absolute catalog path, `/…/NAME.xdo`. */
  reportName: string;
  recordsetSelector: string;
  recordSelector: string;
  columns: ReportColumn[];
  parameters?: ReportParameter[];
  /** The parameter that takes the typed text; without it the report's one output is filtered locally. */
  searchParam?: string;
}
export type DataSourceDef = RestDataSourceDef | ReportDataSourceDef;
/** Typed-text search of a datasource select: `minChars` (default 1) and `debounceMs` (default 250). */
export interface SearchTemplate { minChars?: number; debounceMs?: number }
/**
 * A field's option source: the datasource plus the row fields that become the option value and label, and the attribute
 * the typed text searches (`searchField`, default `labelField`).
 */
export interface DataSourceOptions { dataSource: DataSourceDef; valueField: string; labelField: string; searchField?: string; searchTemplate?: SearchTemplate }
/**
 * An inline option. A select option is a row when its select shows a table or submits items: then it may carry more
 * fields (scalars, booleans or null) next to `value` and `label`; radio / checkbox options carry `description` only.
 */
export interface Option { value: Scalar; label: string; description?: string; [field: string]: Scalar | boolean | null | undefined }
/** Config `datasources` (D7): whether an agent may carry a datasource inline, under which pod paths, and the page size. */
export interface DataSourcePolicy { allowInline: boolean; allowPrefixes: string[]; pageSize: number }

/**
 * The pod path every report run is posted to (the data pack's report data provider holds the same constant): what the
 * page's `datasources.allowPrefixes` must cover for an agent-carried report datasource.
 */
export const BIP_SERVICE_PATH = "/xmlpserver/services/ExternalReportWSSService";

const METHODS: readonly EndpointMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const TRANSFORMS: readonly DataTransform["type"][] = ["lodash", "map"];
const REST_KEYS = ["type", "target", "method", "url", "headers", "body", "dataTransform"];
const REPORT_KEYS = ["type", "target", "reportName", "recordsetSelector", "recordSelector", "columns", "parameters", "searchParam"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is Scalar => typeof v === "string" || typeof v === "number";
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

/** Validates a datasource object (shape of the schema's `dataSource`); problems are appended under `path`. */
export function validateDataSource(v: unknown, path: string, problems: Problem[]): DataSourceDef | undefined {
  if (!isObj(v)) { problems.push({ path, message: "must be an object" }); return undefined; }
  if (v.type === "BIPReport") return validateReport(v, path, problems);
  return validateRest(v, path, problems);
}

function validateRest(v: Record<string, unknown>, path: string, problems: Problem[]): RestDataSourceDef | undefined {
  const bad = (p: string, message: string): undefined => { problems.push({ path: p, message }); return undefined; };
  let ok = true;
  for (const k of Object.keys(v)) {
    if (!REST_KEYS.includes(k)) { bad(`${path}.${k}`, "unknown key"); ok = false; }
  }
  if (v.type !== "rest") { bad(`${path}.type`, 'must be "rest" or "BIPReport"'); ok = false; }
  if (!(ENDPOINT_NAMES as readonly unknown[]).includes(v.target)) { bad(`${path}.target`, `must be one of ${ENDPOINT_NAMES.join(", ")}`); ok = false; }
  if (!(METHODS as readonly unknown[]).includes(v.method)) { bad(`${path}.method`, `must be one of ${METHODS.join(", ")}`); ok = false; }
  if (typeof v.url !== "string" || !v.url.startsWith("/")) { bad(`${path}.url`, "must be a pod path starting with /"); ok = false; }
  if (v.headers !== undefined && (!isObj(v.headers) || Object.values(v.headers).some((h) => typeof h !== "string"))) {
    bad(`${path}.headers`, "must be an object of strings"); ok = false;
  }
  let transform: DataTransform | undefined;
  if (v.dataTransform !== undefined) {
    const t = v.dataTransform;
    if (!isObj(t)) { bad(`${path}.dataTransform`, "must be an object"); ok = false; }
    else {
      for (const k of Object.keys(t)) if (k !== "type" && k !== "expression") { bad(`${path}.dataTransform.${k}`, "unknown key"); ok = false; }
      if (!(TRANSFORMS as readonly unknown[]).includes(t.type)) { bad(`${path}.dataTransform.type`, 'must be "lodash" or "map"'); ok = false; }
      if (typeof t.expression !== "string" || t.expression === "") { bad(`${path}.dataTransform.expression`, "must be a non-empty string"); ok = false; }
      if (ok) transform = { type: t.type as DataTransform["type"], expression: t.expression as string };
    }
  }
  if (!ok) return undefined;
  return {
    type: "rest",
    target: v.target as EndpointName,
    method: v.method as EndpointMethod,
    url: v.url as string,
    ...(v.headers !== undefined && { headers: v.headers as Record<string, string> }),
    ...(v.body !== undefined && { body: v.body }),
    ...(transform !== undefined && { dataTransform: transform }),
  };
}

/** A BIPReport datasource: every required input explicit (no auto-discovery, no default report, target or value). */
function validateReport(v: Record<string, unknown>, path: string, problems: Problem[]): ReportDataSourceDef | undefined {
  const before = problems.length;
  const bad = (p: string, message: string): void => { problems.push({ path: p, message }); };
  for (const k of Object.keys(v)) if (!REPORT_KEYS.includes(k)) bad(`${path}.${k}`, "unknown key");
  if (v.target !== "FA") bad(`${path}.target`, 'must be "FA" (the report service is a pod path of the FA endpoint)');
  if (typeof v.reportName !== "string" || !/^\/.+\.xdo$/.test(v.reportName)) bad(`${path}.reportName`, "must be the report's absolute catalog path, /…/NAME.xdo");
  for (const k of ["recordsetSelector", "recordSelector"] as const) if (!nonEmpty(v[k])) bad(`${path}.${k}`, "must be a non-empty string");

  const columns: ReportColumn[] = [];
  if (!Array.isArray(v.columns) || v.columns.length === 0) bad(`${path}.columns`, "must be a non-empty array");
  else {
    const names = new Set<string>();
    v.columns.forEach((c, i) => {
      const p = `${path}.columns[${i}]`;
      if (!isObj(c)) { bad(p, "must be an object"); return; }
      for (const k of Object.keys(c)) if (k !== "name" && k !== "type") bad(`${p}.${k}`, "unknown key");
      if (!nonEmpty(c.name)) { bad(`${p}.name`, "must be a non-empty string"); return; }
      if (c.type !== undefined && c.type !== 1 && c.type !== 2) bad(`${p}.type`, "must be 1 (text) or 2 (number)");
      if (names.has(c.name)) bad(`${p}.name`, `duplicate column "${c.name}"`);
      names.add(c.name);
      columns.push({ name: c.name, ...(c.type !== undefined && { type: c.type as 1 | 2 }) });
    });
  }

  const parameters: ReportParameter[] = [];
  if (v.parameters !== undefined) {
    if (!Array.isArray(v.parameters)) bad(`${path}.parameters`, "must be an array");
    else {
      const names = new Set<string>();
      v.parameters.forEach((q, i) => {
        const p = `${path}.parameters[${i}]`;
        if (!isObj(q)) { bad(p, "must be an object"); return; }
        for (const k of Object.keys(q)) if (k !== "name" && k !== "value") bad(`${p}.${k}`, "unknown key");
        if (!nonEmpty(q.name)) { bad(`${p}.name`, "must be a non-empty string"); return; }
        const value = q.value;
        if (!(isScalar(value) || (Array.isArray(value) && value.length > 0 && value.every(isScalar)))) {
          bad(`${p}.value`, "must be a string, a number or a non-empty array of them"); return;
        }
        if (names.has(q.name)) bad(`${p}.name`, `duplicate parameter "${q.name}"`);
        names.add(q.name);
        parameters.push({ name: q.name, value: value as Scalar | Scalar[] });
      });
    }
  }
  if (v.searchParam !== undefined) {
    if (!nonEmpty(v.searchParam)) bad(`${path}.searchParam`, "must be a non-empty string");
    else if (parameters.some((q) => q.name === v.searchParam)) bad(`${path}.searchParam`, `"${v.searchParam}" is also a fixed parameter`);
  }
  if (problems.length > before) return undefined;
  return {
    type: "BIPReport",
    target: "FA",
    reportName: v.reportName as string,
    recordsetSelector: v.recordsetSelector as string,
    recordSelector: v.recordSelector as string,
    columns,
    ...(v.parameters !== undefined && { parameters }),
    ...(v.searchParam !== undefined && { searchParam: v.searchParam as string }),
  };
}

/**
 * The `valueField` / `labelField` pair, the optional `searchField` and the optional `searchTemplate` next to a datasource;
 * problems go under `path`.
 */
export function validateSourceFields(o: Record<string, unknown>, path: string, problems: Problem[]): Omit<DataSourceOptions, "dataSource"> | undefined {
  let ok = true;
  for (const k of ["valueField", "labelField"] as const) {
    if (typeof o[k] !== "string" || o[k] === "") { problems.push({ path: `${path}.${k}`, message: "must be a non-empty string" }); ok = false; }
  }
  if (o.searchField !== undefined && (typeof o.searchField !== "string" || o.searchField === "")) {
    problems.push({ path: `${path}.searchField`, message: "must be a non-empty string" }); ok = false;
  }
  let searchTemplate: SearchTemplate | undefined;
  if (o.searchTemplate !== undefined) {
    const s = o.searchTemplate;
    if (!isObj(s)) { problems.push({ path: `${path}.searchTemplate`, message: "must be an object" }); ok = false; }
    else {
      for (const k of Object.keys(s)) if (k !== "minChars" && k !== "debounceMs") { problems.push({ path: `${path}.searchTemplate.${k}`, message: "unknown key" }); ok = false; }
      for (const k of ["minChars", "debounceMs"] as const) {
        if (s[k] !== undefined && !(Number.isInteger(s[k]) && (s[k] as number) >= 0)) { problems.push({ path: `${path}.searchTemplate.${k}`, message: "must be a non-negative integer" }); ok = false; }
      }
      if (ok) searchTemplate = { ...(s.minChars !== undefined && { minChars: s.minChars as number }), ...(s.debounceMs !== undefined && { debounceMs: s.debounceMs as number }) };
    }
  }
  return ok ? {
    valueField: o.valueField as string, labelField: o.labelField as string,
    ...(o.searchField !== undefined && { searchField: o.searchField as string }),
    ...(searchTemplate !== undefined && { searchTemplate }),
  } : undefined;
}

/**
 * The rules between a report datasource and the fields next to it (a REST source has none to check here): `valueField`,
 * `labelField` and `searchField` are report columns; with `searchParam` the report searches, so `searchField` (the
 * local filter's column) does not apply; without it no request follows the typed text, so `searchTemplate` does not
 * apply. Problems go under `path` (the field's or the overlay entry's).
 */
export function checkSource(source: DataSourceOptions, path: string, problems: Problem[]): void {
  const ds = source.dataSource;
  if (ds.type !== "BIPReport") return;
  const names = ds.columns.map((c) => c.name);
  for (const k of ["valueField", "labelField", "searchField"] as const) {
    const name = source[k];
    if (name !== undefined && !names.includes(name)) problems.push({ path: `${path}.${k}`, message: `"${name}" is not one of the report's columns` });
  }
  if (ds.searchParam !== undefined && source.searchField !== undefined) {
    problems.push({ path: `${path}.searchField`, message: "does not apply with dataSource.searchParam (the report searches)" });
  }
  if (ds.searchParam === undefined && source.searchTemplate !== undefined) {
    problems.push({ path: `${path}.searchTemplate`, message: "needs dataSource.searchParam (without it the typed text filters the report's rows locally, no request)" });
  }
}

/** The pod path a datasource is called on (what `datasources.allowPrefixes` is matched against). */
export function podPathOf(ds: DataSourceDef): string {
  return ds.type === "BIPReport" ? BIP_SERVICE_PATH : ds.url;
}

/**
 * Why an agent-carried (inline) datasource may not be loaded under the config's policy (D7), or null when it may:
 * `datasources.allowInline` must be true and the datasource's pod path (a REST url; for a report the report service
 * path) must start with one of `datasources.allowPrefixes`.
 * A datasource from the config overlay is the customer's own and is not subject to this check.
 */
export function inlineRefusal(ds: DataSourceDef, policy: DataSourcePolicy): string | null {
  if (!policy.allowInline) return "datasource not allowed: datasources.allowInline is off";
  const path = podPathOf(ds);
  if (!policy.allowPrefixes.some((p) => p !== "" && path.startsWith(p))) {
    return ds.type === "BIPReport"
      ? `datasource not allowed: report ${ds.reportName} runs through ${path}, which is not under datasources.allowPrefixes`
      : `datasource not allowed: ${path} is not under datasources.allowPrefixes`;
  }
  return null;
}

/**
 * Why a datasource (inline or from the config) cannot be served by its provider, or null: a REST select is paged and
 * searched through query parameters (GET only), and `lodash` transforms are code the chat never evaluates (the
 * dashboard runs them through `new Function`; agent-written code must not execute in the customer's Fusion page).
 */
export function sourceRefusal(ds: DataSourceDef): string | null {
  if (ds.type === "BIPReport") return null;
  if (ds.method !== "GET") return `datasource method ${ds.method} is not supported by the select datasource (GET only)`;
  if (ds.dataTransform?.type === "lodash") return 'dataTransform "lodash" is not supported by the chat (no expression evaluation)';
  return null;
}
