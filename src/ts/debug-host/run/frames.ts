// One recorded turn read as a run (bridge design §13; the frame model of the 2026-10-25 HAR analysis): its node
// occurrences in order with their data and timings, the streamed text, the outcome. Pure.
//
// Frame model (Oracle's /debug stream): a "long" node emits NODE_START (input only) … NODE_END (everything); an "instant"
// node one NODE_EXECUTED. One run of a node = one NODE_EXECUTED or one START…END pair; steps are numbered in completion
// order (NODE_EXECUTED | NODE_END), the rule fai_workflow_run uses, so a step number means the same to the user and the
// builder agent. CHILD_NODE_* (nested nodes, with parentNodeCode / loopIndex) read as the plain types (as the vendored
// CLI reads them; unverified live). nodeInput/nodeOutput/nodeContext and a call's input/output are JSON strings (decode.ts);
// nodeContext is the state AFTER the node. Durations: a pair's END − START timeStamp (exact); a single frame's gap to the
// previous node frame (an upper bound: it includes the orchestrator's time between nodes); the first node has none.
// The outcome frame: {message:{finishReason, output, followUpQuestions}, jobId, conversationId, traceId}; a HITL wait adds
// waitingNodeDetails (its callbackToken is never shown or kept here); errorNodeCode (top level) is read when present.
import type { RecordedTurn } from "./runStore";
import { decode, isCut } from "./decode";

export type NodeFrameType = "NODE_START" | "NODE_END" | "NODE_EXECUTED";

export interface NodeFrame {
  /** Index into the turn's frames. */
  index: number;
  at: number;
  type: NodeFrameType;
  /** Sent as CHILD_NODE_*. */
  child: boolean;
  nodeCode: string;
  nodeName?: string;
  nodeType?: string;
  progressMessage?: string;
  timeStamp?: number;
  traceId?: string;
  parentNodeCode?: string;
  loopIndex?: number;
  /** The nodeProgressMessage object as received. */
  data: Record<string, unknown>;
}

export interface Occurrence {
  /** 1-based in completion order; null for a node that started and never ended in this stream. */
  step: number | null;
  kind: "single" | "pair" | "open";
  nodeCode: string;
  nodeName?: string;
  nodeType?: string;
  progressMessage?: string;
  start?: NodeFrame;
  /** The completing frame (NODE_EXECUTED or NODE_END); absent for "open". */
  end?: NodeFrame;
  /** Where the occurrence began in the stream (its START or its single frame): the order the run entered nodes. */
  entryIndex: number;
  timeStamp?: number;
  durationMs?: number;
  durationKind: "exact" | "upper-bound" | "none";
  input?: unknown;
  output?: unknown;
  context?: unknown;
  stepInfo?: unknown;
  /** Oracle cut the output (or a call's response) at 10 000 characters. */
  cut: boolean;
  parentNodeCode?: string;
  loopIndex?: number;
  child: boolean;
}

/** The outcome frame. `pausedNode` = message.pausedNode of a `paused` end (the CLI's reading; not seen live). */
export interface Final { finishReason: string; output?: string; followUpQuestions: string[]; pausedNode?: string }

export interface RunMetrics {
  steps: number;
  /** Last node frame's timeStamp − the first's. */
  nodeTimeMs?: number;
  llmCalls: number;
  functionCalls: number;
  tokensIn: number;
  tokensOut: number;
  cutValues: number;
}

export interface RunView {
  turn: RecordedTurn;
  occurrences: Occurrence[];
  /** The streamed answer text (TEXT deltas). */
  text: string;
  final?: Final;
  jobId?: string;
  traceIds: string[];
  /** A HITL wait (no credential). */
  wait?: { type?: string; code?: string; message?: string };
  errorNodeCode?: string;
  /** Frames that could not be read (not JSON, not an object) or of an unknown shape: index + why. */
  problems: Array<{ index: number; why: string }>;
  metrics: RunMetrics;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const TYPES: Record<string, { type: NodeFrameType; child: boolean }> = {
  NODE_START: { type: "NODE_START", child: false }, NODE_END: { type: "NODE_END", child: false }, NODE_EXECUTED: { type: "NODE_EXECUTED", child: false },
  CHILD_NODE_START: { type: "NODE_START", child: true }, CHILD_NODE_END: { type: "NODE_END", child: true }, CHILD_NODE_EXECUTED: { type: "NODE_EXECUTED", child: true },
};

/** The node frame of a parsed payload, when it is one. */
function nodeFrame(index: number, at: number, np: Record<string, unknown>): NodeFrame | null {
  const t = TYPES[str(np.type) ?? ""];
  const nodeCode = str(np.nodeCode);
  if (t === undefined || nodeCode === undefined || nodeCode === "") return null;
  const f: NodeFrame = { index, at, type: t.type, child: t.child, nodeCode, data: np };
  const nodeName = str(np.nodeName), nodeType = str(np.nodeType), pm = str(np.progressMessage), traceId = str(np.traceId);
  if (nodeName !== undefined) f.nodeName = nodeName;
  if (nodeType !== undefined) f.nodeType = nodeType;
  if (pm !== undefined) f.progressMessage = pm;
  const ts = num(np.timeStamp);
  if (ts !== undefined) f.timeStamp = ts;
  if (traceId !== undefined) f.traceId = traceId;
  const parent = str(np.parentNodeCode), loop = num(np.loopIndex);
  if (parent !== undefined && parent !== "") f.parentNodeCode = parent;
  if (loop !== undefined) f.loopIndex = loop;
  return f;
}

/** Whether a call detail (nodeStepInfo.details[]) carries a cut response. */
function stepInfoCut(stepInfo: unknown): boolean {
  if (!isObj(stepInfo) || !Array.isArray(stepInfo.details)) return false;
  return stepInfo.details.some((d) => decode(isObj(d) ? d.output : undefined).cutPaths.size > 0);
}

/** The token counts and call kinds of a node's calls. */
function callsOf(stepInfo: unknown): { llm: number; fn: number; tin: number; tout: number } {
  const out = { llm: 0, fn: 0, tin: 0, tout: 0 };
  if (!isObj(stepInfo) || !Array.isArray(stepInfo.details)) return out;
  for (const d of stepInfo.details) {
    if (!isObj(d)) continue;
    if (d.type === "LLM") out.llm++;
    else if (d.type === "FUNCTION_CALL") out.fn++;
    out.tin += num(d.inputTokens) ?? 0;
    out.tout += num(d.outputTokens) ?? 0;
  }
  return out;
}

function occurrenceOf(start: NodeFrame | undefined, end: NodeFrame | undefined, prevTs: number | undefined): Occurrence {
  const f = (end ?? start) as NodeFrame;
  const o: Occurrence = {
    step: null, kind: end === undefined ? "open" : start === undefined ? "single" : "pair",
    nodeCode: f.nodeCode, entryIndex: (start ?? f).index, durationKind: "none", cut: false, child: (start ?? f).child,
  };
  const name = end?.nodeName ?? start?.nodeName, type = end?.nodeType ?? start?.nodeType, pm = end?.progressMessage ?? start?.progressMessage;
  if (name !== undefined) o.nodeName = name;
  if (type !== undefined) o.nodeType = type;
  if (pm !== undefined) o.progressMessage = pm;
  if (start !== undefined) o.start = start;
  if (end !== undefined) o.end = end;
  const parent = f.parentNodeCode ?? start?.parentNodeCode, loop = f.loopIndex ?? start?.loopIndex;
  if (parent !== undefined) o.parentNodeCode = parent;
  if (loop !== undefined) o.loopIndex = loop;
  const ts = (start ?? f).timeStamp;
  if (ts !== undefined) o.timeStamp = ts;
  if (o.kind === "pair" && start?.timeStamp !== undefined && end?.timeStamp !== undefined) {
    o.durationMs = end.timeStamp - start.timeStamp;
    o.durationKind = "exact";
  } else if (o.kind === "single" && f.timeStamp !== undefined && prevTs !== undefined) {
    o.durationMs = f.timeStamp - prevTs;
    o.durationKind = "upper-bound";
  }
  // The data: everything is on the completing frame; an open START has its input only.
  const data = (end ?? start) as NodeFrame;
  if ("nodeInput" in data.data) o.input = data.data.nodeInput;
  else if (start !== undefined && "nodeInput" in start.data) o.input = start.data.nodeInput;
  if ("nodeOutput" in data.data) o.output = data.data.nodeOutput;
  if ("nodeContext" in data.data) o.context = data.data.nodeContext;
  if ("nodeStepInfo" in data.data) o.stepInfo = data.data.nodeStepInfo;
  o.cut = (typeof o.output === "string" && isCut(o.output)) || stepInfoCut(o.stepInfo);
  return o;
}

/** Reads a recorded turn as a run. */
export function runView(turn: RecordedTurn): RunView {
  const occurrences: Occurrence[] = [];
  const open: NodeFrame[] = [];
  const problems: RunView["problems"] = [];
  const traceIds: string[] = [];
  let text = "";
  let final: Final | undefined;
  let jobId: string | undefined;
  let wait: RunView["wait"];
  let errorNodeCode: string | undefined;
  let prevTs: number | undefined;
  let firstTs: number | undefined;
  let lastTs: number | undefined;
  let step = 0;
  turn.frames.forEach((fr, index) => {
    let v: unknown;
    try {
      v = JSON.parse(fr.payload);
    } catch (e) {
      problems.push({ index, why: `not JSON: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    if (!isObj(v)) { problems.push({ index, why: "not a JSON object" }); return; }
    let known = false;
    const tid = str(v.traceId);
    if (tid !== undefined && !traceIds.includes(tid)) traceIds.push(tid);
    if (typeof v.jobId === "string" && v.jobId !== "") { jobId = v.jobId; known = true; }
    if (typeof v.errorNodeCode === "string" && v.errorNodeCode !== "") { errorNodeCode = v.errorNodeCode; known = true; }
    if (isObj(v.nodeProgressMessage)) {
      const nf = nodeFrame(index, fr.at, v.nodeProgressMessage);
      if (nf === null) { problems.push({ index, why: "a node frame without a known type or nodeCode" }); return; }
      known = true;
      if (nf.traceId !== undefined && !traceIds.includes(nf.traceId)) traceIds.push(nf.traceId);
      if (nf.timeStamp !== undefined) {
        firstTs ??= nf.timeStamp;
        lastTs = nf.timeStamp;
      }
      if (nf.type === "NODE_START") {
        open.push(nf);
      } else if (nf.type === "NODE_END") {
        // The END closes the latest open START of the same node (and parent / loop index).
        let i = open.length - 1;
        while (i >= 0 && !(open[i].nodeCode === nf.nodeCode && open[i].parentNodeCode === nf.parentNodeCode && open[i].loopIndex === nf.loopIndex)) i--;
        const start = i >= 0 ? open.splice(i, 1)[0] : undefined;
        const o = occurrenceOf(start, nf, prevTs);
        o.step = ++step;
        occurrences.push(o);
      } else {
        const o = occurrenceOf(undefined, nf, prevTs);
        o.step = ++step;
        occurrences.push(o);
      }
      if (nf.timeStamp !== undefined) prevTs = nf.timeStamp;
    }
    if (isObj(v.message)) {
      known = true;
      const m = v.message;
      const c = m.content;
      if (typeof c === "string") text += c;
      else if (Array.isArray(c)) for (const part of c) if (isObj(part) && typeof part.text === "string") text += part.text;
      const fr2 = str(m.finishReason);
      if (fr2 !== undefined && fr2 !== "") {
        final = {
          finishReason: fr2,
          ...(typeof m.output === "string" && { output: m.output }),
          followUpQuestions: Array.isArray(m.followUpQuestions) ? m.followUpQuestions.filter((q): q is string => typeof q === "string") : [],
          ...(fr2 === "paused" && typeof m.pausedNode === "string" && m.pausedNode.trim() !== "" && { pausedNode: m.pausedNode.trim() }),
        };
      }
    }
    if (isObj(v.waitingNodeDetails)) {
      known = true;
      const w = v.waitingNodeDetails;
      wait = {
        ...(str(w.type) !== undefined && { type: str(w.type) }),
        ...(str(w.code) !== undefined && { code: str(w.code) }),
        ...(str(w.initialMessage) !== undefined && { message: str(w.initialMessage) }),
      };
    }
    if (!known && !("conversationId" in v)) problems.push({ index, why: `unknown frame (keys ${Object.keys(v).join(", ")})` });
  });
  // Nodes that started and never ended (the stream stopped or was cut): at the end, without a step number.
  for (const s of open) occurrences.push(occurrenceOf(s, undefined, undefined));

  const metrics: RunMetrics = { steps: step, llmCalls: 0, functionCalls: 0, tokensIn: 0, tokensOut: 0, cutValues: 0 };
  if (firstTs !== undefined && lastTs !== undefined) metrics.nodeTimeMs = lastTs - firstTs;
  for (const o of occurrences) {
    const c = callsOf(o.stepInfo);
    metrics.llmCalls += c.llm;
    metrics.functionCalls += c.fn;
    metrics.tokensIn += c.tin;
    metrics.tokensOut += c.tout;
    if (o.cut) metrics.cutValues++;
  }
  return {
    turn, occurrences, text, traceIds, problems, metrics,
    ...(final !== undefined && { final }),
    ...(jobId !== undefined && { jobId }),
    ...(wait !== undefined && { wait }),
    ...(errorNodeCode !== undefined && { errorNodeCode }),
  };
}

/** The decoded `$variables` of a node's context (the state after it), or undefined when it has none. */
export function variablesOf(o: Occurrence): unknown {
  const ctx = decode(o.context).value;
  return isObj(ctx) && "$variables" in ctx ? ctx.$variables : undefined;
}

/** The occurrence before `o` (completion order) that has a context, or undefined. */
export function previousWithContext(run: RunView, o: Occurrence): Occurrence | undefined {
  const i = run.occurrences.indexOf(o);
  for (let j = i - 1; j >= 0; j--) if (run.occurrences[j].context !== undefined && run.occurrences[j].step !== null) return run.occurrences[j];
  return undefined;
}

/** What the turn sent: the user's message, or the resume (HITL) action. */
export function turnInput(turn: RecordedTurn): string {
  const b = turn.request;
  if (isObj(b.resumeInput)) {
    const a = str(b.resumeInput.userResponse) ?? "resume";
    return b.statusCheckOnly === true ? "status check" : a === "APPROVE_ACTION" ? "Approve" : a === "REJECT_ACTION" ? "Reject" : a === "RFI_ACTION" ? "Request change" : a;
  }
  return str(b.message) ?? "";
}

/** The breakpoints the turn's request carried (debugParams.breakPoints), [] when none. */
export function requestedBreakpoints(turn: RecordedTurn): string[] {
  const dp = turn.request.debugParams;
  return isObj(dp) && Array.isArray(dp.breakPoints) ? dp.breakPoints.filter((c): c is string => typeof c === "string") : [];
}

/** "1.2 s", "850 ms", "≤ 71 ms" for an upper bound, "" when unknown. */
export function durationText(o: Pick<Occurrence, "durationMs" | "durationKind">): string {
  if (o.durationMs === undefined || o.durationKind === "none") return "";
  const v = o.durationMs >= 1000 ? `${(o.durationMs / 1000).toFixed(1)} s` : `${o.durationMs} ms`;
  return o.durationKind === "upper-bound" ? `≤ ${v}` : v;
}

/** Milliseconds as "9.3 s" / "850 ms". */
export function msText(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
