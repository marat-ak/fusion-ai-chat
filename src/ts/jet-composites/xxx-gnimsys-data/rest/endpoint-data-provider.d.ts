// Typings of the AMD module xxx-gnimsys-data/rest/endpoint-data-provider (see its module comment for the url forms).
import type { DataProvider } from "ojs/ojdataprovider";
import type { Endpoint, EndpointRequestOptions } from "./index";

export interface EndpointDataProviderOptions {
  /** The caller's Endpoint factory for a url of the datasource (target, headers and path checks are the caller's). */
  createEndpoint: (url: string) => Pick<Endpoint, "fetch">;
  /** The datasource url, with `{{query}}` inside its `q` parameter for a server search. */
  url: string;
  /** Row field that is the key (the option value). */
  valueField: string;
  /** Row field the dropdown shows and filters by (the option label). */
  labelField: string;
  /** Rows per page (default 25). */
  pageSize?: number;
  /** Typed-text search: `minChars` (default 1) and `debounceMs` (default 250). */
  searchTemplate?: { minChars?: number; debounceMs?: number };
  /** Only `map` (a dotted path to the row array) is evaluated. */
  dataTransform?: { type: string; expression: string };
}

export interface UrlForms { page: string; keys: string; qTemplate: string | null }

export function createEndpointDataProvider<K extends string | number = string | number, D = Record<string, unknown>>(
  options: EndpointDataProviderOptions,
): DataProvider<K, D>;
export function urlForms(url: string): UrlForms;
export function rowsOf(body: unknown, dataTransform?: { type: string; expression: string }): unknown[];
export function pageOf(result: { body: unknown }, dataTransform: { type: string; expression: string } | undefined, limit: number): { data: unknown[]; hasMore: boolean; totalSize?: number };
export function quoteForQ(text: unknown): string;
export const DEFAULTS: { pageSize: number; minChars: number; debounceMs: number };
export type { EndpointRequestOptions };
