import { OracleWorkflowInfo } from "../history/OracleWorkflowInfo";
import { HistoryError } from "../history/HistoryStore";
import type { Audience, AuthFetch } from "../auth/AuthFetch";
import { fakeResponse } from "./helpers.auth";

const O = "https://pod.example.com";
function fake(r: Response): { auth: AuthFetch; calls: Array<{ audience: Audience; url: string }> } {
  const calls: Array<{ audience: Audience; url: string }> = [];
  return { calls, auth: { fetch: async (audience, url) => { calls.push({ audience, url }); return r; } } };
}

test("workflow_info_maps_three_starters_dropping_empty", async () => {
  const { auth, calls } = fake(fakeResponse(JSON.stringify({ items: [{ name: "Agent", firstStarterQuestion: "Q1", secondStarterQuestion: "", thirdStarterQuestion: "Q3", followupEnabledFlag: true }] })));
  const r = await new OracleWorkflowInfo({ auth, workflowCode: "WF_1", origin: O }).get();
  const fields = encodeURIComponent("name,firstStarterQuestion,secondStarterQuestion,thirdStarterQuestion,followupEnabledFlag");
  const filter = encodeURIComponent("workflowCode='WF_1' and status='PUBLISHED'");
  expect(calls[0].audience).toBe("boss");
  expect(calls[0].url).toBe(`${O}/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=${fields}&$filter=${filter}`);
  expect(r).toEqual({ name: "Agent", starterQuestions: ["Q1", "Q3"], followupEnabled: true });
});

test("workflow_info_unpublished_throws_404", async () => {
  const { auth } = fake(fakeResponse(JSON.stringify({ items: [] })));
  const e = await new OracleWorkflowInfo({ auth, workflowCode: "WF_1", origin: O }).get().catch((x) => x);
  expect(e).toBeInstanceOf(HistoryError);
  expect(e.status).toBe(404);
});
