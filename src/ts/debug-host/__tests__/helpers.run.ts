// Test helpers of the debugger's run modules: recorded turns from SSE text and the golden fixtures (a real 72-node DRAFT
// workflow and two real /debug turns of it, sanitized: tests/mock-pod/fixtures/debug-wizard-*).
import * as fs from "fs";
import * as path from "path";
import type { RecordedTurn } from "../run/runStore";

const FIXTURES = path.resolve(process.cwd(), "tests", "mock-pod", "fixtures");
export const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");
export const goldenWorkflow = (): Record<string, unknown> => JSON.parse(fixture("debug-wizard-workflow.json"));

/** The `data:` payloads of SSE text, in order. */
export const payloadsOf = (sse: string): string[] => sse.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart());

/** A recorded turn of the given payloads (arrival times 1000, 1001, …). */
export function turnOf(payloads: string[], request: Record<string, unknown> = { message: "start", workflowCode: "WIZARD_WF", conversationId: "c-1" }, seq = 1): RecordedTurn {
  return {
    seq, conversationId: String(request.conversationId ?? "c-1"), endpoint: "debug", path: "/api/fusion-ai/orchestrator/agent/v2/WIZARD_WF/debug",
    request, sentAt: 900, frames: payloads.map((payload, i) => ({ payload, at: 1000 + i })), endedAt: 2000,
  };
}

export const goldenTurn = (n: 1 | 2, request?: Record<string, unknown>): RecordedTurn => turnOf(payloadsOf(fixture(`debug-wizard-turn${n}.sse`)), request, n);

/** A node frame payload. */
export function node(type: string, code: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ nodeProgressMessage: { type, nodeCode: code, nodeName: code, nodeType: "CODE", progressMessage: `p ${code}`, traceId: "t-1", ...extra } });
}
export const finalFrame = (finishReason: string, output: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ message: { finishReason, output, followUpQuestions: [] }, jobId: "job-1", conversationId: "c-1", traceId: "t-1", ...extra });
