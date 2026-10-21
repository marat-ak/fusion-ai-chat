import type { AuthFetch } from "../auth/AuthFetch";
import { HistoryError } from "./HistoryStore";
import { resolveOrigin } from "./OracleHistoryStore";

export interface WorkflowInfo { name: string; starterQuestions: string[]; followupEnabled: boolean }

export class OracleWorkflowInfo {
  private auth: AuthFetch;
  private workflowCode: string;
  private origin: string;

  constructor(deps: { auth: AuthFetch; workflowCode: string; origin?: string }) {
    this.auth = deps.auth;
    this.workflowCode = deps.workflowCode;
    this.origin = resolveOrigin(deps.origin);
  }

  async get(): Promise<WorkflowInfo> {
    const filter = `workflowCode='${this.workflowCode.replace(/'/g, "''")}' and status='PUBLISHED'`;
    const fields = "name,firstStarterQuestion,secondStarterQuestion,thirdStarterQuestion,followupEnabledFlag";
    const url = `${this.origin}/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=${encodeURIComponent(fields)}&$filter=${encodeURIComponent(filter)}`;
    const r = await this.auth.fetch("boss", url);
    if (!r.ok) throw new HistoryError(r.status, await r.text());
    const json = JSON.parse(await r.text());
    const item = (json.items ?? [])[0];
    if (!item) throw new HistoryError(404, "workflow not published");
    return {
      name: item.name ?? this.workflowCode,
      starterQuestions: [item.firstStarterQuestion, item.secondStarterQuestion, item.thirdStarterQuestion].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
      followupEnabled: item.followupEnabledFlag === true,
    };
  }
}
