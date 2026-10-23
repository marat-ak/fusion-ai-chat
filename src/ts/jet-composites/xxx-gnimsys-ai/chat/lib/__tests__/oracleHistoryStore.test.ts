import { OracleHistoryStore } from "../history/OracleHistoryStore";
import { HistoryError } from "../history/HistoryStore";
import { EndpointError } from "../endpoints/EndpointFetch";
import type { EndpointFetch } from "../endpoints/EndpointFetch";
import { fakeEndpoints, vb } from "./helpers.endpoints";

const BASE = "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en";
const store = (endpoints: EndpointFetch) => new OracleHistoryStore({ endpoints, workflowCode: "WF_1", userName: "bob's" });

test("list_builds_boss_query_and_maps_items", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({
    items: [{ id: "c1", name: "First", timeCreated: "t1", timeUpdated: "t2", $context: { etag: "W/\"e1\"" } }, { id: "c2", timeCreated: "t3", timeUpdated: "t4" }],
    hasMore: true,
  })]);
  const r = await store(endpoints).list(100);
  const filter = encodeURIComponent("objectType='AGENT_TEAM' and createdBy~='bob''s' and objectCode ~= 'WF_1'");
  const fields = encodeURIComponent("personIdentifier,id,objectCode,objectType,name,status,createdBy,timeCreated,updatedBy,timeUpdated");
  expect(calls[0].target).toBe("BOSS");
  expect(calls[0].method).toBe("GET");
  expect(calls[0].url).toBe(`${BASE}/userConversations?$fields=${fields}&$filter=${filter}&$limit=100&$offset=100`);
  expect(r.hasMore).toBe(true);
  expect(r.items).toEqual([
    { id: "c1", name: "First", createdAt: "t1", updatedAt: "t2", etag: "W/\"e1\"" },
    { id: "c2", name: "", createdAt: "t3", updatedAt: "t4", etag: "" },
  ]);
});

test("list_non_json_body_throws_HistoryError", async () => {
  const { endpoints } = fakeEndpoints([vb("<html>login</html>")]);
  const e = await store(endpoints).list().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([0, "non-JSON response"]);
});

test("messages_reverses_and_filters_types", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ items: [
    { type: "AI", text: "answer" }, { type: "TOOL", text: "x" }, { type: "USER", text: "question" },
  ] })]);
  const r = await store(endpoints).messages("c1");
  expect(calls[0].target).toBe("FUAI");
  expect(calls[0].url).toBe("/api/fusion-ai/orchestrator/conversations/v1/c1/messages");
  expect(r).toEqual([{ role: "user", text: "question" }, { role: "assistant", text: "answer" }]);
});

test("messages_500_throws_HistoryError", async () => {
  const { endpoints } = fakeEndpoints([vb("boom body", 500)]);
  const e = await store(endpoints).messages("c1").catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect(e.status).toBe(500);
  expect(e.body).toBe("boom body");
});

test("json_error_body_is_kept_as_text", async () => {
  const { endpoints } = fakeEndpoints([vb({ detail: "boom" }, 500)]);
  const e = await store(endpoints).messages("c1").catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([500, '{"detail":"boom"}']);
});

test("oerrorcode_on_200_is_a_prefixed_HistoryError", async () => {
  const { endpoints } = fakeEndpoints([vb({ "o:errorCode": "FND-1", title: "nope" }, 200)]);
  const e = await store(endpoints).list().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.fusionErrorCode, e.body]).toEqual([200, "FND-1", '{"o:errorCode":"FND-1","title":"nope"}']);
  expect(e.message).toBe('Fusion error FND-1: history HTTP 200: {"o:errorCode":"FND-1","title":"nope"}');
});

test("http_401_keeps_its_status", async () => {
  const { endpoints } = fakeEndpoints([vb("denied", 401)]);
  const e = await store(endpoints).list().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect(e.status).toBe(401);
});

test("network_failure_propagates_as_EndpointError", async () => {
  const { endpoints } = fakeEndpoints([new TypeError("Failed to fetch")]);
  const e = await store(endpoints).list().catch((x) => x);
  expect(e).toBeInstanceOf(EndpointError);
  expect([e.kind, e.target]).toEqual(["network", "BOSS"]);
});

test("rename_sends_patch_with_if_match_stripping_weak_prefix", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({}, 200, { ETag: 'W/"abc"' }), vb("", 204)]);
  await store(endpoints).rename("c1", "New");
  expect(calls[0].target).toBe("BOSS");
  expect(calls[0].method).toBe("GET");
  expect(calls[0].url).toBe(`${BASE}/userConversations/c1?$fields=id`);
  expect(calls[1].target).toBe("BOSS");
  expect(calls[1].url).toBe(`${BASE}/userConversations/c1`);
  expect(calls[1].method).toBe("PATCH");
  const h = new Headers(calls[1].headers);
  expect(h.get("If-Match")).toBe('"abc"');
  expect(h.get("Content-Type")).toBe("application/json");
  expect(JSON.parse(calls[1].body as string)).toEqual({ name: "New" });
});

test("remove_sends_delete_with_if_match", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ $context: { etag: 'W/"zz"' } }), vb("", 204)]);
  await store(endpoints).remove("c1");
  expect(calls[1].method).toBe("DELETE");
  expect(calls[1].url).toBe(`${BASE}/userConversations/c1`);
  expect(new Headers(calls[1].headers).get("If-Match")).toBe('"zz"');
});

test("name_returns_null_on_404", async () => {
  const { endpoints } = fakeEndpoints([vb("", 404)]);
  expect(await store(endpoints).name("c1")).toBeNull();
});
