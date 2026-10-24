import type { ArtifactVersion } from "../config/types";
import type { EndpointFetch } from "../endpoints/EndpointFetch";
import { HistoryError } from "./HistoryStore";
import { historyCall, historyJson } from "./OracleHistoryStore";

export interface WorkflowInfo { name: string; starterQuestions: string[]; followupEnabled: boolean }

/**
 * The pod answered, with no row for the workflow in that version: the workflow is not published (or has no draft). Not an
 * HTTP failure, so it carries no status (the notice names the reason, never a made-up "HTTP 404").
 */
export class WorkflowNotFoundError extends Error {
  readonly version: ArtifactVersion;
  constructor(version: ArtifactVersion) {
    super(version === "DRAFT" ? "no draft version" : "workflow not published");
    this.name = "WorkflowNotFoundError";
    this.version = version;
  }
}

/** The starters notice: the HTTP status of a failed lookup, else the reason (e.g. "workflow not published"). */
export function startersUnavailableText(error: { message: string; status?: number }): string {
  return `Starter questions unavailable (${error.status ? "HTTP " + error.status : error.message})`;
}

export class OracleWorkflowInfo {
  private endpoints: EndpointFetch;
  private workflowCode: string;
  private status: ArtifactVersion;

  /** `status`: the copy the chat runs (agent.version), so a draft shows its own name and starters. */
  constructor(deps: { endpoints: EndpointFetch; workflowCode: string; status: ArtifactVersion }) {
    this.endpoints = deps.endpoints;
    this.workflowCode = deps.workflowCode;
    this.status = deps.status;
  }

  async get(): Promise<WorkflowInfo> {
    const filter = `workflowCode='${this.workflowCode.replace(/'/g, "''")}' and status='${this.status}'`;
    const fields = "name,firstStarterQuestion,secondStarterQuestion,thirdStarterQuestion,followupEnabledFlag";
    const url = `/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=${encodeURIComponent(fields)}&$filter=${encodeURIComponent(filter)}`;
    const json = historyJson(await historyCall(this.endpoints, "BOSS", url));
    const item = ((json.items as any[] | undefined) ?? [])[0];
    if (!item) throw new WorkflowNotFoundError(this.status);
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
