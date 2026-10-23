import { OracleWorkflowInfo } from "../history/OracleWorkflowInfo";
import { HistoryError } from "../history/HistoryStore";
import { fakeEndpoints, vb } from "./helpers.endpoints";

test("workflow_info_maps_three_starters_dropping_empty", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ items: [{ name: "Agent", firstStarterQuestion: "Q1", secondStarterQuestion: "", thirdStarterQuestion: "Q3", followupEnabledFlag: true }] })]);
  const r = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1" }).get();
  const fields = encodeURIComponent("name,firstStarterQuestion,secondStarterQuestion,thirdStarterQuestion,followupEnabledFlag");
  const filter = encodeURIComponent("workflowCode='WF_1' and status='PUBLISHED'");
  expect(calls[0].target).toBe("BOSS");
  expect(calls[0].method).toBe("GET");
  expect(calls[0].url).toBe(`/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=${fields}&$filter=${filter}`);
  expect(r).toEqual({ name: "Agent", starterQuestions: ["Q1", "Q3"], followupEnabled: true });
});

test("workflow_info_throws_when_name_missing", async () => {
  const { endpoints } = fakeEndpoints([vb({ items: [{ firstStarterQuestion: "Q" }] })]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([0, "workflow name missing"]);
});

test("workflow_info_unpublished_throws_404", async () => {
  const { endpoints } = fakeEndpoints([vb({ items: [] })]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect(e.status).toBe(404);
});

test("workflow_info_http_error_throws_HistoryError_with_body", async () => {
  const { endpoints } = fakeEndpoints([vb({ detail: "mock pod: armed workflows 404" }, 404)]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([404, '{"detail":"mock pod: armed workflows 404"}']);
});

test("workflow_info_non_json_body_throws_HistoryError", async () => {
  const { endpoints } = fakeEndpoints([vb("<html>login</html>")]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([0, "non-JSON response"]);
});
