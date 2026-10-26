/** One node progress frame of the agent run (shown in the role-gated trace panel). */
export interface TraceEntry {
  /** The frame's `type`. */
  nodeType: "NODE_START" | "NODE_END" | "NODE_EXECUTED";
  nodeCode: string;
  nodeName?: string;
  /** The frame's `nodeType` (e.g. "LLM"). */
  kind?: string;
  message?: string;
  traceId?: string;
}

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "progress"; text: string; nodeCode?: string }
  | ({ type: "trace" } & TraceEntry)
  | { type: "final"; text: string; finishReason: "stop" | "paused" | "error" }
  | { type: "followups"; questions: string[] }
  | { type: "wait"; kind: "HUMAN" | "WAIT"; token: string; message: string; approval: boolean; feedback: boolean; requestChangeMessage?: string; waitMinutes?: number }
  | { type: "job"; jobId: string }
  | { type: "error"; message: string; status?: number; code?: string }
  /**
   * Run capture (the transport's `capture` on; debug hosts): the turn's request as sent, before the call — `path` the pod
   * path, `body` the JSON body, `at` epoch ms.
   */
  | { type: "request"; endpoint: "chat" | "debug"; path: string; body: Record<string, unknown>; at: number }
  /** Run capture: one SSE `data:` payload exactly as received, `at` its arrival (epoch ms). */
  | { type: "raw"; payload: string; at: number }
  | { type: "done" };
