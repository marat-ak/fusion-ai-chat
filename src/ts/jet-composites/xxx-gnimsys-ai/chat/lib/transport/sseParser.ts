import type { ChatEvent } from "./events";

export type { ChatEvent };

/** Splits an SSE text stream into complete `data:` payloads, keeping partial lines across push() calls. */
export function createSseDataSplitter(): { push(chunk: string): string[]; flush(): string[] } {
  let tail = "";
  const take = (line: string, out: string[]): void => {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.startsWith("data:")) return; // event:, id:, ": ping", blank, anything else
    let p = line.slice(5);
    if (p.startsWith(" ")) p = p.slice(1);
    if (p === "" || p === "[DONE]") return;
    out.push(p);
  };
  return {
    push(chunk: string): string[] {
      const out: string[] = [];
      const buf = tail + chunk;
      const parts = buf.split("\n");
      tail = parts.pop() as string;
      for (const l of parts) take(l, out);
      return out;
    },
    flush(): string[] {
      const out: string[] = [];
      take(tail, out);
      tail = "";
      return out;
    },
  };
}

export interface AiStudioFrame { jobId?: string; conversationId?: string; nodeProgressMessage?: { type: string; progressMessage?: string; nodeCode?: string }; message?: { content?: { text?: string }[]; output?: string; finishReason?: string; followUpQuestions?: string[] }; waitingNodeDetails?: { type: "HUMAN" | "WAIT"; initialMessage?: string; callbackToken: string; approvalEnabledFlag?: boolean; feedbackEnabledFlag?: boolean; requestChangeMessage?: string; waitTimeInMinutes?: number }; errorNodeCode?: string; }

export function parseFrame(payload: string): { ok: true; frame: AiStudioFrame } | { ok: false; error: string } {
  try {
    const v = JSON.parse(payload);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "frame is not a JSON object" };
    return { ok: true, frame: v as AiStudioFrame };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function frameToEvents(frame: AiStudioFrame): ChatEvent[] {
  const ev: ChatEvent[] = [];
  if (typeof frame.jobId === "string" && frame.jobId) ev.push({ type: "job", jobId: frame.jobId });
  const np = frame.nodeProgressMessage;
  if (np && np.type !== "NODE_EXECUTED") {
    const e: ChatEvent = { type: "progress", text: np.progressMessage ?? "" };
    if (np.nodeCode !== undefined) e.nodeCode = np.nodeCode;
    ev.push(e);
  }
  const m = frame.message;
  const delta = m?.content?.[0]?.text;
  if (typeof delta === "string") ev.push({ type: "delta", text: delta });
  // Unset = absent, null or "" (Oracle client semantics: a finishReason is set when truthy).
  const fr = m?.finishReason;
  if (fr === "wait") {
    const wd = frame.waitingNodeDetails;
    if (wd && wd.callbackToken) {
      const e: ChatEvent = {
        type: "wait", kind: wd.type, token: wd.callbackToken, message: wd.initialMessage ?? "",
        approval: wd.approvalEnabledFlag === true, feedback: wd.feedbackEnabledFlag === true,
      };
      if (wd.requestChangeMessage !== undefined) e.requestChangeMessage = wd.requestChangeMessage;
      if (wd.waitTimeInMinutes !== undefined) e.waitMinutes = wd.waitTimeInMinutes;
      ev.push(e);
    } else {
      ev.push({ type: "error", message: "wait without callbackToken" });
    }
  } else if (fr === "stop" || fr === "paused" || fr === "error") {
    if (typeof m?.output === "string") {
      ev.push({ type: "final", text: m.output, finishReason: fr });
      if (fr === "error") {
        const e: ChatEvent = { type: "error", message: m.output };
        if (frame.errorNodeCode !== undefined) e.code = frame.errorNodeCode;
        ev.push(e);
      }
    }
  } else if (fr !== undefined && fr !== null && fr !== "") {
    ev.push({ type: "error", message: `unknown finishReason ${fr}` });
  }
  if (m?.followUpQuestions && m.followUpQuestions.length > 0) ev.push({ type: "followups", questions: m.followUpQuestions });
  return ev;
}
