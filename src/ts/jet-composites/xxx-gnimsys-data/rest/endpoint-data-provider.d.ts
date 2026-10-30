// Typings of the AMD module xxx-gnimsys-data/rest/endpoint-data-provider (see its module comment for the filters it writes).
import type { DataProvider } from "ojs/ojdataprovider";
import type { Endpoint, EndpointRequestOptions } from "./index";

/** The url's query language: `fa` = Fusion REST resources (`q`, `limit`, `offset`); `boss` = Business Objects (`$filter`, `$limit`, `$offset`). */
export type EndpointDataProviderDialect = "fa" | "boss";

export interface EndpointDataProviderOptions {
  /**
   * The caller's Endpoint factory for a url of the datasource and the request headers the provider sends with it (the
   * datasource's own, plus `REST-Framework-Version` for `fa`); target and path checks are the caller's.
   */
  createEndpoint: (url: string, headers: Record<string, string>) => Pick<Endpoint, "fetch">;
  /** Required: how the url filters and pages (see the module comment). */
  dialect: EndpointDataProviderDialect;
  /** The datasource url; its filter parameter (`q` / `$filter`), if any, is a FIXED filter (no placeholder). */
  url: string;
  /** The datasource's own request headers; a `REST-Framework-Version` below 2 is refused for `fa`. */
  headers?: Record<string, string>;
  /** Row field that is the key (the option value). */
  valueField: string;
  /** Row field the dropdown shows (the option label); the searched attribute without `searchField`. */
  labelField: string;
  /** The attribute the typed text searches (case-insensitive contains); default `labelField`. */
  searchField?: string;
  /** Rows per page (default 25). */
  pageSize?: number;
  /** Typed-text search: `minChars` (default 1) and `debounceMs` (default 250). */
  searchTemplate?: { minChars?: number; debounceMs?: number };
  /** Only `map` (a dotted path to the row array) is evaluated. */
  dataTransform?: { type: string; expression: string };
}

export interface UrlForms { url: string; fixedFilter: string | null }

export function createEndpointDataProvider<K extends string | number = string | number, D = Record<string, unknown>>(
  options: EndpointDataProviderOptions,
): DataProvider<K, D>;
export function urlForms(url: string, dialect: EndpointDataProviderDialect): UrlForms;
export function searchClause(dialect: EndpointDataProviderDialect, attribute: string, text: string): string;
export function requestHeaders(dialect: EndpointDataProviderDialect, headers?: Record<string, string>): Record<string, string>;
export function rowsOf(body: unknown, dataTransform?: { type: string; expression: string }): unknown[];
export function pageOf(result: { body: unknown }, dataTransform: { type: string; expression: string } | undefined, limit: number): { data: unknown[]; hasMore: boolean; totalSize?: number };
export function quoteForQ(text: unknown): string;
export const DEFAULTS: { pageSize: number; minChars: number; debounceMs: number };
/** The `REST-Framework-Version` the provider sends with `fa` requests unless the datasource sets it. */
export const FA_FRAMEWORK_VERSION: string;
export type { EndpointRequestOptions };
