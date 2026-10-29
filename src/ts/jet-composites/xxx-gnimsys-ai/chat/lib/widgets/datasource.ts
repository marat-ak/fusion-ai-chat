import { ENDPOINT_NAMES } from "../endpoints/EndpointFetch";
import type { EndpointMethod, EndpointName } from "../endpoints/EndpointFetch";
import type { Problem } from "../config/types";

/**
 * A select field's datasource (gnimsys-ui v1 rev 2 §2.3): the dashboard's REST datasource shape, carried inline by the
 * agent or by the config overlay `widgets[widgetId].fields[fieldId]`, served by the data pack's endpoint data provider
 * (xxx-gnimsys-data/rest/endpoint-data-provider: a JET RESTDataProvider that pages and searches on the server through
 * the page's endpoints, in the target's query language: BOSS = `$filter` / `$limit` / `$offset`, the others Fusion REST
 * `q` / `limit` / `offset`). This module validates the shape and decides what may be loaded; the loading is the provider's.
 */
export interface DataTransform { type: "lodash" | "map"; expression: string }
export interface DataSourceDef {
  type: "rest";
  target: EndpointName;
  method: EndpointMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  dataTransform?: DataTransform;
}
/** Typed-text search of a datasource select: `minChars` (default 1) and `debounceMs` (default 250). */
export interface SearchTemplate { minChars?: number; debounceMs?: number }
/** A field's option source: the datasource plus the row fields that become the option value and label. */
export interface DataSourceOptions { dataSource: DataSourceDef; valueField: string; labelField: string; searchTemplate?: SearchTemplate }
export interface Option { value: string | number; label: string; description?: string }
/** Config `datasources` (D7): whether an agent may carry a datasource inline, under which pod paths, and the page size. */
export interface DataSourcePolicy { allowInline: boolean; allowPrefixes: string[]; pageSize: number }

const METHODS: readonly EndpointMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const TRANSFORMS: readonly DataTransform["type"][] = ["lodash", "map"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates a datasource object (shape of the schema's `dataSource`); problems are appended under `path`. */
export function validateDataSource(v: unknown, path: string, problems: Problem[]): DataSourceDef | undefined {
  const bad = (p: string, message: string): undefined => { problems.push({ path: p, message }); return undefined; };
  if (!isObj(v)) return bad(path, "must be an object");
  let ok = true;
  for (const k of Object.keys(v)) {
    if (!["type", "target", "method", "url", "headers", "body", "dataTransform"].includes(k)) { bad(`${path}.${k}`, "unknown key"); ok = false; }
  }
  if (v.type !== "rest") { bad(`${path}.type`, 'must be "rest"'); ok = false; }
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

/** The `valueField` / `labelField` pair and the optional `searchTemplate` next to a datasource; problems go under `path`. */
export function validateSourceFields(o: Record<string, unknown>, path: string, problems: Problem[]): Omit<DataSourceOptions, "dataSource"> | undefined {
  let ok = true;
  for (const k of ["valueField", "labelField"] as const) {
    if (typeof o[k] !== "string" || o[k] === "") { problems.push({ path: `${path}.${k}`, message: "must be a non-empty string" }); ok = false; }
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
  return ok ? { valueField: o.valueField as string, labelField: o.labelField as string, ...(searchTemplate !== undefined && { searchTemplate }) } : undefined;
}

/**
 * Why an agent-carried (inline) datasource may not be loaded under the config's policy (D7), or null when it may:
 * `datasources.allowInline` must be true and the URL must start with one of `datasources.allowPrefixes`.
 * A datasource from the config overlay is the customer's own and is not subject to this check.
 */
export function inlineRefusal(ds: DataSourceDef, policy: DataSourcePolicy): string | null {
  if (!policy.allowInline) return "datasource not allowed: datasources.allowInline is off";
  if (!policy.allowPrefixes.some((p) => p !== "" && ds.url.startsWith(p))) {
    return `datasource not allowed: ${ds.url} is not under datasources.allowPrefixes`;
  }
  return null;
}

/**
 * Why a datasource (inline or from the config) cannot be served by the endpoint data provider, or null: only GET is
 * paged and searched through query parameters, and `lodash` transforms are code the chat never evaluates (the
 * dashboard runs them through `new Function`; agent-written code must not execute in the customer's Fusion page).
 */
export function sourceRefusal(ds: DataSourceDef): string | null {
  if (ds.method !== "GET") return `datasource method ${ds.method} is not supported by the select datasource (GET only)`;
  if (ds.dataTransform?.type === "lodash") return 'dataTransform "lodash" is not supported by the chat (no expression evaluation)';
  return null;
}
