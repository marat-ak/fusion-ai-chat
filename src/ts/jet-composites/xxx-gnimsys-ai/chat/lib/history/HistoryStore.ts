import { fusionErrorPrefix } from "../endpoints/EndpointFetch";

export interface ConversationSummary { id: string; name: string; createdAt: string; updatedAt: string; etag: string }
export interface HistoryMessage { role: "user" | "assistant"; text: string }

export class HistoryError extends Error {
  status: number;
  body?: string;
  /** Set when the pod answered a non-error status with a Fusion error body (`o:errorCode`); the message then starts with it. */
  fusionErrorCode?: string;
  constructor(status: number, body?: string, fusionErrorCode?: string) {
    super(`${fusionErrorCode !== undefined ? fusionErrorPrefix(fusionErrorCode) : ""}history HTTP ${status}${body ? ": " + body : ""}`);
    this.name = "HistoryError";
    this.status = status;
    this.body = body;
    if (fusionErrorCode !== undefined) this.fusionErrorCode = fusionErrorCode;
  }
}

export interface HistoryStore {
  list(offset?: number): Promise<{ items: ConversationSummary[]; hasMore: boolean }>;
  /** Oldest first. */
  messages(conversationId: string): Promise<HistoryMessage[]>;
  name(conversationId: string): Promise<string | null>;
  rename(conversationId: string, name: string): Promise<void>;
  remove(conversationId: string): Promise<void>;
}
