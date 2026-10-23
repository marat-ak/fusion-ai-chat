/** @jest-environment node */
import { ENDPOINT_NAMES, ENDPOINT_PREFIXES, EndpointError, endpointBodyText, streamFetchOf } from "../endpoints/EndpointFetch";
import type { EndpointName, StreamFetch } from "../endpoints/EndpointFetch";
import { fakeEndpoints, vb } from "./helpers.endpoints";

const refused = async (p: Promise<unknown>): Promise<EndpointError> => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(EndpointError);
  expect((e as EndpointError).kind).toBe("refused");
  return e as EndpointError;
};

test("endpoint_names_and_prefixes_are_spec_4a", () => {
  expect(ENDPOINT_NAMES).toEqual(["FA", "FUAI", "BOSS", "SAASBATCH", "KM", "SALESCOMMON"]);
  expect(ENDPOINT_PREFIXES).toEqual({
    FA: ["/fscmRestApi/", "/hcmRestApi/", "/crmRestApi/", "/applcoreApi/v1/", "/xmlpserver/"],
    FUAI: ["/api/fusion-ai/"],
    BOSS: ["/api/boss/"],
    SAASBATCH: ["/api/saas-batch/"],
    KM: ["/api/knowledge-management/", "/api/ci/"],
    SALESCOMMON: ["/api/sales-common/"],
  });
});

test("target_prefix_mismatch_is_refused", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({})]);
  const e = await refused(endpoints.request("BOSS", "/api/fusion-ai/orchestrator/x"));
  expect(e.target).toBe("BOSS");
  expect(e.url).toBe("/api/fusion-ai/orchestrator/x");
  expect(e.status).toBe(0);
  expect(e.message).toBe("endpoint BOSS refuses /api/fusion-ai/orchestrator/x: the path is not under /api/boss/");
  const stream: StreamFetch = async () => { throw new Error("must not be called"); };
  const s = fakeEndpoints([], { stream });
  await refused(s.endpoints.stream("FUAI", "/api/boss/x", { method: "POST", headers: {} }));
  expect(calls).toEqual([]);
});

test("absolute_relative_and_traversal_urls_are_refused", async () => {
  const { endpoints, calls } = fakeEndpoints([]);
  for (const url of [
    "https://evil.example.com/api/boss/x", "//evil.example.com/api/boss/x", "api/boss/x", "/api/boss",
    "/api/boss/../fusion-ai/x", "/api/boss/%2e%2e/fusion-ai/x", "/api/boss/./x", "/api/boss\\..\\x",
  ]) {
    const e = await refused(endpoints.request("BOSS", url));
    expect(e.url).toBe(url);
  }
  expect(calls).toEqual([]);
});

test("every_spec_prefix_reaches_its_endpoint", async () => {
  const pairs = ENDPOINT_NAMES.flatMap((n) => ENDPOINT_PREFIXES[n].map((p) => [n, p] as [EndpointName, string]));
  const { endpoints, calls } = fakeEndpoints(pairs.map(() => vb({ ok: 1 })));
  for (const [n, p] of pairs) {
    const r = await endpoints.request(n, `${p}x?$fields=id`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: 1 });
  }
  expect(calls.map((c) => [c.target, c.url])).toEqual(pairs.map(([n, p]) => [n, `/${p.slice(1)}x?$fields=id`]));
});

test("target_missing_from_endpoint_map_is_refused", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({})], { endpoints: { FUAI: "scFUAI", BOSS: "scBOSS" } });
  const e = await refused(endpoints.request("FA", "/fscmRestApi/x"));
  expect(e.message).toBe("endpoint FA refuses /fscmRestApi/x: FA is not in the endpoint map");
  expect(calls).toEqual([]);
});

test("request_methods_headers_and_bodies", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ a: 1 }, 200, { ETag: '"1"' }), vb({}, 201), vb({}), vb("", 204), vb({}), vb({})]);
  const r = await endpoints.request("BOSS", "/api/boss/x?$fields=id");
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ a: 1 });
  expect(r.headers.get("ETag")).toBe('"1"');
  await endpoints.request("FA", "/hcmRestApi/y", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"b":2}' });
  await endpoints.request("BOSS", "/api/boss/x", { method: "PATCH", headers: { "If-Match": '"1"', "Content-Type": "application/json" }, body: '{"name":"n"}' });
  const del = await endpoints.request("BOSS", "/api/boss/x", { method: "DELETE", headers: { "If-Match": '"1"' } });
  expect(del.status).toBe(204);
  const fd = new FormData();
  fd.append("k", "v");
  await endpoints.request("FA", "/fscmRestApi/upload", { method: "POST", body: fd });
  await endpoints.request("FA", "/fscmRestApi/put", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "raw" });
  expect(calls).toEqual([
    { target: "BOSS", method: "GET", url: "/api/boss/x?$fields=id", headers: {} },
    { target: "FA", method: "POST", url: "/hcmRestApi/y", headers: { "Content-Type": "application/json" }, body: '{"b":2}' },
    { target: "BOSS", method: "PATCH", url: "/api/boss/x", headers: { "If-Match": '"1"', "Content-Type": "application/json" }, body: '{"name":"n"}' },
    { target: "BOSS", method: "DELETE", url: "/api/boss/x", headers: { "If-Match": '"1"' } },
    { target: "FA", method: "POST", url: "/fscmRestApi/upload", headers: {}, body: fd },
    { target: "FA", method: "PUT", url: "/fscmRestApi/put", headers: { "Content-Type": "text/plain" }, body: "raw" },
  ]);
});

test("maps_http_errors_to_EndpointError", async () => {
  const { endpoints } = fakeEndpoints([vb({ detail: "boom" }, 500), vb({ "o:errorCode": "X1" }, 200), vb("denied", 401)]);
  const e = (await endpoints.request("BOSS", "/api/boss/x").catch((x: unknown) => x)) as EndpointError;
  expect(e).toBeInstanceOf(EndpointError);
  expect([e.kind, e.target, e.url, e.status, e.body]).toEqual(["http", "BOSS", "/api/boss/x", 500, { detail: "boom" }]);
  expect(e.message).toBe("BOSS GET /api/boss/x: HTTP 500");
  const o = (await endpoints.request("FA", "/fscmRestApi/x").catch((x: unknown) => x)) as EndpointError;
  expect([o.kind, o.status, o.body]).toEqual(["http", 200, { "o:errorCode": "X1" }]);
  expect(o.fusionErrorCode).toBe("X1");
  expect(o.message).toBe("Fusion error X1: FA GET /fscmRestApi/x (HTTP 200)");
  const u = (await endpoints.request("FUAI", "/api/fusion-ai/x", { method: "POST" }).catch((x: unknown) => x)) as EndpointError;
  expect([u.kind, u.status, u.body, u.message]).toEqual(["http", 401, "denied", "FUAI POST /api/fusion-ai/x: HTTP 401"]);
});

test("oerrorcode_with_an_error_status_is_a_plain_http_error", async () => {
  const { endpoints } = fakeEndpoints([vb({ "o:errorCode": "X2", title: "bad" }, 400)]);
  const e = (await endpoints.request("FA", "/fscmRestApi/x").catch((x: unknown) => x)) as EndpointError;
  expect([e.kind, e.status, e.fusionErrorCode, e.message]).toEqual(["http", 400, undefined, "FA GET /fscmRestApi/x: HTTP 400"]);
});

test("network_failure_is_EndpointError_without_status", async () => {
  const { endpoints } = fakeEndpoints([new TypeError("Failed to fetch")]);
  const e = (await endpoints.request("FUAI", "/api/fusion-ai/x").catch((x: unknown) => x)) as EndpointError;
  expect(e).toBeInstanceOf(EndpointError);
  expect([e.kind, e.status, e.body]).toEqual(["network", 0, undefined]);
  expect(e.message).toBe("FUAI GET /api/fusion-ai/x: Failed to fetch");
});

test("stream_absent_is_explicit", async () => {
  const { endpoints, calls } = fakeEndpoints([]);
  expect(endpoints.canStream).toBe(false);
  const e = (await endpoints.stream("FUAI", "/api/fusion-ai/x/chat", { method: "POST", headers: {} }).catch((x: unknown) => x)) as EndpointError;
  expect(e).toBeInstanceOf(EndpointError);
  expect([e.kind, e.target, e.status]).toEqual(["stream-unavailable", "FUAI", 0]);
  expect(e.message).toBe("streaming not available through endpoint FUAI");
  expect(calls).toEqual([]);
});

test("stream_returns_the_unconsumed_response", async () => {
  const sent: Array<[EndpointName, string, unknown]> = [];
  const res = new Response("data: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
  const ac = new AbortController();
  const { endpoints } = fakeEndpoints([], { stream: async (t, u, i) => { sent.push([t, u, i]); return res; } });
  expect(endpoints.canStream).toBe(true);
  const r = await endpoints.stream("FUAI", "/api/fusion-ai/x/chat", { method: "POST", headers: { Accept: "text/event-stream" }, body: "{}", signal: ac.signal });
  expect(r).toBe(res);
  expect(r.bodyUsed).toBe(false);
  expect(sent).toEqual([["FUAI", "/api/fusion-ai/x/chat", { method: "POST", headers: { Accept: "text/event-stream" }, body: "{}", signal: ac.signal }]]);
});

test("stream_http_error_and_network_failure", async () => {
  const answers = [new Response('{"detail":"FAI-1 no"}', { status: 403, statusText: "Forbidden" }), new TypeError("Failed to fetch")];
  const { endpoints } = fakeEndpoints([], {
    stream: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a as Response; },
  });
  const e = (await endpoints.stream("FUAI", "/api/fusion-ai/c", { method: "POST", headers: {} }).catch((x: unknown) => x)) as EndpointError;
  expect([e.kind, e.status, e.body, e.statusText]).toEqual(["http", 403, '{"detail":"FAI-1 no"}', "Forbidden"]);
  const n = (await endpoints.stream("FUAI", "/api/fusion-ai/c", { method: "POST", headers: {} }).catch((x: unknown) => x)) as EndpointError;
  expect([n.kind, n.status, n.message]).toEqual(["network", 0, "FUAI POST /api/fusion-ai/c: Failed to fetch"]);
});

test("streamFetchOf_uses_the_rest_helpers_capability", async () => {
  const res = new Response("");
  const seen: unknown[] = [];
  const restHelper = { get: () => ({}), streamFetch: async (id: string, req: unknown) => { seen.push([id, req]); return res; } };
  const fn = streamFetchOf(restHelper, { FUAI: "scFUAI", BOSS: "scBOSS" });
  expect(fn).toBeDefined();
  expect(await (fn as StreamFetch)("FUAI", "/api/fusion-ai/c", { method: "POST", headers: { A: "1" }, body: "{}" })).toBe(res);
  expect(seen).toEqual([["scFUAI", { url: "/api/fusion-ai/c", method: "POST", headers: { A: "1" }, body: "{}" }]]);
  // VB's RestHelper has no streamFetch: no capability.
  expect(streamFetchOf({ get: () => ({}) }, { FUAI: "scFUAI" })).toBeUndefined();
});

test("endpointBodyText", () => {
  expect(endpointBodyText("boom body")).toBe("boom body");
  expect(endpointBodyText({ detail: "boom" })).toBe('{"detail":"boom"}');
  expect(endpointBodyText("")).toBe("");
  expect(endpointBodyText(null)).toBeUndefined();
  expect(endpointBodyText(undefined)).toBeUndefined();
});
