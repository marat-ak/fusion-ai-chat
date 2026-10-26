import type { ArtifactVersion, PublishedVia } from "../config/types";
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
  /**
   * PUBLISHED = `/chat` (or `/debug`, see publishedVia); DRAFT = Studio's test path `/debug` (`invocationMode: "ADMIN"` +
   * `debugParams`).
   */
  version: ArtifactVersion;
  /** PUBLISHED only: `debug` sends the run through `/debug` with `status: "PUBLISHED"`; absent or `chat` = `/chat`. */
  publishedVia?: PublishedVia;
  checkVersion: string;
  /**
   * Run capture (debug hosts): yield the turn's request as a `request` event before the call, and every SSE `data:`
   * payload as a `raw` event (with its arrival time) before its parsed events.
   */
  capture?: boolean;
  /**
   * The node codes the run stops before (`debugParams.breakPoints`, Studio's breakpoints), read at every send (a resume
   * too, as the CLI's resume passes them on). Only a `/debug` run can carry them: a `/chat` run with breakpoints is refused.
   */
  breakPoints?: () => string[];
  additionalContext?: Record<string, unknown>;
  responseLanguage?: string;
  /** Signing clock in epoch seconds; signedHeaders' own clock when absent. */
  now?: () => number;
  /** Capture clock in epoch milliseconds; Date.now when absent. */
  clock?: () => number;
}

/** The turn's error when the page's rest helper cannot hand back a streaming response (nothing is sent; no buffering). */
export const STREAM_UNAVAILABLE = "chat streaming not available through this endpoint";

/** The turn's error when breakpoints are set for a `/chat` run (only Studio's `/debug` takes debugParams). */
export const BREAKPOINTS_NEED_DEBUG = "breakpoints need the debug endpoint: this run uses /chat, which has no debugParams";

const NODE_CODE = /^[A-Za-z0-9_]+$/;

/**
 * v1 transport: AI Studio v2 `/chat` SSE (PUBLISHED) or `/debug` SSE (DRAFT, or PUBLISHED with `publishedVia: "debug"`)
 * with the signed X-Ora-Ai-Api-V2-* headers through the FUAI endpoint's streaming capability; HITL resume on the same URL.
 */
export class AiStudioTransport implements ChatTransport {
  private readonly deps: AiStudioTransportDeps;
  private readonly url: string;
  /** The run goes through Studio's test path `/debug`. */
  private readonly debug: boolean;

  constructor(deps: AiStudioTransportDeps) {
    this.deps = deps;
    this.debug = deps.version === "DRAFT" || deps.publishedVia === "debug";
    this.url = `/api/fusion-ai/orchestrator/agent/v2/${encodeURIComponent(deps.workflowCode)}/${this.debug ? "debug" : "chat"}`;
  }

  /**
   * `/chat`: the Studio chat client's body. `/debug`: the same fields shaped like the CLI's debug runner (cT; resume = Wle):
   * `invocationMode: "ADMIN"`, `status: "PUBLISHED"` for the published copy (no `status` = the draft copy), `debugParams`;
   * a resume carries no run input.
   */
  private body(input: SendInput, breakPoints: string[]): Record<string, unknown> {
    const { conversationId, text, resume } = input;
    const { workflowCode, additionalContext, responseLanguage } = this.deps;
    const admin = this.debug ? { invocationMode: "ADMIN", ...(this.deps.version === "PUBLISHED" ? { status: "PUBLISHED" } : {}) } : {};
    // The CLI's debug runner block (cT): breakPoints = the codes the run stops before, [] without.
    const debugParams = { isDebug: true, breakPoints };
    if (resume) {
      return {
        message: "", workflowCode, conversationId,
        ...admin,
        ...(this.debug ? { debugParams } : {}),
        jobId: resume.jobId,
        resumeInput: { messageInstanceId: resume.token, userResponse: resume.action, ...(resume.content !== undefined ? { content: resume.content } : {}) },
        ...(resume.statusCheckOnly ? { statusCheckOnly: true } : {}),
      };
    }
    return {
      message: text, workflowCode, conversationId,
      ...admin,
      ...(additionalContext !== undefined ? { parameters: { additional_context: JSON.stringify(additionalContext) } } : {}),
      ...(responseLanguage !== undefined ? { responseLanguage } : {}),
      ...(this.debug ? { debugParams } : {}),
    };
  }

  /** The breakpoints of this send: a fresh copy of node codes; anything else is the caller's error. */
  private breakPointsNow(): string[] {
    const list = this.deps.breakPoints?.() ?? [];
    if (!Array.isArray(list) || list.some((c) => typeof c !== "string" || !NODE_CODE.test(c))) {
      throw new Error("breakPoints must be node codes ([A-Za-z0-9_]+)");
    }
    return [...list];
  }

  private static payloadEvents(payload: string): ChatEvent[] {
    const r = parseFrame(payload);
    return r.ok ? frameToEvents(r.frame) : [{ type: "error", message: "bad frame: " + r.error }];
  }

  async *send(input: SendInput, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, undefined> {
    const message = input.resume ? "" : input.text;
    const clock = this.deps.clock ?? Date.now;
    const breakPoints = this.breakPointsNow();
    if (!this.debug && breakPoints.length > 0) {
      yield { type: "error", message: BREAKPOINTS_NEED_DEBUG };
      yield { type: "done" };
      return;
    }
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(await signedHeaders(message, this.deps.checkVersion, this.deps.now?.())),
    };
    const json = this.body(input, breakPoints);
    const body = JSON.stringify(json);
    if (this.deps.capture) yield { type: "request", endpoint: this.debug ? "debug" : "chat", path: this.url, body: json, at: clock() };

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
          if (this.deps.capture) yield { type: "raw", payload: p, at: clock() };
          for (const ev of AiStudioTransport.payloadEvents(p)) yield ev;
        }
      }
      for (const p of [...splitter.push(decoder.decode()), ...splitter.flush()]) {
        if (this.deps.capture) yield { type: "raw", payload: p, at: clock() };
        for (const ev of AiStudioTransport.payloadEvents(p)) yield ev;
      }
      yield { type: "done" };
    } finally {
      signal?.removeEventListener("abort", cancel);
      cancel(); // closes the stream when the consumer stopped iterating early
    }
  }
}
