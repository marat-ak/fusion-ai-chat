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
  /** One SSE `data:` payload exactly as received (only with the transport's `rawFrames` on). */
  | { type: "raw"; payload: string }
  | { type: "done" };
