// The debug conversation as one JSON file (bridge design §13, decision 7), built in the page from its own record
// (runStore.ts) — no server round trip: the binding (instance, pod user, workflow, version), the breakpoints, and every
// turn of every conversation run in this page: the request as sent (message, workflowCode, version/status, debugParams
// with its breakpoints), every raw SSE frame in arrival order with its time, the outcome, the job and trace ids, the
// timestamps. Credential-bearing values are masked with the pod proxy recording's own marker and key list (the
// fusion-ai-agent FUAI redactKeys: Oracle's HITL resume credential callbackToken / resumeInput.messageInstanceId and the
// precautionary header/token/secret names), in the request and in every frame, inside JSON strings too.
import type { RecordedTurn } from "./runStore";
import { runView } from "./frames";

/** The pod proxy recording's marker for a masked value. */
export const MASK = "[redacted]";

/** The keys whose string values are masked (the pod proxy's FUAI redactKeys). */
export const MASKED_KEYS: readonly string[] = [
  "callbackToken", "messageInstanceId",
  "Authorization", "authorization", "Cookie", "cookie", "Set-Cookie", "set-cookie",
  "access_token", "refresh_token", "id_token", "client_secret",
  "password", "clientSecret", "apiKey", "api_key", "X-API-Key", "x-api-key",
];

/** How deep masking follows JSON inside JSON strings (Oracle's deepest is 2). */
const MASK_DEPTH = 3;

const looksJson = (s: string): boolean => {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
};

/** A copy of `v` with every string under a masked key replaced; `count` counts the replacements. */
export function mask(v: unknown, count: { n: number }, depth = 0): unknown {
  if (typeof v === "string") {
    if (depth < MASK_DEPTH && looksJson(v)) {
      try {
        const before = count.n;
        const inner = mask(JSON.parse(v), count, depth + 1);
        return count.n > before ? JSON.stringify(inner) : v; // untouched strings stay byte for byte
      } catch {
        return v;
      }
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => mask(x, count, depth));
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (MASKED_KEYS.includes(k) && typeof x === "string") { o[k] = MASK; count.n++; }
      else o[k] = mask(x, count, depth);
    }
    return o;
  }
  return v;
}

/** A raw frame payload, masked: a JSON payload is re-serialised only when something was masked; other text stays. */
export function maskPayload(payload: string, count: { n: number }): string {
  let v: unknown;
  try {
    v = JSON.parse(payload);
  } catch {
    return payload;
  }
  const before = count.n;
  const m = mask(v, count);
  return count.n > before ? JSON.stringify(m) : payload;
}

export interface ExportBinding {
  /** The conversation-scoped pod proxy base the page was opened with. */
  pod: string;
  instance: string;
  podUser?: string;
  workflowCode: string;
  version: string;
}

export interface ExportFile {
  kind: "gnimsys-ai-chat-debug-export";
  formatVersion: 1;
  exportedAt: string;
  binding: ExportBinding;
  breakpoints: string[];
  /** How many credential values were masked. */
  masked: number;
  conversations: Array<{
    conversationId: string;
    turns: Array<{
      seq: number;
      sentAt: string;
      endedAt?: string;
      endpoint: string;
      path: string;
      request: unknown;
      error?: { message: string; status?: number };
      outcome?: { finishReason: string; output?: string; followUpQuestions: string[] };
      jobId?: string;
      traceIds: string[];
      steps: number;
      definitionVersion?: unknown;
      frames: Array<{ at: string; payload: string }>;
    }>;
  }>;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** The export of the given turns (in their order), conversations in the order they first ran. */
export function buildExport(turns: readonly RecordedTurn[], binding: ExportBinding, breakpoints: readonly string[], now: number): ExportFile {
  const count = { n: 0 };
  const conversations: ExportFile["conversations"] = [];
  for (const t of turns) {
    let conv = conversations.find((c) => c.conversationId === t.conversationId);
    if (conv === undefined) {
      conv = { conversationId: t.conversationId, turns: [] };
      conversations.push(conv);
    }
    const run = runView(t);
    const fin = run.final;
    // The outcome's text can carry nothing secret by itself, but it is masked like everything else for one rule.
    conv.turns.push({
      seq: t.seq,
      sentAt: iso(t.sentAt),
      ...(t.endedAt !== undefined && { endedAt: iso(t.endedAt) }),
      endpoint: t.endpoint,
      path: t.path,
      request: mask(t.request, count),
      ...(t.error !== undefined && { error: t.error }),
      ...(fin !== undefined && { outcome: mask({ finishReason: fin.finishReason, ...(fin.output !== undefined && { output: fin.output }), followUpQuestions: fin.followUpQuestions }, count) as NonNullable<ExportFile["conversations"][number]["turns"][number]["outcome"]> }),
      ...(run.jobId !== undefined && { jobId: run.jobId }),
      traceIds: run.traceIds,
      steps: run.metrics.steps,
      ...(t.definitionVersion !== undefined && { definitionVersion: t.definitionVersion }),
      frames: t.frames.map((f) => ({ at: iso(f.at), payload: maskPayload(f.payload, count) })),
    });
  }
  return {
    kind: "gnimsys-ai-chat-debug-export", formatVersion: 1, exportedAt: iso(now), binding, breakpoints: [...breakpoints],
    masked: count.n, conversations,
  };
}

/** The file name: workflow, version and the export time (no instance or user in it). */
export function exportFileName(binding: ExportBinding, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `debug-${binding.workflowCode}-${binding.version}-${stamp}.json`;
}
