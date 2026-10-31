// The report data provider (rest/report-data-provider.js): the exact runReport call it posts through the pack's real
// Endpoint (dashboard-rest-helper over a fake VB RestHelper that records the request), how it reads a BI Publisher answer,
// and the pages it hands RESTDataProvider (search by the report's parameter or locally, paging, fetchByKeys, errors).
// JET's RESTDataProvider is stubbed to capture the constructor options.
import { TextDecoder as NodeTextDecoder } from "util";
import { loadAmd, stubAmd } from "./amd";
import { BIP_SERVICE_PATH as CHAT_BIP_SERVICE_PATH } from "../../../xxx-gnimsys-ai/chat/lib/widgets/datasource";

// jsdom has no TextDecoder; the browser does (the provider decodes reportBytes as UTF-8 with it).
if (typeof (globalThis as { TextDecoder?: unknown }).TextDecoder === "undefined") {
  (globalThis as unknown as { TextDecoder: typeof NodeTextDecoder }).TextDecoder = NodeTextDecoder;
}

type Page = { data: Array<Record<string, unknown>>; hasMore: boolean; totalSize?: number };
type FetchOptions = { fetchParameters: { filterCriterion?: { text: string }; size?: number; offset?: number; keys?: Set<unknown> } };
type Hooks = { fetchFirst: (o: FetchOptions) => Promise<Page>; fetchByOffset: (o: FetchOptions) => Promise<Page>; fetchByKeys: (o: FetchOptions) => Promise<Page> };
type DpOptions = { keyAttributes: string; textFilterAttributes: string[]; capabilities: Record<string, unknown>; restHelper: Hooks };

class FakeRestDataProvider {
  options: DpOptions;
  constructor(options: DpOptions) { this.options = options; }
}
stubAmd("ojs/ojrestdataprovider", { RESTDataProvider: FakeRestDataProvider });

type Column = { name: string; type?: number };
type Mod = {
  createReportDataProvider(o: Record<string, unknown>): FakeRestDataProvider;
  runReportEnvelope(reportName: string, parameters: Array<{ name: string; values: string[] }>): string;
  reportXmlOf(soap: unknown): string;
  reportRows(xml: string, shape: { recordsetSelector: string; recordSelector: string; columns: Column[]; valueField?: string }): Array<Record<string, unknown>>;
  faultText(text: unknown): string | null;
  elementName(c: string): string;
  BIP_SERVICE_PATH: string;
  SOAP_HEADERS: Record<string, string>;
};
const mod = loadAmd("xxx-gnimsys-data/rest/report-data-provider") as Mod;
const DashboardRestHelper = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as new (h: unknown, m: Record<string, string>) => {
  createEndpoint(c: object): { create(d: unknown, o?: object): Promise<unknown> };
};

const BASE = "https://pod.example.com";
const REPORT = "/Custom/Gnimsys/LOV/SUPPLIER_SITES.xdo";
const COLUMNS: Column[] = [{ name: "VENDOR_SITE_ID", type: 2 }, { name: "VENDOR_NAME" }, { name: "VENDOR_SITE_CODE" }, { name: "CITY" }, { name: "SITE_LABEL" }];

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
const soapOk = (xml: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>` +
  `<ns0:runReportResponse xmlns:ns0="http://xmlns.oracle.com/oxp/service/PublicReportService"><ns0:runReportReturn>` +
  `<ns0:reportBytes>${b64(xml)}</ns0:reportBytes><ns0:reportContentType>text/xml</ns0:reportContentType></ns0:runReportReturn></ns0:runReportResponse></env:Body></env:Envelope>`;
const soapFault12 = (reason: string): string =>
  `<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body><env:Fault><env:Code><env:Value>env:Receiver</env:Value></env:Code>` +
  `<env:Reason><env:Text xml:lang="en">${reason}</env:Text></env:Reason></env:Fault></env:Body></env:Envelope>`;

type Site = { id: number; name: string; code: string; city?: string };
const SITES: Site[] = [
  { id: 400001, name: "Smith & Sons", code: "NYC-01", city: "New York" },
  { id: 400002, name: "Smith & Sons", code: "CHI-01", city: "Chicago" },
  { id: 400011, name: "Acme Corp", code: "NYC-02", city: "New York" },
  { id: 400012, name: "Acme Corp", code: "SFO-02" },
];
const dataXml = (sites: Site[]): string => `<?xml version="1.0" encoding="UTF-8"?>\n<DATA_DS><P_BU_NAME>US1</P_BU_NAME>${sites.map((s) =>
  `<G_1><VENDOR_SITE_ID>${s.id}</VENDOR_SITE_ID><VENDOR_NAME>${s.name.replace("&", "&amp;")}</VENDOR_NAME><VENDOR_SITE_CODE>${s.code}</VENDOR_SITE_CODE>` +
  `${s.city !== undefined ? `<CITY>${s.city}</CITY>` : ""}<SITE_LABEL>${s.name.replace("&", "&amp;")} — ${s.code}</SITE_LABEL></G_1>`).join("")}</DATA_DS>`;
const row = (s: Site) => ({ VENDOR_SITE_ID: s.id, VENDOR_NAME: s.name, VENDOR_SITE_CODE: s.code, CITY: s.city ?? null, SITE_LABEL: `${s.name} — ${s.code}` });

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown };
/**
 * A fake VB RestHelper: records every request (final url, method, headers, body), answers with `answer(body)` — a
 * string body (status 200), or `{ status, body }`.
 */
function fakeVb(answer: (body: string) => string | { status: number; body: string }) {
  const sent: Sent[] = [];
  const helper = {
    get() {
      let init: { method: string; headers: Record<string, string>; body?: unknown } | undefined;
      let fns: { body: (c: { url: string; endpointDefinition: { url: string } }) => { url: string } } | undefined;
      const chain = {
        initConfiguration(c: typeof init) { init = c; return chain; },
        requestTransformationFunctions(f: typeof fns) { fns = f; return chain; },
        fetch() {
          const url = (fns as NonNullable<typeof fns>).body({ url: BASE, endpointDefinition: { url: BASE } }).url;
          const i = init as NonNullable<typeof init>;
          sent.push({ url, method: i.method, headers: i.headers, body: i.body });
          const a = answer(String(i.body));
          const { status, body } = typeof a === "string" ? { status: 200, body: a } : a;
          return Promise.resolve({ response: { status, statusText: status === 200 ? "OK" : "Internal Server Error" }, body });
        },
      };
      return chain;
    },
  };
  return { helper, sent };
}

/** The search text a runReport body carries in P_SEARCH (undefined without that parameter). */
const searchOf = (body: unknown): string | undefined => {
  const m = /<pub:name>P_SEARCH<\/pub:name><pub:values><pub:item>([^<]*)<\/pub:item>/.exec(String(body));
  return m === null ? undefined : m[1];
};

/** A provider over the real Endpoint; the fake report answers SITES filtered by P_SEARCH (contains, any case). */
function provider(extra: Record<string, unknown> = {}, answer?: (body: string) => string | { status: number; body: string }) {
  const vb = fakeVb(answer ?? ((body) => {
    const q = (searchOf(body) ?? "").toLowerCase();
    return soapOk(dataXml(SITES.filter((s) => q === "" || `${s.name} ${s.code}`.toLowerCase().includes(q))));
  }));
  const rest = new DashboardRestHelper(vb.helper, { FA: "faConn" });
  const errors: Array<string | null> = [];
  const dp = mod.createReportDataProvider({
    createEndpoint: (u: string, headers: Record<string, string>) => rest.createEndpoint({ target: "FA", url: u, headers }),
    reportName: REPORT, recordsetSelector: "DATA_DS", recordSelector: "G_1", columns: COLUMNS,
    parameters: [{ name: "P_BU_NAME", value: "US1 Business Unit" }],
    valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL", pageSize: 2, searchTemplate: { debounceMs: 0 },
    onError: (m: string | null) => errors.push(m),
    ...extra,
  });
  return { hooks: dp.options.restHelper, options: dp.options, sent: vb.sent, errors };
}
const first = (text = "", offset = 0): FetchOptions => ({ fetchParameters: { ...(text !== "" && { filterCriterion: { text } }), offset, size: 25 } });

describe("runReport envelope", () => {
  test("the_soap_12_envelope_byte_for_byte_with_escaped_values_and_multi_value_parameters", () => {
    expect(mod.runReportEnvelope("/Custom/A & B/R.xdo", [{ name: "P_BU", values: ["US1"] }, { name: "P_TYPES", values: ["A<1>", "B"] }])).toBe(
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">' +
      "<soap:Header/><soap:Body><pub:runReport><pub:reportRequest><pub:attributeFormat>xml</pub:attributeFormat>" +
      "<pub:parameterNameValues><pub:item><pub:name>P_BU</pub:name><pub:values><pub:item>US1</pub:item></pub:values></pub:item>" +
      "<pub:item><pub:name>P_TYPES</pub:name><pub:values><pub:item>A&lt;1&gt;</pub:item><pub:item>B</pub:item></pub:values></pub:item></pub:parameterNameValues>" +
      "<pub:reportAbsolutePath>/Custom/A &amp; B/R.xdo</pub:reportAbsolutePath><pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>" +
      "</pub:reportRequest></pub:runReport></soap:Body></soap:Envelope>",
    );
  });

  test("no_parameter_leaves_parameterNameValues_out", () => {
    expect(mod.runReportEnvelope("/R.xdo", [])).not.toContain("parameterNameValues");
  });

  test("the_service_path_is_the_one_the_chat_gates", () => {
    expect(mod.BIP_SERVICE_PATH).toBe("/xmlpserver/services/ExternalReportWSSService");
    expect(CHAT_BIP_SERVICE_PATH).toBe(mod.BIP_SERVICE_PATH);
    expect(mod.SOAP_HEADERS).toEqual({ "Content-Type": "application/soap+xml; charset=utf-8" });
  });
});

describe("reading a report answer", () => {
  const shape = { recordsetSelector: "DATA_DS", recordSelector: "G_1", columns: COLUMNS, valueField: "VENDOR_SITE_ID" };

  test("reportBytes_decode_as_utf8_and_rows_are_the_group_elements_typed_by_column", () => {
    const xml = mod.reportXmlOf(soapOk(dataXml(SITES)));
    expect(xml).toContain("Smith &amp; Sons — NYC-01");
    // A top-level element (a parameter echo) is not a row; an absent CITY is null; type 2 is a number; & unescaped.
    expect(mod.reportRows(xml, shape)).toEqual(SITES.map(row));
  });

  test("a_column_named_outside_xml_names_is_matched_in_bip_xHHHH_form_and_nested_groups_do_not_leak", () => {
    expect(mod.elementName("Vendor Name?")).toBe("Vendor_x0020_Name_x003F_");
    const xml = "<DATA_DS><G_1><Vendor_x0020_Name>Acme</Vendor_x0020_Name><ID>7</ID><G_2><ID>99</ID></G_2></G_1><G_1><ID>8</ID><Vendor_x0020_Name/></G_1></DATA_DS>";
    expect(mod.reportRows(xml, { recordsetSelector: "DATA_DS", recordSelector: "G_1", columns: [{ name: "ID", type: 2 }, { name: "Vendor Name" }] }))
      .toEqual([{ ID: 7, "Vendor Name": "Acme" }, { ID: 8, "Vendor Name": "" }]);
  });

  test("a_number_column_with_text_a_row_without_its_key_and_a_missing_recordset_are_errors", () => {
    expect(() => mod.reportRows("<DATA_DS><G_1><VENDOR_SITE_ID>x1</VENDOR_SITE_ID></G_1></DATA_DS>", shape))
      .toThrow('row 1: column VENDOR_SITE_ID is a number (type 2) but holds "x1"');
    expect(() => mod.reportRows("<DATA_DS><G_1><VENDOR_NAME>A</VENDOR_NAME></G_1></DATA_DS>", shape))
      .toThrow("row 1 has no VENDOR_SITE_ID (valueField): a select option needs a key");
    expect(() => mod.reportRows("<OTHER/>", shape)).toThrow("the report output has no DATA_DS element (recordsetSelector)");
    expect(() => mod.reportRows("<DATA_DS>", shape)).toThrow("the report output is not well-formed XML");
  });

  test("faults_read_as_their_text_soap_12_and_11_and_an_answer_without_reportBytes_is_an_error", () => {
    expect(mod.faultText(soapFault12("PublicReportService::executeReport Failure: no access"))).toBe("PublicReportService::executeReport Failure: no access");
    expect(mod.faultText('<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>boom</faultstring></S:Fault></S:Body></S:Envelope>')).toBe("boom");
    expect(mod.faultText(soapOk("<DATA_DS/>"))).toBeNull();
    expect(mod.faultText("<html>login</html>")).toBeNull();
    expect(() => mod.reportXmlOf(soapFault12("no access"))).toThrow("no access");
    expect(() => mod.reportXmlOf("<html><body>login</body></html>")).toThrow("the report service answer has no reportBytes");
    expect(() => mod.reportXmlOf("")).toThrow("the report service answered no XML");
  });
});

describe("report data provider", () => {
  test("posts_runReport_to_the_report_service_with_the_soap_header_the_fixed_parameters_and_the_typed_text", async () => {
    const { hooks, options, sent, errors } = provider({ searchParam: "P_SEARCH" });
    expect(options.keyAttributes).toBe("VENDOR_SITE_ID");
    expect(await hooks.fetchFirst(first("smith"))).toEqual({ data: SITES.slice(0, 2).map(row), hasMore: false, totalSize: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${BASE}/xmlpserver/services/ExternalReportWSSService`);
    expect(sent[0].method).toBe("POST");
    expect(sent[0].headers).toEqual({ "Content-Type": "application/soap+xml; charset=utf-8" });
    expect(sent[0].body).toBe(mod.runReportEnvelope(REPORT, [{ name: "P_BU_NAME", values: ["US1 Business Unit"] }, { name: "P_SEARCH", values: ["smith"] }]));
    expect(errors).toEqual([null]);
  });

  test("without_text_the_search_parameter_is_empty_rows_are_paged_here_and_a_run_is_kept_for_its_pages", async () => {
    const { hooks, sent } = provider({ searchParam: "P_SEARCH" });
    expect(await hooks.fetchFirst(first())).toEqual({ data: SITES.slice(0, 2).map(row), hasMore: true, totalSize: 4 });
    expect(await hooks.fetchByOffset(first("", 2))).toEqual({ data: SITES.slice(2, 4).map(row), hasMore: false, totalSize: 4 });
    expect(sent.map((s) => searchOf(s.body))).toEqual([""]);
    // The same text again: the kept run answers.
    await hooks.fetchFirst(first());
    expect(sent).toHaveLength(1);
  });

  test("text_below_minChars_answers_empty_without_a_run_and_a_superseded_text_is_dropped", async () => {
    const { hooks, sent } = provider({ searchParam: "P_SEARCH", searchTemplate: { minChars: 2, debounceMs: 20 } });
    expect(await hooks.fetchFirst(first("s"))).toEqual({ data: [], hasMore: false });
    const older = hooks.fetchFirst(first("sm"));
    const newer = hooks.fetchFirst(first("smi"));
    expect(await older).toEqual({ data: [], hasMore: false });
    expect((await newer).data.map((r) => r.VENDOR_SITE_ID)).toEqual([400001, 400002]);
    expect(sent.map((s) => searchOf(s.body))).toEqual(["smi"]);
  });

  test("without_searchParam_the_report_runs_once_and_the_text_filters_its_rows_on_searchField", async () => {
    const { hooks, sent } = provider({ searchField: "VENDOR_SITE_CODE", searchTemplate: undefined });
    expect((await hooks.fetchFirst(first("nyc"))).data.map((r) => r.VENDOR_SITE_ID)).toEqual([400001, 400011]);
    expect((await hooks.fetchFirst(first("sfo"))).data.map((r) => r.VENDOR_SITE_ID)).toEqual([400012]);
    expect(await hooks.fetchFirst(first())).toMatchObject({ hasMore: true, totalSize: 4 });
    expect(sent).toHaveLength(1);
    expect(searchOf(sent[0].body)).toBeUndefined();
  });

  test("fetchByKeys_answers_from_the_rows_seen_else_from_the_unsearched_run", async () => {
    const { hooks, sent } = provider({ searchParam: "P_SEARCH" });
    await hooks.fetchFirst(first("acme"));
    expect(await hooks.fetchByKeys({ fetchParameters: { keys: new Set([400012]) } })).toEqual({ data: [row(SITES[3])], hasMore: false });
    expect(sent).toHaveLength(1);
    // A key not seen yet: the unsearched run; a key nowhere is left out.
    expect(await hooks.fetchByKeys({ fetchParameters: { keys: new Set([400002, 999]) } })).toEqual({ data: [row(SITES[1])], hasMore: false });
    expect(sent.map((s) => searchOf(s.body))).toEqual(["acme", ""]);
  });

  test("a_failed_run_is_reported_with_its_fault_answers_empty_and_is_run_again_next_time", async () => {
    let fail = true;
    const { hooks, sent, errors } = provider({ searchParam: "P_SEARCH" }, () => (fail ? { status: 500, body: soapFault12("Failed to read the report") } : soapOk(dataXml(SITES))));
    expect(await hooks.fetchFirst(first())).toEqual({ data: [], hasMore: false });
    expect(errors).toEqual([`report ${REPORT} failed: Failed to read the report`]);
    fail = false;
    expect((await hooks.fetchFirst(first())).data).toHaveLength(2);
    expect(errors.at(-1)).toBeNull();
    expect(sent).toHaveLength(2);
  });

  test("an_unreadable_answer_names_the_report_and_without_onError_the_fetch_rejects", async () => {
    const { hooks } = provider({ searchParam: "P_SEARCH", onError: undefined }, () => soapOk("<DATA_DS><G_1><VENDOR_SITE_ID>x</VENDOR_SITE_ID></G_1></DATA_DS>"));
    await expect(hooks.fetchFirst(first())).rejects.toThrow(`report ${REPORT} failed: row 1: column VENDOR_SITE_ID is a number (type 2) but holds "x"`);
    const http = provider({ onError: undefined }, () => ({ status: 503, body: "" }));
    await expect(http.hooks.fetchFirst(first())).rejects.toThrow(`report ${REPORT} failed: HTTP 503`);
  });

  test("construction_refuses_missing_inputs_and_fields_outside_the_columns", () => {
    const base = { createEndpoint: () => ({}), reportName: REPORT, recordsetSelector: "DATA_DS", recordSelector: "G_1", columns: COLUMNS, valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL" };
    expect(() => mod.createReportDataProvider({ ...base, reportName: "" })).toThrow("createReportDataProvider needs reportName");
    expect(() => mod.createReportDataProvider({ ...base, columns: [] })).toThrow("createReportDataProvider needs columns");
    expect(() => mod.createReportDataProvider({ ...base, labelField: "NOPE" })).toThrow("labelField NOPE is not one of the columns");
    expect(() => mod.createReportDataProvider({ ...base, searchParam: "P", parameters: [{ name: "P", value: "x" }] })).toThrow("searchParam P is also a fixed parameter");
  });
});
