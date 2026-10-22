import type { ChatEvent } from "../transport/events";
import type { HistoryMessage } from "../history/HistoryStore";
import type { UploadedAttachment } from "../files/AttachmentService";

export interface Turn { id: string; role: "user" | "assistant"; text: string; streaming?: boolean; error?: { message: string; status?: number; code?: string }; attachments?: UploadedAttachment[] }
export interface WaitInfo { kind: "HUMAN" | "WAIT"; token: string; jobId: string; approval: boolean; feedback: boolean; requestChangeMessage?: string; waitMinutes?: number }
export interface ChatState {
  conversationId: string;
  turns: Turn[];
  status: "idle" | "sending" | "streaming" | "waiting" | "error";
  progressText?: string;
  wait?: WaitInfo;
  followups: string[];
  jobId?: string;
  historyStatus: "none" | "loading" | "loaded" | "unavailable";
  historyError?: number;
  authState: "ok" | "relogin" | "unauthorized";
  nextTurnId: number;
}
export type ChatAction =
  | { type: "user_send"; text: string; attachments?: UploadedAttachment[] }
  | { type: "event"; event: ChatEvent }
  | { type: "history_loading" } | { type: "history_loaded"; messages: HistoryMessage[] } | { type: "history_failed"; status: number }
  | { type: "new_conversation"; id: string } | { type: "open_conversation"; id: string }
  | { type: "resume_sent"; action: "APPROVE_ACTION" | "REJECT_ACTION" | "RFI_ACTION"; content?: string }
  | { type: "auth"; state: ChatState["authState"] };

export function initialState(conversationId: string): ChatState {
  return { conversationId, turns: [], status: "idle", followups: [], historyStatus: "none", authState: "ok", nextTurnId: 1 };
}

export function newConversationId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c || typeof c.randomUUID !== "function") throw new Error("crypto.randomUUID is unavailable");
  return c.randomUUID();
}

function streamingIdx(turns: Turn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "assistant" && turns[i].streaming) return i;
  return -1;
}

// Returns state with a streaming assistant turn guaranteed, plus its index.
function ensureStreaming(s: ChatState): { state: ChatState; idx: number } {
  const idx = streamingIdx(s.turns);
  if (idx >= 0) return { state: s, idx };
  const turn: Turn = { id: "t" + s.nextTurnId, role: "assistant", text: "", streaming: true };
  return { state: { ...s, turns: [...s.turns, turn], nextTurnId: s.nextTurnId + 1 }, idx: s.turns.length };
}

function patchTurn(s: ChatState, idx: number, patch: Partial<Turn>): ChatState {
  return { ...s, turns: s.turns.map((t, i) => (i === idx ? { ...t, ...patch } : t)) };
}

function appendUserAndAssistant(s: ChatState, text: string, attachments?: UploadedAttachment[]): ChatState {
  const user: Turn = { id: "t" + s.nextTurnId, role: "user", text };
  if (attachments) user.attachments = attachments;
  const asst: Turn = { id: "t" + (s.nextTurnId + 1), role: "assistant", text: "", streaming: true };
  return { ...s, turns: [...s.turns, user, asst], nextTurnId: s.nextTurnId + 2, status: "sending", followups: [] };
}

function reduceEvent(s: ChatState, e: ChatEvent): ChatState {
  switch (e.type) {
    case "delta": {
      const { state, idx } = ensureStreaming(s);
      return { ...patchTurn(state, idx, { text: state.turns[idx].text + e.text }), status: "streaming" };
    }
    case "progress":
      return { ...s, progressText: e.text };
    case "final": {
      const { state, idx } = ensureStreaming(s);
      return { ...patchTurn(state, idx, { text: e.text, streaming: false }), progressText: undefined };
    }
    case "followups":
      return { ...s, followups: [...e.questions] };
    case "job":
      return { ...s, jobId: e.jobId };
    case "wait": {
      const { state, idx } = ensureStreaming(s);
      const wait: WaitInfo = { kind: e.kind, token: e.token, jobId: s.jobId ?? "", approval: e.approval, feedback: e.feedback };
      if (e.requestChangeMessage !== undefined) wait.requestChangeMessage = e.requestChangeMessage;
      if (e.waitMinutes !== undefined) wait.waitMinutes = e.waitMinutes;
      return { ...patchTurn(state, idx, { text: e.message, streaming: false }), status: "waiting", wait, progressText: undefined };
    }
    case "error": {
      const error = { message: e.message, status: e.status, code: e.code };
      // The error belongs to the reply in progress, even when a `final` (finishReason "error") already ended its stream.
      const lastIdx = s.turns.length - 1;
      const last = s.turns[lastIdx];
      const inTurn = s.status === "sending" || s.status === "streaming";
      if (inTurn && last && last.role === "assistant" && !last.error) {
        return {
          ...patchTurn(s, lastIdx, { text: last.text === "" ? e.message : last.text, streaming: false, error }),
          status: "error",
          progressText: undefined,
        };
      }
      const turn: Turn = { id: "t" + s.nextTurnId, role: "assistant", text: e.message, streaming: false, error };
      return { ...s, turns: [...s.turns, turn], nextTurnId: s.nextTurnId + 1, status: "error", progressText: undefined };
    }
    case "done": {
      const last = [...s.turns].reverse().find(t => t.role === "assistant");
      const status: ChatState["status"] = s.wait ? "waiting" : last?.error ? "error" : "idle";
      return { ...s, status, progressText: undefined };
    }
  }
}

export function reduce(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "user_send":
      return appendUserAndAssistant(state, action.text, action.attachments);
    case "event":
      return reduceEvent(state, action.event);
    case "history_loading":
      return { ...state, historyStatus: "loading", historyError: undefined };
    case "history_loaded": {
      let n = state.nextTurnId;
      const turns: Turn[] = action.messages.map(m => ({ id: "t" + n++, role: m.role, text: m.text, streaming: false }));
      return { ...state, turns, nextTurnId: n, historyStatus: "loaded", historyError: undefined };
    }
    case "history_failed":
      return { ...state, historyStatus: "unavailable", historyError: action.status };
    case "new_conversation":
      return { ...initialState(action.id), authState: state.authState };
    case "open_conversation":
      return { ...initialState(action.id), historyStatus: "loading", authState: state.authState };
    case "resume_sent": {
      const text = action.action === "APPROVE_ACTION" ? "Approved" : action.action === "REJECT_ACTION" ? "Rejected" : action.content ?? "";
      const { wait: _wait, ...rest } = appendUserAndAssistant(state, text);
      return rest;
    }
    case "auth":
      return { ...state, authState: action.state };
  }
}
