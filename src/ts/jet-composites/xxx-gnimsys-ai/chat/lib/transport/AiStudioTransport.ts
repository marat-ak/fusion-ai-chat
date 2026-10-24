import type { ArtifactVersion } from "../config/types";
import { EndpointError, endpointBodyText } from "../endpoints/EndpointFetch";
import type { EndpointFetch } from "../endpoints/EndpointFetch";
import type { ChatEvent } from "./events";
import type { ChatTransport, SendInput } from "./ChatTransport";
import { errorText } from "./errorText";
import { createSseDataSplitter, frameToEvents, parseFrame } from "./sseParser";
import { signedHeaders } from "./signer";

export interface AiStudioTransportDeps {
  endpoints: EndpointFetch;
  workflowCode: string;
  /** PUBLISHED = `/chat`; DRAFT = Studio's test path `/debug` (`invocationMode: "ADMIN"` + `debugParams`). */
  version: ArtifactVersion;
  checkVersion: string;
  /** Yield every SSE `data:` payload as a `raw` event before its parsed events (debug hosts). */
  rawFrames?: boolean;
  additionalContext?: Record<string, unknown>;
  responseLanguage?: string;
  /** Signing clock in epoch seconds; signedHeaders' own clock when absent. */
  now?: () => number;
}

/** The turn's error when the page's rest helper cannot hand back a streaming response (nothing is sent; no buffering). */
export const STREAM_UNAVAILABLE = "chat streaming not available through this endpoint";

/** The draft run's debug block, as the vendored Oracle aistudio CLI's own debug runner sends it (no breakpoints). */
const DEBUG_PARAMS = { isDebug: true, breakPoints: [] as string[] };

/**
 * v1 transport: AI Studio v2 `/chat` SSE (PUBLISHED) or `/debug` SSE (DRAFT) with the signed X-Ora-Ai-Api-V2-* headers
 * through the FUAI endpoint's streaming capability; HITL resume on the same URL.
 */
export class AiStudioTransport implements ChatTransport {
  private readonly deps: AiStudioTransportDeps;
  private readonly url: string;

  constructor(deps: AiStudioTransportDeps) {
    this.deps = deps;
    this.url = `/api/fusion-ai/orchestrator/agent/v2/${encodeURIComponent(deps.workflowCode)}/${deps.version === "DRAFT" ? "debug" : "chat"}`;
  }

  /**
   * PUBLISHED: the Studio chat client's body. DRAFT: the same fields shaped like the CLI's debug runner (cT; resume = Wle):
   * `invocationMode: "ADMIN"`, no `status` (= the draft copy), `debugParams`; a resume carries no run input.
   */
  private body(input: SendInput): Record<string, unknown> {
    const { conversationId, text, resume } = input;
    const { workflowCode, additionalContext, responseLanguage } = this.deps;
    const draft = this.deps.version === "DRAFT";
    if (resume) {
      return {
        message: "", workflowCode, conversationId,
        ...(draft ? { invocationMode: "ADMIN", debugParams: DEBUG_PARAMS } : {}),
        jobId: resume.jobId,
        resumeInput: { messageInstanceId: resume.token, userResponse: resume.action, ...(resume.content !== undefined ? { content: resume.content } : {}) },
        ...(resume.statusCheckOnly ? { statusCheckOnly: true } : {}),
      };
    }
    return {
      message: text, workflowCode, conversationId,
      ...(draft ? { invocationMode: "ADMIN" } : {}),
      ...(additionalContext !== undefined ? { parameters: { additional_context: JSON.stringify(additionalContext) } } : {}),
      ...(responseLanguage !== undefined ? { responseLanguage } : {}),
      ...(draft ? { debugParams: DEBUG_PARAMS } : {}),
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
    const body = JSON.stringify(this.body(input));

    let res: Response;
    try {
      res = await this.deps.endpoints.stream("FUAI", this.url, { method: "POST", headers, body, ...(signal && { signal }) });
    } catch (e) {
      if (signal?.aborted) { yield { type: "done" }; return; }
      if (e instanceof EndpointError && e.kind === "stream-unavailable") {
        yield { type: "error", message: STREAM_UNAVAILABLE };
        yield { type: "done" };
        return;
      }
      if (e instanceof EndpointError && e.kind === "http" && e.status !== 401) {
        const text = endpointBodyText(e.body) ?? "";
        const err: ChatEvent = { type: "error", status: e.status, message: errorText(text) || e.statusText || `HTTP ${e.status}` };
        const code = /FAI-\d+/.exec(text);
        if (code) err.code = code[0];
        yield err;
        yield { type: "done" };
        return;
      }
      throw e; // 401 (re-login), a refused URL, no HTTP answer: the caller owns these states
    }

    // A 2xx that is not this endpoint's SSE (a login page, a proxy answer, a redirect hop) is an explicit failure.
    const contentType = res.headers.get("content-type") ?? "";
    const notSse = res.redirected === true
      ? `redirected to ${res.url}`
      : contentType.toLowerCase().startsWith("text/event-stream") ? null : `non-SSE response (${contentType || "no content-type"})`;
    if (notSse !== null) {
      res.body?.cancel().catch(() => undefined);
      yield { type: "error", status: res.status, message: notSse };
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
          if (this.deps.rawFrames) yield { type: "raw", payload: p };
          for (const ev of AiStudioTransport.payloadEvents(p)) yield ev;
        }
      }
      for (const p of [...splitter.push(decoder.decode()), ...splitter.flush()]) {
        if (this.deps.rawFrames) yield { type: "raw", payload: p };
        for (const ev of AiStudioTransport.payloadEvents(p)) yield ev;
      }
      yield { type: "done" };
    } finally {
      signal?.removeEventListener("abort", cancel);
      cancel(); // closes the stream when the consumer stopped iterating early
    }
  }
}
