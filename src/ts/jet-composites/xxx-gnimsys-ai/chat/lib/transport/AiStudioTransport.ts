import type { AuthFetch } from "../auth/AuthFetch";
import type { ChatEvent } from "./events";
import type { ChatTransport, SendInput } from "./ChatTransport";
import { createSseDataSplitter, frameToEvents, parseFrame } from "./sseParser";
import { signedHeaders } from "./signer";

export interface AiStudioTransportDeps {
  auth: AuthFetch;
  workflowCode: string;
  checkVersion: string;
  additionalContext?: Record<string, unknown>;
  responseLanguage?: string;
  origin?: string;
  /** Signing clock in epoch seconds; signedHeaders' own clock when absent. */
  now?: () => number;
}

/** v1 transport: AI Studio v2 `/chat` SSE with the signed X-Ora-Ai-Api-V2-* headers; HITL resume on the same URL. */
export class AiStudioTransport implements ChatTransport {
  private readonly deps: AiStudioTransportDeps;
  private readonly url: string;

  constructor(deps: AiStudioTransportDeps) {
    const origin = deps.origin ?? globalThis.location?.origin;
    if (!origin) throw new Error("AiStudioTransport: origin unavailable");
    this.deps = deps;
    this.url = `${origin}/api/fusion-ai/orchestrator/agent/v2/${encodeURIComponent(deps.workflowCode)}/chat`;
  }

  private body(input: SendInput): Record<string, unknown> {
    const { conversationId, text, resume } = input;
    const { workflowCode, additionalContext, responseLanguage } = this.deps;
    if (resume) {
      return {
        message: "", workflowCode, conversationId, jobId: resume.jobId,
        resumeInput: { messageInstanceId: resume.token, userResponse: resume.action, ...(resume.content !== undefined ? { content: resume.content } : {}) },
        ...(resume.statusCheckOnly ? { statusCheckOnly: true } : {}),
      };
    }
    return {
      message: text, workflowCode, conversationId,
      ...(additionalContext !== undefined ? { parameters: { additional_context: JSON.stringify(additionalContext) } } : {}),
      ...(responseLanguage !== undefined ? { responseLanguage } : {}),
    };
  }

  private static payloadEvents(payload: string): ChatEvent[] {
    const r = parseFrame(payload);
    return r.ok ? frameToEvents(r.frame) : [{ type: "error", message: "bad frame: " + r.error }];
  }

  async *send(input: SendInput, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, undefined> {
    const message = input.resume ? "" : input.text;
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(await signedHeaders(message, this.deps.checkVersion, this.deps.now?.())),
    };
    const init: RequestInit = { method: "POST", headers, body: JSON.stringify(this.body(input)) };
    if (signal) init.signal = signal;

    let res: Response;
    try {
      res = await this.deps.auth.fetch("fusion-ai", this.url, init);
    } catch (e) {
      if (signal?.aborted) { yield { type: "done" }; return; }
      throw e; // AuthError / network failure: the caller owns these states
    }

    if (!res.ok) {
      const text = await res.text();
      const err: ChatEvent = { type: "error", status: res.status, message: text || res.statusText || `HTTP ${res.status}` };
      const code = /FAI-\d+/.exec(text);
      if (code) err.code = code[0];
      yield err;
      yield { type: "done" };
      return;
    }
    if (!res.body) {
      yield { type: "error", message: "empty response" };
      yield { type: "done" };
      return;
    }

    const reader = res.body.getReader();
    // Cancelling resolves a pending read() with done:true; a cancel on an ended stream is a no-op.
    const cancel = (): void => { reader.cancel().catch(() => undefined); };
    signal?.addEventListener("abort", cancel);
    if (signal?.aborted) cancel();
    try {
      const decoder = new TextDecoder("utf-8");
      const splitter = createSseDataSplitter();
      for (;;) {
        const r = await reader.read().catch((e: unknown) => {
          if (signal?.aborted) return { done: true as const, value: undefined };
          throw e;
        });
        if (signal?.aborted) { yield { type: "done" }; return; }
        if (r.done) break;
        for (const p of splitter.push(decoder.decode(r.value, { stream: true }))) {
          for (const ev of AiStudioTransport.payloadEvents(p)) yield ev;
        }
      }
      for (const p of [...splitter.push(decoder.decode()), ...splitter.flush()]) {
        for (const ev of AiStudioTransport.payloadEvents(p)) yield ev;
      }
      yield { type: "done" };
    } finally {
      signal?.removeEventListener("abort", cancel);
      cancel(); // closes the stream when the consumer stopped iterating early
    }
  }
}
