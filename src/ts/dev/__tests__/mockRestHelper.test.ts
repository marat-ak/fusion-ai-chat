/** @jest-environment node */
import { DEV_MOCK_AUTHORIZATION, MOCK_ENDPOINTS, MockRestHelper } from "../mock-rest-helper";
import { loadAmd } from "../../jet-composites/xxx-gnimsys-data/rest/__tests__/amd";

type Sent = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string) => Response): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return respond(url);
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const BASE = "http://localhost:8000";

test("endpoint_map_has_the_six_contract_names", () => {
  expect(MOCK_ENDPOINTS).toEqual({
    FA: "mockFA", FUAI: "mockFUAI", BOSS: "mockBOSS", SAASBATCH: "mockSAASBATCH", KM: "mockKM", SALESCOMMON: "mockSALESCOMMON",
  });
});

test("get_returns_vb_like_chain", async () => {
  const { fetchImpl, sent } = fakeFetch(() => json({}));
  const helper = new MockRestHelper({ serviceConnections: { mockBOSS: BASE }, fetchImpl });
  const rest = helper.get("mockBOSS");
  const init = { method: "GET", headers: {}, url: "/api/boss/x" };
  const seen: Array<{ url: string; endpointDefinition: { url: string } }> = [];
  // Like VB: every configuration method returns the same chain.
  expect(rest.initConfiguration(init)).toBe(rest);
  expect(rest.requestTransformationFunctions({
    body: (c) => { seen.push({ url: c.url, endpointDefinition: { ...c.endpointDefinition } }); c.url = c.url + "/rewritten"; return c; },
  })).toBe(rest);
  await rest.fetch();
  // The body transform gets the endpoint's URL (not the init url) and its result is the request URL.
  expect(seen).toEqual([{ url: BASE, endpointDefinition: { url: BASE } }]);
  expect(sent.map((s) => s.url)).toEqual([`${BASE}/rewritten`]);
});

test("fetch_returns_response_and_body", async () => {
  const { fetchImpl, sent } = fakeFetch((url) =>
    url.endsWith("/text") ? new Response("plain", { status: 200, headers: { "Content-Type": "text/plain" } })
      : url.endsWith("/err") ? json({ detail: "boom" }, 500)
        : url.endsWith("/empty") ? new Response(null, { status: 204, headers: { "Content-Type": "application/json" } })
          : json({ items: [1] }, 200, { ETag: '"1"' }));
  const helper = new MockRestHelper({ serviceConnections: { mockFA: BASE }, fetchImpl });
  const call = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
    helper.get("mockFA").initConfiguration({ ...init, url }).requestTransformationFunctions({
      body: (c) => { c.url = c.url + url; return c; },
    }).fetch();

  const ok = await call("/ok", { method: "PATCH", headers: { "If-Match": '"1"', "Content-Type": "application/json" }, body: '{"a":1}' });
  expect(ok.response.status).toBe(200);
  expect(ok.response.headers.get("ETag")).toBe('"1"');
  expect(ok.body).toEqual({ items: [1] });
  expect(sent[0].init.method).toBe("PATCH");
  expect(sent[0].init.body).toBe('{"a":1}');
  expect(sent[0].init.headers).toEqual({ "If-Match": '"1"', "Content-Type": "application/json", Authorization: DEV_MOCK_AUTHORIZATION });

  const text = await call("/text", { method: "GET", headers: {} });
  expect(text.body).toBe("plain");
  expect("body" in sent[1].init).toBe(false);

  // Like VB, an HTTP error resolves (the status is the caller's to check) with the body read.
  const err = await call("/err", { method: "GET", headers: {} });
  expect(err.response.status).toBe(500);
  expect(err.body).toEqual({ detail: "boom" });

  const empty = await call("/empty", { method: "DELETE", headers: {} });
  expect(empty.response.status).toBe(204);
  expect(empty.body).toBe("");
  // The response is consumed, as VB's is.
  expect(ok.response.bodyUsed).toBe(true);
});

test("the_mock_owns_authorization", async () => {
  const { fetchImpl, sent } = fakeFetch(() => json({}));
  const helper = new MockRestHelper({ serviceConnections: { mockFA: BASE }, fetchImpl });
  await helper.get("mockFA").initConfiguration({ method: "GET", headers: { Authorization: "Bearer caller" }, url: "" }).fetch();
  expect((sent[0].init.headers as Record<string, string>).Authorization).toBe("Bearer dev-mock");
  expect(DEV_MOCK_AUTHORIZATION).toBe("Bearer dev-mock");
});

test("unknown_service_connection_rejects", async () => {
  const { fetchImpl, sent } = fakeFetch(() => json({}));
  const helper = new MockRestHelper({ serviceConnections: { mockFA: BASE }, fetchImpl });
  await expect(helper.get("nope").initConfiguration({ method: "GET", headers: {}, url: "/x" }).fetch())
    .rejects.toThrow("mock rest helper: unknown service connection nope");
  expect(sent).toEqual([]);
});

test("fetch_without_initConfiguration_rejects", async () => {
  const { fetchImpl } = fakeFetch(() => json({}));
  const helper = new MockRestHelper({ serviceConnections: { mockFA: BASE }, fetchImpl });
  await expect(helper.get("mockFA").fetch()).rejects.toThrow("mock rest helper: fetch() before initConfiguration()");
});

test("dashboard_rest_helper_over_the_mock", async () => {
  type Drh = new (rh: unknown, endpoints: Record<string, string>) => { createEndpoint(c: object): { fetch(o?: object): Promise<{ body: unknown }> } };
  const DashboardRestHelper = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as Drh;
  const { fetchImpl, sent } = fakeFetch(() => json({ ok: true }));
  const helper = new MockRestHelper({ serviceConnections: { mockBOSS: BASE }, fetchImpl });
  const r = await new DashboardRestHelper(helper, MOCK_ENDPOINTS).createEndpoint({ target: "BOSS", url: "/api/boss/data/x?$fields=id" }).fetch();
  expect(r.body).toEqual({ ok: true });
  expect(sent.map((s) => s.url)).toEqual([`${BASE}/api/boss/data/x?$fields=id`]);
  expect((sent[0].init.headers as Record<string, string>).Authorization).toBe(DEV_MOCK_AUTHORIZATION);
});

test("streamFetch_returns_the_unconsumed_response", async () => {
  const res = new Response("data: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
  const { fetchImpl, sent } = fakeFetch(() => res);
  const helper = new MockRestHelper({ serviceConnections: { mockFUAI: BASE + "/" }, fetchImpl });
  const ac = new AbortController();
  const r = await helper.streamFetch("mockFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: { Accept: "text/event-stream" }, body: "{}", signal: ac.signal });
  expect(r).toBe(res);
  expect(r.bodyUsed).toBe(false);
  expect(sent).toEqual([{
    url: `${BASE}/api/fusion-ai/x/chat`,
    init: { method: "POST", headers: { Accept: "text/event-stream", Authorization: DEV_MOCK_AUTHORIZATION }, body: "{}", signal: ac.signal },
  }]);
});

test("streamFetch_resolves_urls_like_dashboard_rest_helper_and_rejects_unknown_ids", async () => {
  const { fetchImpl, sent } = fakeFetch(() => new Response(""));
  const helper = new MockRestHelper({ serviceConnections: { mockFUAI: BASE }, fetchImpl });
  await helper.streamFetch("mockFUAI", { url: "api/fusion-ai/a", method: "GET", headers: {} });
  await helper.streamFetch("mockFUAI", { url: "https://other.example.com/b", method: "GET", headers: {} });
  expect(sent.map((s) => s.url)).toEqual([`${BASE}/api/fusion-ai/a`, "https://other.example.com/b"]);
  expect("body" in sent[0].init).toBe(false);
  await expect(helper.streamFetch("nope", { url: "/x", method: "GET", headers: {} })).rejects.toThrow("mock rest helper: unknown service connection nope");
  expect(sent).toHaveLength(2);
});
