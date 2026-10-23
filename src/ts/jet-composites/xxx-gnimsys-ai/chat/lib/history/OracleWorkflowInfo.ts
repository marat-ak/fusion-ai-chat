import type { EndpointFetch } from "../endpoints/EndpointFetch";
import { HistoryError } from "./HistoryStore";
import { historyCall, historyJson } from "./OracleHistoryStore";

export interface WorkflowInfo { name: string; starterQuestions: string[]; followupEnabled: boolean }

export class OracleWorkflowInfo {
  private endpoints: EndpointFetch;
  private workflowCode: string;

  constructor(deps: { endpoints: EndpointFetch; workflowCode: string }) {
    this.endpoints = deps.endpoints;
    this.workflowCode = deps.workflowCode;
  }

  async get(): Promise<WorkflowInfo> {
    const filter = `workflowCode='${this.workflowCode.replace(/'/g, "''")}' and status='PUBLISHED'`;
    const fields = "name,firstStarterQuestion,secondStarterQuestion,thirdStarterQuestion,followupEnabledFlag";
    const url = `/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=${encodeURIComponent(fields)}&$filter=${encodeURIComponent(filter)}`;
    const json = historyJson(await historyCall(this.endpoints, "BOSS", url));
    const item = ((json.items as any[] | undefined) ?? [])[0];
    if (!item) throw new HistoryError(404, "workflow not published");
    if (typeof item.name !== "string" || item.name === "") throw new HistoryError(0, "workflow name missing");
    return {
      name: item.name,
      starterQuestions: [item.firstStarterQuestion, item.secondStarterQuestion, item.thirdStarterQuestion].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
      followupEnabled: item.followupEnabledFlag === true,
    };
  }
}
