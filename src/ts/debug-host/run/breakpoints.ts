// Did a turn stop at one of its breakpoints? The rule of fai_workflow_run (fusion-ai-mcp run.js breakpointsOf), so the
// debugger and the builder agent label the same run the same way. A breakpoint (debugParams.breakPoints) stops the run
// BEFORE the node: the stream ends `stop` with the last executed node's output as the output (verified on a pod, Studio
// HAR 2026-10-25). The stream alone cannot tell such a stop from a normal finish whose path never reached the node, so a
// stop is labelled VERIFIED only when the output equals the last executed node's output AND a not-executed requested node
// is a direct graph successor of the last executed node (an outcome target, or the entry of a successor LOOP's body);
// otherwise the label says why it is unverified. `paused` + `pausedNode` (the CLI's reading, not seen live) is read too.
import { decode } from "./decode";
import type { WorkflowDefinition } from "./definition";
import { requestedBreakpoints } from "./frames";
import type { RunView } from "./frames";

export type StopLabel =
  | { verified: true; before: string[]; paused: boolean }
  | { verified: false; reason: string };

export interface BreakpointVerdict {
  requested: string[];
  notExecuted: string[];
  lastExecuted: string | null;
  /** Present when the turn looks stopped by a breakpoint (a `stop`/`paused` end with requested nodes not executed). */
  stop?: StopLabel;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(decode(a).value) === JSON.stringify(decode(b).value);

/** The requested codes the run would have entered right after `lastCode`, by the graph. */
export function nextOf(def: WorkflowDefinition, lastCode: string, codes: string[]): string[] {
  const last = def.byCode.get(lastCode);
  if (last === undefined) return [];
  const hits = new Set<string>();
  for (const e of def.edges) {
    if (e.from !== last.id || e.kind !== "outcome") continue;
    const s = def.byId.get(e.to);
    if (s === undefined) continue;
    if (s.code !== undefined && codes.includes(s.code)) hits.add(s.code);
    if (s.bodyEntryId !== undefined) {
      const entry = def.byId.get(s.bodyEntryId);
      if (entry?.code !== undefined && codes.includes(entry.code)) hits.add(entry.code);
    }
  }
  return [...hits];
}

/** The verdict of a turn that requested breakpoints; null when it requested none. `def` null = no graph to check with. */
export function breakpointVerdict(run: RunView, def: WorkflowDefinition | null): BreakpointVerdict | null {
  const requested = requestedBreakpoints(run.turn);
  if (requested.length === 0) return null;
  const done = run.occurrences.filter((o) => o.step !== null);
  const ran = new Set(done.map((o) => o.nodeCode));
  const notExecuted = requested.filter((c) => !ran.has(c));
  const last = done.length > 0 ? done[done.length - 1] : null;
  const lastExecuted = last?.nodeCode ?? null;
  const verdict: BreakpointVerdict = { requested, notExecuted, lastExecuted };
  const fin = run.final;
  const pausedNode = fin?.finishReason === "paused" && run.wait === undefined ? fin.pausedNode ?? null : null;
  const pausedAt = pausedNode !== null && requested.includes(pausedNode) ? pausedNode : null;
  if (pausedAt === null && (fin?.finishReason !== "stop" || notExecuted.length === 0)) return verdict;
  const lastOutput = last !== null && last.output !== undefined && same(fin?.output, last.output);
  if (pausedAt !== null) {
    verdict.stop = lastOutput ? { verified: true, before: [pausedAt], paused: true }
      : { verified: false, reason: `paused before ${pausedAt}, but the output is not the last executed node's output` };
    return verdict;
  }
  const codes = notExecuted.join(", ");
  if (!lastOutput) {
    verdict.stop = { verified: false, reason: `${codes} did not execute, but the output is not the last executed node's output as a breakpoint stop's is — the path may never have reached ${codes}` };
    return verdict;
  }
  if (def === null) {
    verdict.stop = { verified: false, reason: `the output equals the last executed node's output; without the workflow graph it cannot be checked that ${codes} follows ${lastExecuted}` };
    return verdict;
  }
  const next = lastExecuted !== null ? nextOf(def, lastExecuted, notExecuted) : [];
  verdict.stop = next.length > 0 ? { verified: true, before: next, paused: false }
    : { verified: false, reason: `the output equals the last executed node's output, but ${codes} does not follow ${lastExecuted} in the graph` };
  return verdict;
}

/** The `nodes` field of the agent's breakpoints message: "" (none) or comma-separated node codes. */
export const BREAKPOINT_NODES = /^(|[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*)$/;

/** Parses the `nodes` field; throws on a malformed value or a duplicate. */
export function parseBreakpointNodes(nodes: string): string[] {
  if (!BREAKPOINT_NODES.test(nodes)) throw new Error("nodes must be \"\" or node codes separated by commas");
  const list = nodes === "" ? [] : nodes.split(",");
  const dup = list.filter((c, i) => list.indexOf(c) !== i);
  if (dup.length > 0) throw new Error(`nodes names ${[...new Set(dup)].join(", ")} twice`);
  return list;
}
