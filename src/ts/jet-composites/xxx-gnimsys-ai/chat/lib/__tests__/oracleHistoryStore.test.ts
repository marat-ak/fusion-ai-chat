import { OracleHistoryStore } from "../history/OracleHistoryStore";
import { HistoryError } from "../history/HistoryStore";
import type { Audience, AuthFetch } from "../auth/AuthFetch";
import { fakeResponse } from "./helpers.auth";

const O = "https://pod.example.com";
const BASE = `${O}/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en`;
type Call = { audience: Audience; url: string; init?: RequestInit };

function fake(responses: Response[]): { auth: AuthFetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  return { calls, auth: { fetch: async (audience, url, init) => { calls.push({ audience, url, init }); return queue.shift() as Response; } } };
}
const store = (auth: AuthFetch) => new OracleHistoryStore({ auth, workflowCode: "WF_1", userName: "bob's", origin: O });

test("list_builds_boss_query_and_maps_items", async () => {
  const { auth, calls } = fake([fakeResponse(JSON.stringify({
    items: [{ id: "c1", name: "First", timeCreated: "t1", timeUpdated: "t2", $context: { etag: "W/\"e1\"" } }, { id: "c2", timeCreated: "t3", timeUpdated: "t4" }],
    hasMore: true,
  }))]);
  const r = await store(auth).list(100);
  const filter = encodeURIComponent("objectType='AGENT_TEAM' and createdBy~='bob''s' and objectCode ~= 'WF_1'");
  const fields = encodeURIComponent("personIdentifier,id,objectCode,objectType,name,status,createdBy,timeCreated,updatedBy,timeUpdated");
  expect(calls[0].audience).toBe("boss");
  expect(calls[0].url).toBe(`${BASE}/userConversations?$fields=${fields}&$filter=${filter}&$limit=100&$offset=100`);
  expect(r.hasMore).toBe(true);
  expect(r.items).toEqual([
    { id: "c1", name: "First", createdAt: "t1", updatedAt: "t2", etag: "W/\"e1\"" },
    { id: "c2", name: "", createdAt: "t3", updatedAt: "t4", etag: "" },
  ]);
});

test("messages_reverses_and_filters_types", async () => {
  const { auth, calls } = fake([fakeResponse(JSON.stringify({ items: [
    { type: "AI", text: "answer" }, { type: "TOOL", text: "x" }, { type: "USER", text: "question" },
  ] }))]);
  const r = await store(auth).messages("c1");
  expect(calls[0].audience).toBe("fusion-ai");
  expect(calls[0].url).toBe(`${O}/api/fusion-ai/orchestrator/conversations/v1/c1/messages`);
  expect(r).toEqual([{ role: "user", text: "question" }, { role: "assistant", text: "answer" }]);
});

test("messages_500_throws_HistoryError", async () => {
  const { auth } = fake([fakeResponse("boom body", { status: 500 })]);
  const e = await store(auth).messages("c1").catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect(e.status).toBe(500);
  expect(e.body).toBe("boom body");
});

test("rename_sends_patch_with_if_match_stripping_weak_prefix", async () => {
  const { auth, calls } = fake([fakeResponse("{}", { headers: { ETag: 'W/"abc"' } }), fakeResponse("", { status: 204 })]);
  await store(auth).rename("c1", "New");
  expect(calls[0].audience).toBe("boss");
  expect(calls[0].url).toBe(`${BASE}/userConversations/c1?$fields=id`);
  expect(calls[1].url).toBe(`${BASE}/userConversations/c1`);
  expect(calls[1].init?.method).toBe("PATCH");
  const h = new Headers(calls[1].init?.headers);
  expect(h.get("If-Match")).toBe('"abc"');
  expect(h.get("Content-Type")).toBe("application/json");
  expect(JSON.parse(calls[1].init?.body as string)).toEqual({ name: "New" });
});

test("remove_sends_delete_with_if_match", async () => {
  const { auth, calls } = fake([fakeResponse(JSON.stringify({ $context: { etag: 'W/"zz"' } })), fakeResponse("", { status: 204 })]);
  await store(auth).remove("c1");
  expect(calls[1].init?.method).toBe("DELETE");
  expect(new Headers(calls[1].init?.headers).get("If-Match")).toBe('"zz"');
});

test("name_returns_null_on_404", async () => {
  const { auth } = fake([fakeResponse("", { status: 404 })]);
  expect(await store(auth).name("c1")).toBeNull();
});
