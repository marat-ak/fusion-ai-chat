// Characterisation of the endpoint data provider (rest/endpoint-data-provider.js): the exact urls its fetches produce
// through the pack's real Endpoint (dashboard-rest-helper over a fake VB RestHelper that records the final url) and the
// pages it hands RESTDataProvider. JET's RESTDataProvider is stubbed to capture the constructor options.
import { loadAmd, stubAmd } from "./amd";

type Page = { data: unknown[]; hasMore: boolean; totalSize?: number };
type FetchOptions = { fetchParameters: { filterCriterion?: { text: string }; size?: number; offset?: number; includeFilteredRowCount?: string; keys?: Set<unknown> } };
type RestHelperHooks = {
  fetchFirst: (o: FetchOptions) => Promise<Page>;
  fetchByOffset: (o: FetchOptions) => Promise<Page>;
  fetchByKeys: (o: FetchOptions) => Promise<Page>;
};
type DpOptions = { keyAttributes: string; textFilterAttributes: string[]; capabilities: Record<string, unknown>; restHelper: RestHelperHooks };

const captured: DpOptions[] = [];
class FakeRestDataProvider {
  options: DpOptions;
  constructor(options: DpOptions) { this.options = options; captured.push(options); }
}
stubAmd("ojs/ojrestdataprovider", { RESTDataProvider: FakeRestDataProvider });

type Mod = {
  createEndpointDataProvider(o: Record<string, unknown>): FakeRestDataProvider;
  urlForms(url: string, dialect: string): { url: string; fixedFilter: string | null };
  searchClause(dialect: string, attribute: string, text: string): string;
  requestHeaders(dialect: string, headers?: Record<string, string>): Record<string, string>;
  rowsOf(body: unknown, t?: { type: string; expression: string }): unknown[];
  pageOf(result: { body: unknown }, t: { type: string; expression: string } | undefined, limit: number): Page;
  quoteForQ(t: unknown): string;
  DEFAULTS: { pageSize: number; minChars: number; debounceMs: number };
  FA_FRAMEWORK_VERSION: string;
};
const mod = loadAmd("xxx-gnimsys-data/rest/endpoint-data-provider") as Mod;
const DashboardRestHelper = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as new (h: unknown, m: Record<string, string>) => { createEndpoint(c: object): { fetch(o?: object): Promise<unknown> } };

const BASE = "https://pod.example.com/fa";
/** A fixed filter on the url (no placeholder): the provider adds the search clause itself. */
const KRN_URL = "/fscmRestApi/resources/11.13.18.05/subinventories?q=OrganizationCode='M1'&fields=SubinventoryCode,Description";

/** A fake VB RestHelper: records every final request url and its headers, answers the queued bodies. */
function fakeVb(bodies: unknown[]) {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const queue = [...bodies];
  const helper = {
    get() {
      let fns: { body: (c: { url: string; endpointDefinition: { url: string } }) => { url: string } } | undefined;
      const chain = {
        initConfiguration(c: { headers: Record<string, string> }) { headers.push(c.headers); return chain; },
        requestTransformationFunctions(f: typeof fns) { fns = f; return chain; },
        fetch() {
          const c = { url: BASE, endpointDefinition: { url: BASE } };
          urls.push((fns as NonNullable<typeof fns>).body(c).url);
          return Promise.resolve({ response: { status: 200, statusText: "OK" }, body: queue.shift() });
        },
      };
      return chain;
    },
  };
  return { helper, urls, headers };
}

function provider(bodies: unknown[], extra: Record<string, unknown> = {}, url = KRN_URL) {
  const vb = fakeVb(bodies);
  const rest = new DashboardRestHelper(vb.helper, { FA: "faConn" });
  const dp = mod.createEndpointDataProvider({
    createEndpoint: (u: string, headers: Record<string, string>) => rest.createEndpoint({ target: "FA", url: u, headers }),
    dialect: "fa", url, valueField: "SubinventoryCode", labelField: "Description", searchTemplate: { debounceMs: 0 }, ...extra,
  });
  return { hooks: dp.options.restHelper, options: dp.options, urls: vb.urls, headers: vb.headers };
}

/** The decoded query parameters of a recorded url, in order. */
const paramsOf = (u: string): Array<[string, string]> => [...new URL(u).searchParams.entries()];

/** A BOSS datasource over the pack's real Endpoint (target BOSS), as WidgetHost builds it for `"target": "BOSS"`. */
const BOSS_WORKFLOWS = "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows";
const BOSS_URL = `${BOSS_WORKFLOWS}?$filter=status = 'PUBLISHED'&$fields=workflowCode,name`;
function bossProvider(bodies: unknown[], extra: Record<string, unknown> = {}, url = BOSS_URL) {
  const vb = fakeVb(bodies);
  const rest = new DashboardRestHelper(vb.helper, { BOSS: "bossConn" });
  const dp = mod.createEndpointDataProvider({
    createEndpoint: (u: string, headers: Record<string, string>) => rest.createEndpoint({ target: "BOSS", url: u, headers }),
    dialect: "boss", url, valueField: "workflowCode", labelField: "name", searchTemplate: { debounceMs: 0 }, ...extra,
  });
  return { hooks: dp.options.restHelper, urls: vb.urls, headers: vb.headers };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ SubinventoryCode: String(12001 + i), Description: `Raw Materials ${i + 1}` }));

describe("urlForms", () => {
  test("the_fixed_q_leaves_the_url_decoded_and_a_url_without_q_has_none", () => {
    expect(mod.urlForms(KRN_URL, "fa")).toEqual({
      url: "/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description", fixedFilter: "OrganizationCode='M1'",
    });
    expect(mod.urlForms("/x/y?limit=5", "fa")).toEqual({ url: "/x/y?limit=5", fixedFilter: null });
    expect(mod.urlForms("/x/y", "fa")).toEqual({ url: "/x/y", fixedFilter: null });
    expect(mod.urlForms("/x?q=", "fa")).toEqual({ url: "/x", fixedFilter: null });
    // An encoded q decodes; a raw % that does not decode stays as written.
    expect(mod.urlForms("/x?q=Name%20LIKE%20'A%25'", "fa").fixedFilter).toBe("Name LIKE 'A%'");
    expect(mod.urlForms("/x?q=Name LIKE '%%'", "fa").fixedFilter).toBe("Name LIKE '%%'");
    // {{...}} is nothing special: it is part of the fixed filter as written.
    expect(mod.urlForms("/x?q=Name='{{query}}'", "fa").fixedFilter).toBe("Name='{{query}}'");
    expect(() => mod.urlForms("/x?q=a=1&q=b=2", "fa")).toThrow("the datasource url has 2 q parameters (one fixed filter at most)");
  });

  test("boss_the_filter_parameter_is_$filter", () => {
    expect(mod.urlForms(BOSS_URL, "boss")).toEqual({ url: `${BOSS_WORKFLOWS}?$fields=workflowCode,name`, fixedFilter: "status = 'PUBLISHED'" });
    // q is just another parameter here.
    expect(mod.urlForms("/x?$filter=status = 'A'&q=z", "boss")).toEqual({ url: "/x?q=z", fixedFilter: "status = 'A'" });
    expect(() => mod.urlForms("/x", "odata")).toThrow('createEndpointDataProvider needs dialect "fa" or "boss"');
  });

  test("the_search_clause_is_a_case_insensitive_contains_on_the_searched_attribute", () => {
    expect(mod.searchClause("fa", "Supplier", "o'neil 50%")).toBe("UPPER(Supplier) LIKE '%O''NEIL 50%%'");
    expect(mod.searchClause("boss", "name", "o'neil")).toBe("name ~LIKE '%o''neil%'");
  });
});

describe("fetchFirst", () => {
  test("typed_text_is_and_ed_to_the_fixed_q_upper_cased_and_the_endpoint_appends_q_limit_offset_encoded", async () => {
    const p = provider([{ items: rows(3), hasMore: false }]);
    const page = await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "Ra" }, size: 25, offset: 0 } });
    expect(p.urls).toEqual([`${BASE}/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description&q=%28OrganizationCode%3D%27M1%27%29+and+UPPER%28Description%29+LIKE+%27%25RA%25%27&limit=25&offset=0`]);
    expect(paramsOf(p.urls[0])).toEqual([["fields", "SubinventoryCode,Description"], ["q", "(OrganizationCode='M1') and UPPER(Description) LIKE '%RA%'"], ["limit", "25"], ["offset", "0"]]);
    expect(page).toEqual({ data: rows(3), hasMore: false });
  });

  test("without_a_fixed_q_the_clause_is_the_whole_q_a_single_quote_doubles_and_every_percent_is_encoded", async () => {
    const p = provider([{ items: [] }], {}, "/fscmRestApi/resources/11.13.18.05/subinventories");
    await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "O'Neil 5%" } } });
    expect(p.urls[0]).toBe(`${BASE}/fscmRestApi/resources/11.13.18.05/subinventories?q=UPPER%28Description%29+LIKE+%27%25O%27%27NEIL+5%25%25%27&limit=25&offset=0`);
    expect(p.urls[0]).not.toMatch(/%(?![0-9A-F]{2})/);
    expect(mod.DEFAULTS).toEqual({ pageSize: 25, minChars: 1, debounceMs: 250 });
  });

  test("searchField_is_the_searched_attribute_when_given", async () => {
    const p = provider([{ items: [] }], { searchField: "SubinventoryCode" });
    await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "120" } } });
    expect(new URL(p.urls[0]).searchParams.get("q")).toBe("(OrganizationCode='M1') and UPPER(SubinventoryCode) LIKE '%120%'");
    expect(p.options.textFilterAttributes).toEqual(["SubinventoryCode"]);
    expect(() => provider([], { searchField: "" })).toThrow("searchField must be a non-empty string");
  });

  test("no_text_fetches_the_page_with_the_fixed_q_only_and_pageSize_from_the_config", async () => {
    const p = provider([{ items: rows(10), hasMore: true, totalResults: 300 }], { pageSize: 10 });
    const page = await p.hooks.fetchFirst({ fetchParameters: { offset: 20 } });
    expect(paramsOf(p.urls[0])).toEqual([["fields", "SubinventoryCode,Description"], ["q", "OrganizationCode='M1'"], ["limit", "10"], ["offset", "20"]]);
    expect(page).toEqual({ data: rows(10), hasMore: true, totalSize: 300 });
    // No fixed q and no text: no q at all (the plain paged list).
    const bare = provider([{ items: [] }], {}, "/fscmRestApi/resources/x");
    await bare.hooks.fetchFirst({ fetchParameters: {} });
    expect(bare.urls).toEqual([`${BASE}/fscmRestApi/resources/x?limit=25&offset=0`]);
  });

  test("totalResults_is_asked_for_when_the_fetch_wants_the_row_count", async () => {
    const p = provider([{ items: [] }]);
    await p.hooks.fetchByOffset({ fetchParameters: { includeFilteredRowCount: "enabled" } });
    expect(p.urls[0]).toContain("&limit=25&offset=0&totalResults=true");
  });

  test("text_shorter_than_minChars_answers_an_empty_page_without_a_request", async () => {
    const p = provider([], { searchTemplate: { minChars: 2, debounceMs: 0 } });
    expect(await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "R" } } })).toEqual({ data: [], hasMore: false });
    expect(p.urls).toEqual([]);
  });

  test("a_text_fetch_superseded_during_the_debounce_is_dropped", async () => {
    const p = provider([{ items: rows(1) }], { searchTemplate: { debounceMs: 20 } });
    const [stale, fresh] = await Promise.all([
      p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "R" } } }),
      p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "Ra" } } }),
    ]);
    expect(stale).toEqual({ data: [], hasMore: false });
    expect(fresh.data).toEqual(rows(1));
    expect(p.urls).toHaveLength(1);
    expect(p.urls[0]).toContain("%27%25RA%25%27");
  });

  test("every_fa_request_carries_rest_framework_version_4_unless_the_datasource_sets_2_or_later", async () => {
    const p = provider([{ items: [] }, { items: [] }], { headers: { "Effective-Of": "x" } });
    await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "a" } } });
    await p.hooks.fetchByKeys({ fetchParameters: { keys: new Set(["k"]) } });
    expect(p.headers).toEqual([{ "Effective-Of": "x", "REST-Framework-Version": "4" }, { "Effective-Of": "x", "REST-Framework-Version": "4" }]);
    expect(mod.FA_FRAMEWORK_VERSION).toBe("4");
    // The datasource's own version (2 or later) is kept as written; a lower one is refused, never overridden.
    expect(mod.requestHeaders("fa", { "rest-framework-version": "6" })).toEqual({ "rest-framework-version": "6" });
    expect(() => mod.requestHeaders("fa", { "REST-Framework-Version": "1" }))
      .toThrow("the datasource header REST-Framework-Version: 1 cannot carry the search filter (Fusion REST expression syntax needs version 2 or later)");
    expect(() => provider([], { headers: { "REST-Framework-Version": "1" } })).toThrow("cannot carry the search filter");
    // BOSS: the datasource's headers as they are.
    expect(mod.requestHeaders("boss", { a: "1" })).toEqual({ a: "1" });
    expect(mod.requestHeaders("boss")).toEqual({});
  });
});

describe("fetchByKeys", () => {
  test("keys_become_an_IN_clause_on_the_url_without_its_q", async () => {
    const p = provider([{ items: rows(2) }]);
    const page = await p.hooks.fetchByKeys({ fetchParameters: { keys: new Set(["12001", "O'K"]) } });
    expect(p.urls).toEqual([`${BASE}/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description&q=SubinventoryCode+IN+%28%2712001%27%2C%27O%27%27K%27%29&limit=2`]);
    expect(page).toEqual({ data: rows(2), hasMore: true });
  });

  test("no_keys_makes_no_request", async () => {
    const p = provider([]);
    expect(await p.hooks.fetchByKeys({ fetchParameters: { keys: new Set() } })).toEqual({ data: [], hasMore: false });
    expect(p.urls).toEqual([]);
  });
});

describe("response mapping", () => {
  test("rows_come_from_the_body_array_or_its_items_or_the_map_path", () => {
    expect(mod.rowsOf([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(mod.rowsOf({ items: [{ a: 1 }], hasMore: false })).toEqual([{ a: 1 }]);
    expect(mod.rowsOf({ data: { rows: [{ a: 2 }] } }, { type: "map", expression: "data.rows" })).toEqual([{ a: 2 }]);
    expect(mod.rowsOf({ list: [[{ a: 3 }]] }, { type: "map", expression: "list.0" })).toEqual([{ a: 3 }]);
    expect(() => mod.rowsOf({ count: 0 })).toThrow("datasource answer is neither an array nor { items: [...] }");
    expect(() => mod.rowsOf({ items: 1 }, { type: "map", expression: "items.x" })).toThrow("no array at items.x");
  });

  test("lodash_is_never_evaluated", () => {
    expect(() => mod.rowsOf({ items: [] }, { type: "lodash", expression: "$data.get('items')" })).toThrow('dataTransform "lodash" is not evaluated by the endpoint data provider (map only)');
  });

  test("hasMore_and_totalSize_come_from_the_envelope_else_from_the_page_fill", () => {
    expect(mod.pageOf({ body: { items: rows(2), hasMore: true, totalResults: 7 } }, undefined, 25)).toEqual({ data: rows(2), hasMore: true, totalSize: 7 });
    expect(mod.pageOf({ body: rows(25) }, undefined, 25)).toEqual({ data: rows(25), hasMore: true });
    expect(mod.pageOf({ body: rows(3) }, undefined, 25)).toEqual({ data: rows(3), hasMore: false });
    expect(mod.quoteForQ("it's")).toBe("it''s");
  });

  test("the_provider_is_keyed_by_valueField_searches_labelField_by_default_and_declares_lookup_and_text_filter", () => {
    const p = provider([]);
    expect(p.options.keyAttributes).toBe("SubinventoryCode");
    expect(p.options.textFilterAttributes).toEqual(["Description"]);
    expect(p.options.capabilities).toEqual({ fetchByKeys: { implementation: "lookup" }, fetchByOffset: { implementation: "randomAccess" }, filter: { textFilter: true } });
  });

  test("required_options_are_checked", () => {
    expect(() => mod.createEndpointDataProvider({ dialect: "fa", url: "/x", valueField: "a", labelField: "b" })).toThrow("needs createEndpoint(url, headers)");
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), dialect: "fa", url: "", valueField: "a", labelField: "b" })).toThrow("needs a url");
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), dialect: "fa", url: "/x", valueField: "", labelField: "b" })).toThrow("needs valueField");
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), dialect: "fa", url: "/x", valueField: "a" })).toThrow("needs labelField");
    // The dialect is required: nothing is assumed about the url's query language.
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), url: "/x", valueField: "a", labelField: "b" })).toThrow('needs dialect "fa" or "boss"');
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), dialect: "BOSS", url: "/x", valueField: "a", labelField: "b" })).toThrow('needs dialect "fa" or "boss"');
  });
});

describe("BOSS dialect", () => {
  const WF = (n: number) => Array.from({ length: n }, (_, i) => ({ workflowCode: `WF_${i + 1}`, name: `Invoice flow ${i + 1}` }));

  test("typed_text_is_and_ed_to_the_fixed_$filter_and_the_provider_writes_$limit_$offset_on_the_url", async () => {
    const p = bossProvider([{ items: WF(2), hasMore: true, count: 2, limit: 25, offset: 0 }]);
    const page = await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "O'Ne" }, size: 25, offset: 0 } });
    expect(p.urls).toEqual([`${BASE}${BOSS_WORKFLOWS}?$fields=workflowCode,name&$filter=(status%20%3D%20'PUBLISHED')%20and%20name%20~LIKE%20'%25O''Ne%25'&$limit=25&$offset=0`]);
    expect(decodeURIComponent(p.urls[0])).toBe(`${BASE}${BOSS_WORKFLOWS}?$fields=workflowCode,name&$filter=(status = 'PUBLISHED') and name ~LIKE '%O''Ne%'&$limit=25&$offset=0`);
    expect(p.urls[0]).not.toMatch(/%(?![0-9A-F]{2})/);
    // BOSS answers {items, hasMore, count, limit, offset}: the rows are items, hasMore is the body's.
    expect(page).toEqual({ data: WF(2), hasMore: true });
    expect(p.headers).toEqual([{}]);
  });

  test("no_text_sends_the_fixed_$filter_alone_and_no_fusion_rest_parameters_or_row_count", async () => {
    const p = bossProvider([{ items: [] }], { pageSize: 10 });
    await p.hooks.fetchByOffset({ fetchParameters: { offset: 30, includeFilteredRowCount: "enabled" } });
    const u = new URL(p.urls[0]);
    expect([...u.searchParams.keys()]).toEqual(["$fields", "$filter", "$limit", "$offset"]);
    expect([u.searchParams.get("$filter"), u.searchParams.get("$limit"), u.searchParams.get("$offset")]).toEqual(["status = 'PUBLISHED'", "10", "30"]);
  });

  test("searchField_and_no_fixed_$filter", async () => {
    const p = bossProvider([{ items: [] }], { searchField: "workflowCode" }, `${BOSS_WORKFLOWS}?$fields=workflowCode,name`);
    await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "inv" } } });
    expect(new URL(p.urls[0]).searchParams.get("$filter")).toBe("workflowCode ~LIKE '%inv%'");
  });

  test("keys_become_an_or_chain_$filter_on_the_url_without_its_$filter_numbers_unquoted", async () => {
    const p = bossProvider([{ items: WF(2), hasMore: false }]);
    const page = await p.hooks.fetchByKeys({ fetchParameters: { keys: new Set<unknown>(["WF_1", "O'K", 42]) } });
    expect(p.urls).toEqual([`${BASE}${BOSS_WORKFLOWS}?$fields=workflowCode,name&$filter=(workflowCode%20%3D%20'WF_1'%20or%20workflowCode%20%3D%20'O''K'%20or%20workflowCode%20%3D%2042)&$limit=3`]);
    expect(page).toEqual({ data: WF(2), hasMore: false });
  });
});
