import { OracleWorkflowInfo, startersUnavailableText, WorkflowNotFoundError } from "../history/OracleWorkflowInfo";
import { HistoryError } from "../history/HistoryStore";
import { errorDetail } from "../errors";
import { fakeEndpoints, vb } from "./helpers.endpoints";

test("workflow_info_maps_three_starters_dropping_empty", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ items: [{ name: "Agent", firstStarterQuestion: "Q1", secondStarterQuestion: "", thirdStarterQuestion: "Q3", followupEnabledFlag: true }] })]);
  const r = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "PUBLISHED" }).get();
  const fields = encodeURIComponent("name,firstStarterQuestion,secondStarterQuestion,thirdStarterQuestion,followupEnabledFlag");
  const filter = encodeURIComponent("workflowCode='WF_1' and status='PUBLISHED'");
  expect(calls[0].target).toBe("BOSS");
  expect(calls[0].method).toBe("GET");
  expect(calls[0].url).toBe(`/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=${fields}&$filter=${filter}`);
  expect(r).toEqual({ name: "Agent", starterQuestions: ["Q1", "Q3"], followupEnabled: true });
});

test("workflow_info_throws_when_name_missing", async () => {
  const { endpoints } = fakeEndpoints([vb({ items: [{ firstStarterQuestion: "Q" }] })]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "PUBLISHED" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([0, "workflow name missing"]);
});

// The pod answered 200 with no row: the notice says why, never a made-up "HTTP 404" (design §5.1).
test("not_published_banner_text", async () => {
  const { endpoints } = fakeEndpoints([vb({ items: [] })]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "PUBLISHED" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(WorkflowNotFoundError);
  expect(errorDetail(e)).toEqual({ message: "workflow not published" });
  expect(startersUnavailableText(errorDetail(e))).toBe("Starter questions unavailable (workflow not published)");
  // A real HTTP failure keeps its status.
  expect(startersUnavailableText({ message: "x", status: 404 })).toBe("Starter questions unavailable (HTTP 404)");
});

test("workflow_info_http_error_throws_HistoryError_with_body", async () => {
  const { endpoints } = fakeEndpoints([vb({ detail: "mock pod: armed workflows 404" }, 404)]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "PUBLISHED" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([404, '{"detail":"mock pod: armed workflows 404"}']);
});

test("workflow_info_non_json_body_throws_HistoryError", async () => {
  const { endpoints } = fakeEndpoints([vb("<html>login</html>")]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "PUBLISHED" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([0, "non-JSON response"]);
});
