import type { AuthFetch } from "../auth/AuthFetch";
import { resolveOrigin } from "../origin";
import { HistoryError } from "./HistoryStore";
import type { ConversationSummary, HistoryMessage, HistoryStore } from "./HistoryStore";

const FIELDS = "personIdentifier,id,objectCode,objectType,name,status,createdBy,timeCreated,updatedBy,timeUpdated";
const q = (s: string): string => s.replace(/'/g, "''");

export class OracleHistoryStore implements HistoryStore {
  private auth: AuthFetch;
  private workflowCode: string;
  private userName: string;
  private origin: string;

  constructor(deps: { auth: AuthFetch; workflowCode: string; userName: string; origin?: string }) {
    this.auth = deps.auth;
    this.workflowCode = deps.workflowCode;
    this.userName = deps.userName;
    this.origin = resolveOrigin(deps.origin);
  }

  private get base(): string {
    return `${this.origin}/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en`;
  }

  private async fail(r: Response): Promise<never> {
    throw new HistoryError(r.status, await r.text());
  }

  async list(offset = 0): Promise<{ items: ConversationSummary[]; hasMore: boolean }> {
    const filter = `objectType='AGENT_TEAM' and createdBy~='${q(this.userName)}' and objectCode ~= '${q(this.workflowCode)}'`;
    const url = `${this.base}/userConversations?$fields=${encodeURIComponent(FIELDS)}&$filter=${encodeURIComponent(filter)}&$limit=100&$offset=${offset}`;
    const r = await this.auth.fetch("boss", url);
    if (!r.ok) return this.fail(r);
    const json = JSON.parse(await r.text());
    const items: ConversationSummary[] = (json.items ?? []).map((it: any) => ({
      id: it.id,
      name: it.name ?? "",
      createdAt: it.timeCreated,
      updatedAt: it.timeUpdated,
      etag: it.$context?.etag ?? "",
    }));
    return { items, hasMore: !!json.hasMore };
  }

  async name(id: string): Promise<string | null> {
    const r = await this.auth.fetch("boss", `${this.base}/userConversations/${encodeURIComponent(id)}?$fields=name`);
    if (r.status === 404) return null;
    if (!r.ok) return this.fail(r);
    const json = JSON.parse(await r.text());
    return json.name ?? null;
  }

  private async etag(id: string): Promise<string> {
    const r = await this.auth.fetch("boss", `${this.base}/userConversations/${encodeURIComponent(id)}?$fields=id`);
    if (!r.ok) return this.fail(r);
    let tag = r.headers.get("ETag");
    if (!tag) {
      const json = JSON.parse(await r.text());
      tag = json.$context?.etag ?? null;
    }
    if (!tag) throw new HistoryError(0, "etag missing");
    return tag.replace(/^W\//, "");
  }

  async rename(id: string, name: string): Promise<void> {
    const etag = await this.etag(id);
    const r = await this.auth.fetch("boss", `${this.base}/userConversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": etag },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) return this.fail(r);
  }

  async remove(id: string): Promise<void> {
    const etag = await this.etag(id);
    const r = await this.auth.fetch("boss", `${this.base}/userConversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "If-Match": etag },
    });
    if (!r.ok) return this.fail(r);
  }

  async messages(id: string): Promise<HistoryMessage[]> {
    const r = await this.auth.fetch("fusion-ai", `${this.origin}/api/fusion-ai/orchestrator/conversations/v1/${encodeURIComponent(id)}/messages`);
    if (!r.ok) return this.fail(r);
    const json = JSON.parse(await r.text());
    const raw: any[] = json.items ?? json.messages ?? [];
    return raw
      .filter((m) => m.type === "AI" || m.type === "USER")
      .map((m): HistoryMessage => ({ role: m.type === "AI" ? "assistant" : "user", text: String(m.text ?? "") }))
      .reverse();
  }
}
