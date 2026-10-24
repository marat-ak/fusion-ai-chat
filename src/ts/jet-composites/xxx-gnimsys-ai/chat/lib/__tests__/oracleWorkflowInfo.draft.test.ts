import { OracleWorkflowInfo } from "../history/OracleWorkflowInfo";
import { HistoryError } from "../history/HistoryStore";
import { fakeEndpoints, vb } from "./helpers.endpoints";

test("draft_reads_the_draft_row", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ items: [{ name: "Agent (draft)", firstStarterQuestion: "Q1" }] })]);
  const r = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "DRAFT" }).get();
  expect(calls[0].url).toContain(`&$filter=${encodeURIComponent("workflowCode='WF_1' and status='DRAFT'")}`);
  expect(r).toEqual({ name: "Agent (draft)", starterQuestions: ["Q1"], followupEnabled: false });
});

test("draft_missing_is_a_404_naming_the_draft", async () => {
  const { endpoints } = fakeEndpoints([vb({ items: [] })]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "DRAFT" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect([e.status, e.body]).toEqual([404, "workflow draft not found"]);
});
