// Typings of the AMD module xxx-gnimsys-data/rest/report-data-provider (see its module comment for the call it makes).
import type { DataProvider } from "ojs/ojdataprovider";
import type { Endpoint } from "./index";

/** A report output column: `type` 2 = a number, anything else (or none) = the element's text. */
export interface ReportColumn { name: string; type?: number }
/** A fixed report parameter: a value, or several (a multi-value parameter). */
export interface ReportParameter { name: string; value: string | number | Array<string | number> }

export interface ReportDataProviderOptions {
  /** The caller's Endpoint factory for the report service path and the SOAP headers; target and path checks are the caller's. */
  createEndpoint: (url: string, headers: Record<string, string>) => Pick<Endpoint, "create">;
  /** The report's absolute catalog path (`…/NAME.xdo`). */
  reportName: string;
  /** The element that wraps the rows (the data model's root, e.g. `DATA_DS`). */
  recordsetSelector: string;
  /** The element of one row (the data set's group, e.g. `G_1`). */
  recordSelector: string;
  /** The row fields read from each row element; valueField / labelField / searchField must be among them. */
  columns: ReportColumn[];
  /** Fixed parameters, sent with every run. */
  parameters?: ReportParameter[];
  /** The parameter that takes the typed text (each text = one run); without it the one output is filtered locally. */
  searchParam?: string;
  valueField: string;
  labelField: string;
  /** The column the local filter matches (no searchParam only); default labelField. */
  searchField?: string;
  /** Rows per page (default 25). */
  pageSize?: number;
  /** searchParam runs: `minChars` (default 1) and `debounceMs` (default 250). */
  searchTemplate?: { minChars?: number; debounceMs?: number };
  /** A failed run's message (the fetch then answers an empty page), null once a run succeeds; without it a fetch rejects. */
  onError?: (message: string | null) => void;
}

export function createReportDataProvider<K extends string | number = string | number, D = Record<string, unknown>>(
  options: ReportDataProviderOptions,
): DataProvider<K, D>;
export function runReportEnvelope(reportName: string, parameters: Array<{ name: string; values: string[] }>): string;
export function reportXmlOf(soapText: unknown): string;
export function reportRows(reportXml: string, shape: { recordsetSelector: string; recordSelector: string; columns: ReportColumn[]; valueField?: string }): Array<Record<string, unknown>>;
export function faultText(text: unknown): string | null;
export function elementName(column: string): string;
/** `/xmlpserver/services/ExternalReportWSSService`: the pod path every report run is posted to (FA endpoint). */
export const BIP_SERVICE_PATH: string;
export const SOAP_HEADERS: Record<string, string>;
export const DEFAULTS: { pageSize: number; minChars: number; debounceMs: number };
