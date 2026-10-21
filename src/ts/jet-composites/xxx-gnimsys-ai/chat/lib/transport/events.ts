export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "progress"; text: string; nodeCode?: string }
  | { type: "final"; text: string; finishReason: "stop" | "paused" | "error" }
  | { type: "followups"; questions: string[] }
  | { type: "wait"; kind: "HUMAN" | "WAIT"; token: string; message: string; approval: boolean; feedback: boolean; requestChangeMessage?: string; waitMinutes?: number }
  | { type: "job"; jobId: string }
  | { type: "error"; message: string; status?: number; code?: string }
  | { type: "done" };
