// The element property `run-observer` (debug hosts only; bridge design §13): a host that inspects runs passes an object
// with these methods. The chat then captures every turn — the request as sent, every SSE `data:` payload verbatim with its
// arrival time, the end — and reads the breakpoints (`debugParams.breakPoints`) of each `/debug` send from it. Without the
// property nothing is captured and runs carry no breakpoints. VB end-user pages never set it.

/** A turn's request, handed over right before it is sent. */
export interface RunTurnStart {
  conversationId: string;
  /** Which orchestrator path the turn uses: Studio's `/debug` or the end-user `/chat`. */
  endpoint: "chat" | "debug";
  /** The pod path of the call. */
  path: string;
  /** The JSON body as sent (a resume carries the HITL credential `resumeInput.messageInstanceId`: the host masks it). */
  body: Record<string, unknown>;
  /** Epoch milliseconds. */
  at: number;
}

/** Where one turn's stream goes. */
export interface RunTurnSink {
  /** One SSE `data:` payload exactly as received; `at` = arrival (epoch ms). */
  frame(payload: string, at: number): void;
  /** The turn ended: its stream closed, it was refused, it failed, or the chat moved on (`error` says why it failed). */
  end(info: { at: number; error?: { message: string; status?: number } }): void;
}

export interface RunObserver {
  /** The node codes the next `/debug` runs stop before; [] = none. Read at every send. */
  breakPoints(): string[];
  /** A turn starts; the returned sink receives its frames and its end. */
  turn(start: RunTurnStart): RunTurnSink;
}

/** Whether a property value is a RunObserver (both methods present). */
export function isRunObserver(v: unknown): v is RunObserver {
  const o = v as Partial<RunObserver> | null;
  return typeof o === "object" && o !== null && typeof o.breakPoints === "function" && typeof o.turn === "function";
}
