/** @jest-environment node */
import { loadAmd } from "../../jet-composites/xxx-gnimsys-data/rest/__tests__/amd";
import { EndpointError, EndpointFetch, ENDPOINT_NAMES, streamFetchOf } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/endpoints/EndpointFetch";
import type { VbStreamProvider } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/endpoints/EndpointFetch";
import type { DashboardRestHelper } from "../../jet-composites/xxx-gnimsys-data/rest/index";
import { bodyTextOf } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/errors";
import { errorText } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/transport/errorText";
import {
  listPodInstances, PodInstancesError, POD_PROXY_ENDPOINTS, POD_PROXY_ERROR_HEADER, POD_PROXY_HEADER, PodProxyRestHelper, proxyStateText,
} from "../podProxyRestHelper";

const O = "https://agents.example.com";
const P = `${O}/api/pod/dev1`;
const LABEL = "Dev 1";

type Drh = new (rh: unknown, endpoints: Record<string, string>) => DashboardRestHelper;
const DashboardRestHelperClass = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as Drh;
/** The data pack's VB stream provider: the chat streams through any VB-like helper with it (main's streaming design). */
const VbStream = loadAmd("xxx-gnimsys-data/rest/vb-stream-fetch") as VbStreamProvider;

function fakeFetch(respond: (request: Request) => Response): { fetchImpl: (request: Request) => Promise<Response>; sent: Request[] } {
  const sent: Request[] = [];
  return { fetchImpl: async (request: Request) => { sent.push(request); return respond(request); }, sent };
}
const headersOf = (r: Request): Record<string, string> => Object.fromEntries(r.headers.entries());
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
/** An answer of the proxy itself. */
const proxyState = (status: number, body: Record<string, unknown>) => json(body, status, { [POD_PROXY_ERROR_HEADER]: String(body.state) });
const helperWith = (respond: (request: Request) => Response) => {
  const { fetchImpl, sent } = fakeFetch(respond);
  return { helper: new PodProxyRestHelper({ instance: "dev1", label: LABEL, origin: O, fetchImpl }), sent };
};
const get = (helper: PodProxyRestHelper, target: string, path: string, headers: Record<string, string> = {}) =>
  helper.get(target).initConfiguration({ method: "GET", headers, url: "" })
    .requestTransformationFunctions({ body: (c) => { c.url = c.url + path; return c; } }).fetch();
const stream = (helper: PodProxyRestHelper, target: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}) =>
  VbStream.createVbStreamFetch(helper)(target, { url: path, method: init.method ?? "GET", headers: init.headers ?? {}, ...(init.body !== undefined && { body: init.body }), ...(init.signal !== undefined && { signal: init.signal }) });

test("endpoint_map_names_every_contract_endpoint_by_itself", () => {
  expect(POD_PROXY_ENDPOINTS).toEqual(Object.fromEntries(ENDPOINT_NAMES.map((n) => [n, n])));
});

test("instance_label_and_origin_are_required", () => {
  for (const instance of ["", "my pod", "a/b", ".", "..", "dev%31"]) {
    expect(() => new PodProxyRestHelper({ instance, label: LABEL, origin: O })).toThrow("instance must be a proxy instance name");
  }
  expect(() => new PodProxyRestHelper({ instance: "dev1", label: " ", origin: O })).toThrow("instance label required");
  expect(() => new PodProxyRestHelper({ instance: "dev1", label: LABEL, origin: "" })).toThrow("origin required");
  expect(() => new PodProxyRestHelper({ instance: "dev1", label: LABEL, origin: O + "/" })).toThrow("origin required");
  expect(new PodProxyRestHelper({ instance: "dev-1.eu_2", label: LABEL, origin: O }).baseUrl("FA")).toBe(`${O}/api/pod/dev-1.eu_2/FA`);
});

test("vb_chain_sends_through_the_proxy_with_the_csrf_header_same_origin", async () => {
  const { helper, sent } = helperWith(() => json({ items: [1] }, 200, { ETag: '"1"' }));
  const rest = helper.get("BOSS");
  const seen: string[] = [];
  expect(rest.initConfiguration({ method: "PATCH", headers: { "If-Match": '"1"', "Content-Type": "application/json" }, body: '{"a":1}', url: "/x" })).toBe(rest);
  expect(rest.requestTransformationFunctions({ body: (c) => { seen.push(c.url, c.endpointDefinition.url); c.url = c.url + "/api/boss/data/x"; return c; } })).toBe(rest);
  const r = await rest.fetch();
  // VB semantics: the transform gets the endpoint's URL; fetch() resolves the response with its body read.
  expect(seen).toEqual([`${P}/BOSS`, `${P}/BOSS`]);
  expect(r.body).toEqual({ items: [1] });
  expect(r.response.headers.get("ETag")).toBe('"1"');
  expect(sent).toHaveLength(1);
  expect([sent[0].url, sent[0].method, sent[0].credentials, await sent[0].text()]).toEqual([`${P}/BOSS/api/boss/data/x`, "PATCH", "same-origin", '{"a":1}']);
  expect(headersOf(sent[0])).toEqual({ "if-match": '"1"', "content-type": "application/json", "x-gnimsys-pod-proxy": "1" });
});

test("vb_hooks_run_in_rest_js_order", async () => {
  const { helper } = helperWith(() => json({ ok: true }));
  const order: string[] = [];
  await helper.get("BOSS").initConfiguration({ method: "GET", headers: {}, url: "" })
    .requestTransformationFunctions({ body: (c) => { order.push("transform"); c.url += "/api/boss/x"; return c; } })
    .hookHandler({
      handlePreFetchHook: () => { order.push("pre"); return undefined; },
      handleRequestHook: (q) => { order.push("request " + q.headers.get(POD_PROXY_HEADER)); return q; },
      handleResponseHook: (r) => { order.push("response " + r.status); return r; },
      handlePostFetchHook: (x) => { order.push("post " + JSON.stringify(x.body)); return undefined; },
      handlePostFetchErrorHook: () => { order.push("post-error"); return undefined; },
    }).fetch();
  expect(order).toEqual(["pre", "transform", "request 1", "response 200", 'post {"ok":true}']);
});

test("dashboard_rest_helper_over_the_proxy_helper", async () => {
  const { helper, sent } = helperWith(() => json({ ok: true }));
  const r = await new DashboardRestHelperClass(helper, POD_PROXY_ENDPOINTS).createEndpoint({ target: "BOSS", url: "/api/boss/data/x?$fields=id" }).fetch();
  expect(r.body).toEqual({ ok: true });
  expect(sent.map((s) => s.url)).toEqual([`${P}/BOSS/api/boss/data/x?$fields=id`]);
});

test("the_vb_stream_provider_streams_through_it_unbuffered", async () => {
  expect(VbStream.supportsVbStreamFetch(new PodProxyRestHelper({ instance: "dev1", label: LABEL, origin: O }), "FUAI")).toBe(true);
  const enc = new TextEncoder();
  let push: ((s: string) => void) | undefined;
  let close: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({ start(c) { push = (s) => c.enqueue(enc.encode(s)); close = () => c.close(); } });
  const native = new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  const { helper, sent } = helperWith(() => native);
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream", "X-Ora-Ai-Api-V2-Check": "c", "X-Ora-Ai-Api-V2-Timestamp": "1" };
  const r = await stream(helper, "FUAI", "/api/fusion-ai/orchestrator/agent/v2/WF/debug", { method: "POST", headers, body: "{}" });
  // The provider hands back the native response itself, unconsumed: frames arrive as the proxy sends them.
  expect(r).toBe(native);
  expect(r.bodyUsed).toBe(false);
  const reader = (r.body as ReadableStream<Uint8Array>).getReader();
  push?.("data: 1\n\n");
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n");
  push?.("data: 2\n\n");
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 2\n\n");
  close?.();
  expect((await reader.read()).done).toBe(true);
  expect(sent[0].url).toBe(`${P}/FUAI/api/fusion-ai/orchestrator/agent/v2/WF/debug`);
  expect(headersOf(sent[0])).toEqual({
    "content-type": "application/json", accept: "text/event-stream", "x-ora-ai-api-v2-check": "c", "x-ora-ai-api-v2-timestamp": "1", "x-gnimsys-pod-proxy": "1",
  });
});

test("an_abort_reaches_the_proxy_request", async () => {
  const { helper, sent } = helperWith(() => new Response(new ReadableStream(), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  const ac = new AbortController();
  await stream(helper, "FUAI", "/api/fusion-ai/x", { signal: ac.signal });
  ac.abort();
  expect(sent[0].signal.aborted).toBe(true);
});

test("headers_the_proxy_would_drop_are_refused_before_sending", async () => {
  const { helper, sent } = helperWith(() => json({}));
  await expect(stream(helper, "BOSS", "/api/boss/x", { headers: { Authorization: "Bearer x" } })).rejects.toThrow("the pod proxy does not forward Authorization");
  await expect(get(helper, "BOSS", "/api/boss/x", { "X-Custom": "1", Accept: "application/json" })).rejects.toThrow("does not forward X-Custom");
  expect(sent).toEqual([]);
  const ok = { "content-type": "a", ACCEPT: "b", "Accept-Language": "c", "If-Match": "d", "REST-Framework-Version": "e", "Effective-Of": "f", "x-ora-ai-api-v2-check-version": "g" };
  await stream(helper, "BOSS", "/api/boss/x", { headers: ok });
  expect(sent).toHaveLength(1);
});

describe("prefix refusal mirrors the endpoint layer (nothing is sent)", () => {
  const outside: Array<[string, string]> = [
    ["FA", "/api/boss/x"], ["FUAI", "/fscmRestApi/resources/x"], ["BOSS", "/api/fusion-ai/x"], ["SAASBATCH", "/api/boss/x"],
    ["KM", "/api/sales-common/x"], ["SALESCOMMON", "/api/knowledge-management/x"],
    ["BOSS", "/api/boss/"], ["BOSS", "/api/boss/../../fscmRestApi/x"], ["BOSS", "/api/boss/./x"], ["BOSS", "//evil.example.com/api/boss/x"],
    ["BOSS", "/api/boss\\x"],
  ];
  test.each(outside)("%s %s", async (target, path) => {
    const { helper, sent } = helperWith(() => json({}));
    await expect(stream(helper, target, path)).rejects.toThrow(`pod proxy rest helper: ${target} refuses`);
    await expect(get(helper, target, path)).rejects.toThrow("refuses");
    expect(sent).toEqual([]);
  });
  test("every_target_accepts_its_own_prefixes", async () => {
    const { helper, sent } = helperWith(() => json({}));
    const ok: Array<[string, string]> = [
      ["FA", "/fscmRestApi/x"], ["FA", "/hcmRestApi/x"], ["FA", "/crmRestApi/x"], ["FA", "/applcoreApi/v1/x"], ["FA", "/xmlpserver/x"],
      ["FUAI", "/api/fusion-ai/x"], ["BOSS", "/api/boss/x"], ["SAASBATCH", "/api/saas-batch/x"], ["KM", "/api/knowledge-management/x"],
      ["KM", "/api/ci/x"], ["SALESCOMMON", "/api/sales-common/x?q=1"],
    ];
    for (const [t, p] of ok) await stream(helper, t, p);
    expect(sent).toHaveLength(ok.length);
  });
  test("other_hosts_instances_and_targets_are_refused", async () => {
    const { helper, sent } = helperWith(() => json({}));
    for (const url of ["https://pod.example.com/api/boss/x", `${O}/api/pod/dev2/BOSS/api/boss/x`, `${P}/FA/api/boss/x`]) {
      await expect(stream(helper, "BOSS", url)).rejects.toThrow("refuses");
    }
    await expect(get(helper, "boss", "/api/boss/x")).rejects.toThrow("unknown endpoint boss");
    await expect(get(helper, "mockBOSS", "/api/boss/x")).rejects.toThrow("unknown endpoint mockBOSS");
    expect(sent).toEqual([]);
  });
});

describe("proxy states get a readable detail; pod answers pass untouched", () => {
  test("auth_required_names_where_to_sign_in", async () => {
    const { helper } = helperWith(() => proxyState(401, { state: "auth-required", message: "no sign-in", instance: "dev1" }));
    const r = await stream(helper, "FUAI", "/api/fusion-ai/x/chat", { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get(POD_PROXY_ERROR_HEADER)).toBe("auth-required");
    expect(await r.json()).toEqual({ state: "auth-required", message: "no sign-in", instance: "dev1", detail: "Sign in to Dev 1 in the agent chat first." });
    const v = await get(helper, "BOSS", "/api/boss/x");
    expect([v.response.status, (v.body as { detail: string }).detail]).toEqual([401, "Sign in to Dev 1 in the agent chat first."]);
  });
  test("not_configured_names_the_gaps", async () => {
    const { helper } = helperWith(() => proxyState(424, { state: "not-configured", instance: "dev1", target: "BOSS", missing: ["token key BOSS"] }));
    const r = await stream(helper, "BOSS", "/api/boss/x");
    expect(r.status).toBe(424);
    expect((await r.json()).detail).toBe("Instance Dev 1 is not configured for BOSS calls (missing token key BOSS).");
  });
  test("a_state_without_a_json_body_still_reads", async () => {
    const { helper } = helperWith(() => new Response("gateway timeout", { status: 504, headers: { [POD_PROXY_ERROR_HEADER]: "pod-timeout" } }));
    const v = await get(helper, "FUAI", "/api/fusion-ai/x");
    expect(v.body).toEqual({ state: "pod-timeout", detail: "The pod of Dev 1 did not answer in time." });
  });
  test("the_pods_own_answers_pass_untouched", async () => {
    for (const res of [
      json({ title: "Forbidden", "o:errorCode": "FAI-40300" }, 403),
      json({ state: "auth-required" }, 401), // a pod 401 without the proxy header is the pod's
      new Response("<html>login</html>", { status: 401, headers: { "Content-Type": "text/html" } }),
    ]) {
      const { helper } = helperWith(() => res);
      expect(await stream(helper, "FUAI", "/api/fusion-ai/x")).toBe(res);
    }
  });
  test.each([
    ["auth-required", {}, "Sign in to Dev 1 in the agent chat first."],
    ["not-authenticated", {}, "Your agent session has ended: reload the page to sign in again."],
    ["ambiguous-sign-in", { message: "2 sign-ins" }, "You hold several sign-ins for Dev 1: keep one in the agent chat: 2 sign-ins"],
    ["token-refresh-failed", {}, "The sign-in for Dev 1 could not be refreshed: sign in again in the agent chat."],
    ["forbidden", {}, "You have no access to instance Dev 1."],
    ["not-configured", { missing: ["faHost"] }, "Instance Dev 1 is not configured for FUAI calls (missing faHost)."],
    ["pod-unreachable", { message: "ECONNREFUSED" }, "The pod of Dev 1 is unreachable: ECONNREFUSED"],
    ["pod-timeout", {}, "The pod of Dev 1 did not answer in time."],
    ["pod-redirect", { status: 302 }, "The pod of Dev 1 answered FUAI /api/fusion-ai/x with a redirect (HTTP 302)."],
    ["path-not-allowed", { target: "FUAI", path: "/api/fusion-ai/x" }, "The pod proxy refused FUAI /api/fusion-ai/x (path-not-allowed)."],
    ["csrf-refused", {}, "The pod proxy refused FUAI /api/fusion-ai/x (csrf-refused)."],
    ["too-large", { message: "over 10 MB" }, "The pod proxy refused FUAI /api/fusion-ai/x (too-large): over 10 MB"],
  ] as Array<[string, Record<string, unknown>, string]>)("text_of_%s", (state, body, text) => {
    expect(proxyStateText(state, { label: LABEL, target: "FUAI", path: "/api/fusion-ai/x" }, body)).toBe(text);
  });
});

describe("in the chat's endpoint layer (as useChatController builds it)", () => {
  const layer = (helper: PodProxyRestHelper) => {
    const s = streamFetchOf(helper, POD_PROXY_ENDPOINTS, VbStream);
    return new EndpointFetch({ helper: new DashboardRestHelperClass(helper, POD_PROXY_ENDPOINTS), ...(s !== undefined && { stream: s }) });
  };
  test("streams_through_the_vb_provider", async () => {
    const { helper, sent } = helperWith(() => new Response("data: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const endpoints = layer(helper);
    expect(endpoints.canStream).toBe(true);
    const r = await endpoints.stream("FUAI", "/api/fusion-ai/orchestrator/agent/v2/WF/debug", { method: "POST", headers: { Accept: "text/event-stream" }, body: "{}" });
    expect(await r.text()).toBe("data: {}\n\n");
    expect(sent.map((q) => q.url)).toEqual([`${P}/FUAI/api/fusion-ai/orchestrator/agent/v2/WF/debug`]);
  });
  test("auth_required_becomes_the_relogin_401_with_the_sign_in_text", async () => {
    const { helper } = helperWith(() => proxyState(401, { state: "auth-required", instance: "dev1" }));
    const endpoints = layer(helper);
    const e = await endpoints.stream("FUAI", "/api/fusion-ai/x/debug", { method: "POST", headers: {}, body: "{}" }).catch((x) => x);
    expect(e).toBeInstanceOf(EndpointError);
    expect([e.kind, e.status, bodyTextOf(e)]).toEqual(["http", 401, "Sign in to Dev 1 in the agent chat first."]);
    const l = await endpoints.request("BOSS", "/api/boss/data/x").catch((x) => x);
    expect([l.status, bodyTextOf(l)]).toEqual([401, "Sign in to Dev 1 in the agent chat first."]);
  });
  test("not_configured_is_an_http_error_with_readable_text", async () => {
    const { helper } = helperWith(() => proxyState(424, { state: "not-configured", instance: "dev1", target: "BOSS", missing: [] }));
    const e = await layer(helper).request("BOSS", "/api/boss/data/x").catch((x) => x);
    expect([e.kind, e.status]).toEqual(["http", 424]);
    expect(errorText(JSON.stringify(e.body))).toBe("Instance Dev 1 is not configured for BOSS calls.");
  });
});

describe("listPodInstances", () => {
  test("lists_with_the_csrf_header_same_origin", async () => {
    const { fetchImpl, sent } = fakeFetch(() => json({
      instances: [
        { name: "dev1", label: "Dev 1", connected: true, podUser: "jane.doe" },
        { name: "test", label: "Test", connected: false, missing: ["faHost"] },
        { name: "two", label: "Two", connected: true, podUser: null, podUsers: ["a", "b"] },
      ],
    }));
    expect(await listPodInstances({ origin: O, fetchImpl })).toEqual([
      { name: "dev1", label: "Dev 1", connected: true, podUser: "jane.doe" },
      { name: "test", label: "Test", connected: false, missing: ["faHost"] },
      { name: "two", label: "Two", connected: true, podUsers: ["a", "b"] },
    ]);
    expect([sent[0].url, sent[0].method, sent[0].credentials]).toEqual([`${O}/api/pod/instances`, "GET", "same-origin"]);
    expect(headersOf(sent[0])).toEqual({ accept: "application/json", "x-gnimsys-pod-proxy": "1" });
  });
  test("failures_are_explicit", async () => {
    const http = await listPodInstances({ origin: O, fetchImpl: fakeFetch(() => proxyState(401, { state: "not-authenticated", message: "no session" })).fetchImpl }).catch((x) => x);
    expect(http).toBeInstanceOf(PodInstancesError);
    expect([http.status, http.message]).toEqual([401, "instances unavailable (HTTP 401 not-authenticated): no session"]);
    const plain = await listPodInstances({ origin: O, fetchImpl: fakeFetch(() => new Response("Bad Gateway", { status: 502 })).fetchImpl }).catch((x) => x);
    expect(plain.message).toBe("instances unavailable (HTTP 502): Bad Gateway");
    for (const body of [[], { items: [] }, { instances: [{ name: "x", label: "X" }] }, { instances: [{ name: "a b", label: "X", connected: true }] },
      { instances: [{ name: "x", label: "", connected: true }] }, { instances: [{ name: "x", label: "X", connected: true, podUsers: "a" }] }]) {
      const e = await listPodInstances({ origin: O, fetchImpl: fakeFetch(() => json(body)).fetchImpl }).catch((x) => x);
      expect([e.status, e.message]).toEqual([200, "instances unavailable: unexpected answer shape"]);
    }
    const net = await listPodInstances({ origin: O, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }).catch((x) => x);
    expect([net.status, net.message]).toEqual([0, "instances unavailable: Failed to fetch"]);
  });
});
