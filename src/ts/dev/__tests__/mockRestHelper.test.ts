/** @jest-environment node */
import { DEV_MOCK_AUTHORIZATION, MOCK_ENDPOINTS, MockRestHelper } from "../mock-rest-helper";
import type { MockHookHandler } from "../mock-rest-helper";
import { loadAmd } from "../../jet-composites/xxx-gnimsys-data/rest/__tests__/amd";

function fakeFetch(respond: (request: Request) => Response): { fetchImpl: (request: Request) => Promise<Response>; sent: Request[] } {
  const sent: Request[] = [];
  return { sent, fetchImpl: async (request: Request) => { sent.push(request); return respond(request); } };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const headersOf = (r: Request): Record<string, string> => Object.fromEntries(r.headers.entries());

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
  expect(rest.responseBodyFormat("text")).toBe(rest);
  await rest.fetch();
  // The body transform gets the endpoint's URL (not the init url) and its result is the request URL.
  expect(seen).toEqual([{ url: BASE, endpointDefinition: { url: BASE } }]);
  expect(sent.map((s) => s.url)).toEqual([`${BASE}/rewritten`]);
});

test("fetch_returns_response_and_body", async () => {
  const { fetchImpl, sent } = fakeFetch((r) =>
    r.url.endsWith("/text") ? new Response("plain", { status: 200, headers: { "Content-Type": "text/plain" } })
      : r.url.endsWith("/err") ? json({ detail: "boom" }, 500)
        : r.url.endsWith("/empty") ? new Response(null, { status: 204, headers: { "Content-Type": "application/json" } })
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
  expect(sent[0].method).toBe("PATCH");
  expect(await sent[0].text()).toBe('{"a":1}');
  expect(headersOf(sent[0])).toEqual({ "if-match": '"1"', "content-type": "application/json", authorization: DEV_MOCK_AUTHORIZATION });

  const text = await call("/text", { method: "GET", headers: {} });
  expect(text.body).toBe("plain");
  expect(sent[1].body).toBeNull();

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

test("the_mock_owns_authorization_and_passes_the_signal", async () => {
  const { fetchImpl, sent } = fakeFetch(() => json({}));
  const helper = new MockRestHelper({ serviceConnections: { mockFA: BASE }, fetchImpl });
  const ac = new AbortController();
  await helper.get("mockFA").initConfiguration({ method: "GET", headers: { Authorization: "Bearer caller" }, url: "", signal: ac.signal }).fetch();
  expect(sent[0].headers.get("authorization")).toBe("Bearer dev-mock");
  expect(DEV_MOCK_AUTHORIZATION).toBe("Bearer dev-mock");
  ac.abort();
  expect(sent[0].signal.aborted).toBe(true);
});

test("hook_handler_runs_in_vb_order_and_vb_reads_what_the_response_hook_returned", async () => {
  const native = json({ detail: "denied" }, 401);
  const { fetchImpl } = fakeFetch(() => native);
  const helper = new MockRestHelper({ serviceConnections: { mockFUAI: BASE }, fetchImpl });
  const calls: string[] = [];
  const handler: MockHookHandler = {
    handlePreFetchHook: () => { calls.push("pre"); return undefined; },
    handleRequestHook: (r) => { calls.push("request " + r.method); return r; },
    handleResponseHook: (r) => { calls.push("response " + r.status); return new Response("", { status: r.status, headers: r.headers }); },
    handlePostFetchHook: () => { calls.push("post"); return undefined; },
    handlePostFetchErrorHook: () => { calls.push("postError"); return undefined; },
  };
  const result = await helper.get("mockFUAI").initConfiguration({ method: "POST", headers: {}, body: "{}", url: "" }).hookHandler(handler)
    .responseBodyFormat("text").fetch();
  expect(calls).toEqual(["pre", "request POST", "response 401", "postError"]);
  // The stand-in was read; the native response is untouched.
  expect(result.response).not.toBe(native);
  expect(result.body).toBe("");
  expect(native.bodyUsed).toBe(false);
  expect(await native.json()).toEqual({ detail: "denied" });
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
  expect(sent[0].headers.get("authorization")).toBe(DEV_MOCK_AUTHORIZATION);
});

test("the_vb_stream_provider_streams_through_the_mock", async () => {
  type Provider = {
    createVbStreamFetch(rh: unknown): (id: string, req: { url: string; method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;
    supportsVbStreamFetch(rh: unknown, id: string): boolean;
  };
  const { createVbStreamFetch, supportsVbStreamFetch } = loadAmd("xxx-gnimsys-data/rest/vb-stream-fetch") as Provider;
  const enc = new TextEncoder();
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const native = new Response(new ReadableStream<Uint8Array>({ start(c) { ctl = c; } }), { headers: { "Content-Type": "text/event-stream" } });
  const { fetchImpl, sent } = fakeFetch(() => native);
  const helper = new MockRestHelper({ serviceConnections: { mockFUAI: BASE + "/" }, fetchImpl });
  expect(supportsVbStreamFetch(helper, "mockFUAI")).toBe(true);
  ctl?.enqueue(enc.encode("data: 1\n\n"));
  const res = await createVbStreamFetch(helper)("mockFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: { Accept: "text/event-stream" }, body: "{}" });
  expect(res).toBe(native);
  expect(sent.map((s) => s.url)).toEqual([`${BASE}/api/fusion-ai/x/chat`]);
  expect(sent[0].headers.get("accept")).toBe("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n");
  ctl?.close();
  expect((await reader.read()).done).toBe(true);
});
