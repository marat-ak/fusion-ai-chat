export interface ConversationSummary { id: string; name: string; createdAt: string; updatedAt: string; etag: string }
export interface HistoryMessage { role: "user" | "assistant"; text: string }

export class HistoryError extends Error {
  status: number;
  body?: string;
  constructor(status: number, body?: string) {
    super(`history HTTP ${status}${body ? ": " + body : ""}`);
    this.name = "HistoryError";
    this.status = status;
    this.body = body;
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
