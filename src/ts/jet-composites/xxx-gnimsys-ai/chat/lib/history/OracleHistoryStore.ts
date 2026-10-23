import { EndpointError, endpointBodyText, objectBody } from "../endpoints/EndpointFetch";
import type { EndpointFetch, EndpointInit, EndpointName, EndpointResponse } from "../endpoints/EndpointFetch";
import { HistoryError } from "./HistoryStore";
import type { ConversationSummary, HistoryMessage, HistoryStore } from "./HistoryStore";

const FIELDS = "personIdentifier,id,objectCode,objectType,name,status,createdBy,timeCreated,updatedBy,timeUpdated";
const BASE = "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en";
const q = (s: string): string => s.replace(/'/g, "''");

/**
 * An endpoint call whose HTTP failure is a HistoryError (status + the error body as text); a call refused by the endpoint
 * layer or without an HTTP answer stays an EndpointError.
 */
export async function historyCall(endpoints: EndpointFetch, target: EndpointName, url: string, init?: EndpointInit): Promise<EndpointResponse> {
  try {
    return await endpoints.request(target, url, init);
  } catch (e) {
    if (e instanceof EndpointError && e.kind === "http") throw new HistoryError(e.status, endpointBodyText(e.body), e.fusionErrorCode);
    throw e;
  }
}

/** The JSON object body of a history response; anything else (a login page, text) is a HistoryError. */
export function historyJson(res: EndpointResponse): Record<string, unknown> {
  const json = objectBody(res);
  if (json === null) throw new HistoryError(0, "non-JSON response");
  return json;
}

export class OracleHistoryStore implements HistoryStore {
  private endpoints: EndpointFetch;
  private workflowCode: string;
  private userName: string;

  constructor(deps: { endpoints: EndpointFetch; workflowCode: string; userName: string }) {
    this.endpoints = deps.endpoints;
    this.workflowCode = deps.workflowCode;
    this.userName = deps.userName;
  }

  async list(offset = 0): Promise<{ items: ConversationSummary[]; hasMore: boolean }> {
    const filter = `objectType='AGENT_TEAM' and createdBy~='${q(this.userName)}' and objectCode ~= '${q(this.workflowCode)}'`;
    const url = `${BASE}/userConversations?$fields=${encodeURIComponent(FIELDS)}&$filter=${encodeURIComponent(filter)}&$limit=100&$offset=${offset}`;
    const json = historyJson(await historyCall(this.endpoints, "BOSS", url));
    const items: ConversationSummary[] = ((json.items as any[] | undefined) ?? []).map((it: any) => ({
      id: it.id,
      name: it.name ?? "",
      createdAt: it.timeCreated,
      updatedAt: it.timeUpdated,
      etag: it.$context?.etag ?? "",
    }));
    return { items, hasMore: !!json.hasMore };
  }

  async name(id: string): Promise<string | null> {
    let res: EndpointResponse;
    try {
      res = await historyCall(this.endpoints, "BOSS", `${BASE}/userConversations/${encodeURIComponent(id)}?$fields=name`);
    } catch (e) {
      if (e instanceof HistoryError && e.status === 404) return null;
      throw e;
    }
    const json = historyJson(res);
    return typeof json.name === "string" ? json.name : null;
  }

  private async etag(id: string): Promise<string> {
    const res = await historyCall(this.endpoints, "BOSS", `${BASE}/userConversations/${encodeURIComponent(id)}?$fields=id`);
    let tag = res.headers.get("ETag");
    if (!tag) {
      const ctx = objectBody(res)?.$context as { etag?: unknown } | undefined;
      tag = typeof ctx?.etag === "string" ? ctx.etag : null;
    }
    if (!tag) throw new HistoryError(0, "etag missing");
    return tag.replace(/^W\//, "");
  }

  async rename(id: string, name: string): Promise<void> {
    const etag = await this.etag(id);
    await historyCall(this.endpoints, "BOSS", `${BASE}/userConversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": etag },
      body: JSON.stringify({ name }),
    });
  }

  async remove(id: string): Promise<void> {
    const etag = await this.etag(id);
    await historyCall(this.endpoints, "BOSS", `${BASE}/userConversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "If-Match": etag },
    });
  }

  async messages(id: string): Promise<HistoryMessage[]> {
    const res = await historyCall(this.endpoints, "FUAI", `/api/fusion-ai/orchestrator/conversations/v1/${encodeURIComponent(id)}/messages`);
    const json = historyJson(res);
    const raw: any[] = (json.items as any[] | undefined) ?? (json.messages as any[] | undefined) ?? [];
    return raw
      .filter((m) => m.type === "AI" || m.type === "USER")
      .map((m): HistoryMessage => ({ role: m.type === "AI" ? "assistant" : "user", text: String(m.text ?? "") }))
      .reverse();
  }
}
