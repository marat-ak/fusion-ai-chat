/** @jest-environment node */
// The select datasource's wire on the debugger's REAL endpoint path: the endpoint data provider over EndpointFetch over
// the data pack's DashboardRestHelper over the pod-proxy rest helper, as WidgetHost and debugRun.ts compose them; only
// the network (fetchImpl) is fake. What is asserted is the Request the page sends to the engine's proxy, which forwards
// the query string verbatim to the pod (gnimsys-agent-core podProxy.ts parseRoute / forward).
import { loadAmd, stubAmd } from "../../jet-composites/xxx-gnimsys-data/rest/__tests__/amd";
import { EndpointFetch } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/endpoints/EndpointFetch";
import type { EndpointName } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/endpoints/EndpointFetch";
import type { DashboardRestHelper } from "../../jet-composites/xxx-gnimsys-data/rest/index";
import { POD_PROXY_ENDPOINTS, PodProxyRestHelper } from "../podProxyRestHelper";

type Page = { data: unknown[]; hasMore: boolean };
type Hooks = {
  fetchFirst: (o: { fetchParameters: { filterCriterion?: { text: string }; offset?: number } }) => Promise<Page>;
  fetchByKeys: (o: { fetchParameters: { keys: Set<unknown> } }) => Promise<Page>;
};
stubAmd("ojs/ojrestdataprovider", { RESTDataProvider: class { options: unknown; constructor(o: unknown) { this.options = o; } } });
const Provider = loadAmd("xxx-gnimsys-data/rest/endpoint-data-provider") as {
  createEndpointDataProvider(o: Record<string, unknown>): { options: { restHelper: Hooks } };
};
const DashboardRestHelperClass = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as new (rh: unknown, endpoints: Record<string, string>) => DashboardRestHelper;

const O = "https://agents.example.com";
const POD = "/api/pod/c/u1__dev1/";

/** The datasource as an agent writes it (fixed filters only) through the page's real layers; the requests sent. */
function wire(target: EndpointName, url: string, fields: Record<string, unknown>, headers?: Record<string, string>) {
  const sent: Request[] = [];
  const proxy = new PodProxyRestHelper({
    pod: POD, label: "dev1", origin: O,
    fetchImpl: async (r) => { sent.push(r); return new Response(JSON.stringify({ items: [], hasMore: false }), { status: 200, headers: { "Content-Type": "application/json" } }); },
  });
  const endpoints = new EndpointFetch({ helper: new DashboardRestHelperClass(proxy, POD_PROXY_ENDPOINTS) });
  const dp = Provider.createEndpointDataProvider({
    createEndpoint: (u: string, h: Record<string, string>) => endpoints.endpoint(target, u, h),
    dialect: target === "BOSS" ? "boss" : "fa", url, ...(headers !== undefined && { headers }), searchTemplate: { debounceMs: 0 }, ...fields,
  });
  return { hooks: dp.options.restHelper, sent };
}

/** The raw query string as it leaves the page (what the proxy forwards to the pod). */
const rawQuery = (r: Request): string => r.url.slice(r.url.indexOf("?") + 1);
/** A `%` that does not start a percent-escape (the defect of the recorded 2026-10-29 wire). */
const RAW_PERCENT = /%(?![0-9A-Fa-f]{2})/;

test("fa_search_reaches_the_proxy_with_every_percent_encoded_the_fixed_q_and_ed_and_rest_framework_version_4", async () => {
  // The shape of the AP supplier pick: a fixed q with its own LIKE (a literal % written %25 in the url) and a typed text
  // with a quote and a percent sign.
  const { hooks, sent } = wire("FA", "/fscmRestApi/resources/11.13.18.05/suppliers?q=Status='ACTIVE' and Supplier LIKE 'A%25'&fields=SupplierId,Supplier",
    { valueField: "SupplierId", labelField: "Supplier", searchField: "Supplier" });
  await hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "o'neil 5%" } } });
  await hooks.fetchFirst({ fetchParameters: {} });
  await hooks.fetchByKeys({ fetchParameters: { keys: new Set(["300000047"]) } });
  expect(sent.map((r) => r.url.slice(0, r.url.indexOf("?")))).toEqual(Array(3).fill(`${O}${POD}FA/fscmRestApi/resources/11.13.18.05/suppliers`));
  expect(rawQuery(sent[0])).toBe("fields=SupplierId,Supplier&q=%28Status%3D%27ACTIVE%27+and+Supplier+LIKE+%27A%25%27%29+and+UPPER%28Supplier%29+LIKE+%27%25O%27%27NEIL+5%25%25%27&limit=25&offset=0");
  for (const r of sent) expect([r.url, RAW_PERCENT.test(rawQuery(r))]).toEqual([r.url, false]);
  const q = sent.map((r) => new URL(r.url).searchParams.get("q"));
  expect(q).toEqual([
    "(Status='ACTIVE' and Supplier LIKE 'A%') and UPPER(Supplier) LIKE '%O''NEIL 5%%'",
    "Status='ACTIVE' and Supplier LIKE 'A%'",
    "SupplierId IN ('300000047')",
  ]);
  // Every FA call carries the framework version the expression syntax needs (and the proxy forwards it).
  for (const r of sent) expect([r.headers.get("rest-framework-version"), r.headers.get("x-gnimsys-pod-proxy")]).toEqual(["4", "1"]);
});

test("fa_a_datasource_version_of_its_own_is_kept", async () => {
  const { hooks, sent } = wire("FA", "/fscmRestApi/resources/11.13.18.05/suppliers", { valueField: "SupplierId", labelField: "Supplier" },
    { "REST-Framework-Version": "6" });
  await hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "acme" } } });
  expect(new URL(sent[0].url).searchParams.get("q")).toBe("UPPER(Supplier) LIKE '%ACME%'");
  expect(sent[0].headers.get("rest-framework-version")).toBe("6");
});

test("boss_search_reaches_the_proxy_with_every_percent_encoded_and_no_framework_header", async () => {
  const { hooks, sent } = wire("BOSS", "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$filter=status = 'PUBLISHED'&$fields=workflowCode,name",
    { valueField: "workflowCode", labelField: "name" });
  await hooks.fetchFirst({ fetchParameters: { filterCriterion: { text: "50% o'k" } } });
  // (The URL parser of the Request percent-encodes the quotes encodeURIComponent leaves: ' -> %27 in an https query.)
  expect(rawQuery(sent[0])).toBe("$fields=workflowCode,name&$filter=(status%20%3D%20%27PUBLISHED%27)%20and%20name%20~LIKE%20%27%2550%25%20o%27%27k%25%27&$limit=25&$offset=0");
  expect(RAW_PERCENT.test(rawQuery(sent[0]))).toBe(false);
  expect(new URL(sent[0].url).searchParams.get("$filter")).toBe("(status = 'PUBLISHED') and name ~LIKE '%50% o''k%'");
  expect(sent[0].headers.get("rest-framework-version")).toBeNull();
});
