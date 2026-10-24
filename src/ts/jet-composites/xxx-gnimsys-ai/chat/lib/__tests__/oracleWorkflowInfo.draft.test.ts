import { OracleWorkflowInfo, startersUnavailableText, WorkflowNotFoundError } from "../history/OracleWorkflowInfo";
import { errorDetail } from "../errors";
import { fakeEndpoints, vb } from "./helpers.endpoints";

test("draft_reads_the_draft_row", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ items: [{ name: "Agent (draft)", firstStarterQuestion: "Q1" }] })]);
  const r = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "DRAFT" }).get();
  expect(calls[0].url).toContain(`&$filter=${encodeURIComponent("workflowCode='WF_1' and status='DRAFT'")}`);
  expect(r).toEqual({ name: "Agent (draft)", starterQuestions: ["Q1"], followupEnabled: false });
});

test("draft_missing_says_no_draft_version", async () => {
  const { endpoints } = fakeEndpoints([vb({ items: [] })]);
  const e = await new OracleWorkflowInfo({ endpoints, workflowCode: "WF_1", status: "DRAFT" }).get().catch((x) => x);
  expect(e).toBeInstanceOf(WorkflowNotFoundError);
  expect([e.message, e.version, "status" in e]).toEqual(["no draft version", "DRAFT", false]);
  expect(startersUnavailableText(errorDetail(e))).toBe("Starter questions unavailable (no draft version)");
});
