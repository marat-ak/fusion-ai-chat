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
  urlForms(url: string): { page: string; keys: string; qTemplate: string | null };
  rowsOf(body: unknown, t?: { type: string; expression: string }): unknown[];
  pageOf(result: { body: unknown }, t: { type: string; expression: string } | undefined, limit: number): Page;
  quoteForQ(t: unknown): string;
  DEFAULTS: { pageSize: number; minChars: number; debounceMs: number };
};
const mod = loadAmd("xxx-gnimsys-data/rest/endpoint-data-provider") as Mod;
const DashboardRestHelper = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as new (h: unknown, m: Record<string, string>) => { createEndpoint(c: object): { fetch(o?: object): Promise<unknown> } };

const BASE = "https://pod.example.com/fa";
const KRN_URL = "/fscmRestApi/resources/11.13.18.05/subinventories?q=Description LIKE '{{query}}%'&fields=SubinventoryCode,Description";

/** A fake VB RestHelper: records every final request url, answers the queued bodies. */
function fakeVb(bodies: unknown[]) {
  const urls: string[] = [];
  const queue = [...bodies];
  const helper = {
    get() {
      let fns: { body: (c: { url: string; endpointDefinition: { url: string } }) => { url: string } } | undefined;
      const chain = {
        initConfiguration() { return chain; },
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
  return { helper, urls };
}

function provider(bodies: unknown[], extra: Record<string, unknown> = {}, url = KRN_URL) {
  const vb = fakeVb(bodies);
  const rest = new DashboardRestHelper(vb.helper, { FA: "faConn" });
  const dp = mod.createEndpointDataProvider({
    createEndpoint: (u: string) => rest.createEndpoint({ target: "FA", url: u }),
    url, valueField: "SubinventoryCode", labelField: "Description", searchTemplate: { debounceMs: 0 }, ...extra,
  });
  return { hooks: dp.options.restHelper, options: dp.options, urls: vb.urls };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ SubinventoryCode: String(12001 + i), Description: `Raw Materials ${i + 1}` }));

describe("urlForms", () => {
  test("the_q_parameter_carrying_the_placeholder_leaves_the_page_url_and_fetchByKeys_drops_any_q", () => {
    expect(mod.urlForms(KRN_URL)).toEqual({
      page: "/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description",
      keys: "/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description",
      qTemplate: "Description LIKE '{{query}}%'",
    });
    // No placeholder: the url's own q stays for pages (no server search), fetchByKeys still replaces it.
    expect(mod.urlForms("/x/y?q=Status='ACTIVE'&limit=5")).toEqual({ page: "/x/y?q=Status='ACTIVE'&limit=5", keys: "/x/y?limit=5", qTemplate: null });
    expect(mod.urlForms("/x/y")).toEqual({ page: "/x/y", keys: "/x/y", qTemplate: null });
    // A placeholder outside q is substituted in place on pages and blanked for keys.
    expect(mod.urlForms("/x/{{query}}/y?a=1")).toEqual({ page: "/x/{{query}}/y?a=1", keys: "/x//y?a=1", qTemplate: null });
    // An encoded q template decodes.
    expect(mod.urlForms("/x?q=Description%20LIKE%20'{{query}}%25'").qTemplate).toBe("Description LIKE '{{query}}%'");
  });
});

describe("fetchFirst", () => {
  test("typed_text_goes_into_the_q_clause_quoted_and_the_endpoint_appends_q_limit_offset", async () => {
    const p = provider([{ items: rows(3), hasMore: false }]);
    const page = await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "Ra" }, size: 25, offset: 0 } });
    expect(p.urls).toEqual([`${BASE}/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description&q=Description+LIKE+%27Ra%25%27&limit=25&offset=0`]);
    expect(page).toEqual({ data: rows(3), hasMore: false });
  });

  test("a_single_quote_in_the_text_doubles_and_the_default_page_size_is_25", async () => {
    const p = provider([{ items: [] }]);
    await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "O'Neil" } } });
    expect(p.urls[0]).toContain("q=Description+LIKE+%27O%27%27Neil%25%27&limit=25&offset=0");
    expect(mod.DEFAULTS).toEqual({ pageSize: 25, minChars: 1, debounceMs: 250 });
  });

  test("no_text_fetches_the_first_page_with_an_empty_query_and_pageSize_from_the_config", async () => {
    const p = provider([{ items: rows(10), hasMore: true, totalResults: 300 }], { pageSize: 10 });
    const page = await p.hooks.fetchFirst({ fetchParameters: { offset: 20 } });
    expect(p.urls[0]).toContain("q=Description+LIKE+%27%25%27&limit=10&offset=20");
    expect(page).toEqual({ data: rows(10), hasMore: true, totalSize: 300 });
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
    expect(p.urls[0]).toContain("%27Ra%25%27");
  });

  test("a_url_without_a_placeholder_is_paged_with_its_own_q_kept_and_no_search", async () => {
    const p = provider([rows(25)], {}, "/fscmRestApi/resources/x?q=Status='A'");
    const page = await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "zz" }, size: 25 } });
    expect(p.urls).toEqual([`${BASE}/fscmRestApi/resources/x?q=Status='A'&limit=25&offset=0`]);
    expect(page).toEqual({ data: rows(25), hasMore: true }); // a full page with no hasMore in the body
  });

  test("a_placeholder_outside_q_is_substituted_url_encoded", async () => {
    const p = provider([[]], {}, "/fscmRestApi/resources/orgs/{{query}}/subinventories");
    await p.hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "a b'c" } } });
    expect(p.urls[0]).toBe(`${BASE}/fscmRestApi/resources/orgs/a%20b''c/subinventories?limit=25&offset=0`);
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

  test("the_provider_is_keyed_by_valueField_filters_by_labelField_and_declares_lookup_and_text_filter", () => {
    const p = provider([]);
    expect(p.options.keyAttributes).toBe("SubinventoryCode");
    expect(p.options.textFilterAttributes).toEqual(["Description"]);
    expect(p.options.capabilities).toEqual({ fetchByKeys: { implementation: "lookup" }, fetchByOffset: { implementation: "randomAccess" }, filter: { textFilter: true } });
  });

  test("required_options_are_checked", () => {
    expect(() => mod.createEndpointDataProvider({ url: "/x", valueField: "a", labelField: "b" })).toThrow("needs createEndpoint(url)");
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), url: "", valueField: "a", labelField: "b" })).toThrow("needs a url");
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), url: "/x", valueField: "", labelField: "b" })).toThrow("needs valueField");
    expect(() => mod.createEndpointDataProvider({ createEndpoint: () => ({}), url: "/x", valueField: "a" })).toThrow("needs labelField");
  });
});
