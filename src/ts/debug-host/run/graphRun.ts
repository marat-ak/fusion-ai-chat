// A run laid onto its workflow's graph: what happened at each drawn node (its state and step numbers), which edges the
// run took, and which of the run's node codes the definition does not have (the definition changed since the run).
// Edges taken: the run entered its nodes in stream order (an occurrence's START or its single frame); for each two
// consecutive entries a → b, the outcome edge a → b (or a's error edge to b) is marked taken.
import { drawable } from "./definition";
import type { WorkflowDefinition } from "./definition";
import type { BreakpointVerdict } from "./breakpoints";
import type { Occurrence, RunView } from "./frames";

/** What the run did at a node (the card's look). */
export type NodeRunState = "done" | "cut" | "error" | "waiting" | "running" | "stopped-before" | "not-run";

export interface GraphNodeView {
  id: string;
  code: string;
  name: string;
  type: string;
  state: NodeRunState;
  /** The run's step numbers at this node (1-based, in order). */
  steps: number[];
  /** A breakpoint is set on this node. */
  breakpoint: boolean;
}

export interface RunOnGraph {
  views: Map<string, GraphNodeView>;
  taken: Set<string>;
  /** The run's node codes the definition has no node for. */
  unknownCodes: string[];
}

function stateOf(occ: Occurrence[], run: RunView, code: string): NodeRunState {
  const last = occ[occ.length - 1];
  if (last.kind === "open") return run.wait?.code === code ? "waiting" : "running";
  if (run.errorNodeCode === code) return "error";
  if (run.wait?.code === code) return "waiting";
  if (occ.some((o) => o.cut)) return "cut";
  return "done";
}

export function runOnGraph(def: WorkflowDefinition, run: RunView | null, breakpoints: readonly string[], verdict: BreakpointVerdict | null): RunOnGraph {
  const { nodes, edges } = drawable(def);
  const byNode = new Map<string, Occurrence[]>();
  const unknown = new Set<string>();
  for (const o of run?.occurrences ?? []) {
    const n = def.byCode.get(o.nodeCode);
    if (n === undefined) { unknown.add(o.nodeCode); continue; }
    byNode.set(n.id, [...(byNode.get(n.id) ?? []), o]);
  }
  const stoppedBefore = verdict?.stop?.verified === true ? verdict.stop.before : [];
  const views = new Map<string, GraphNodeView>();
  for (const n of nodes) {
    const occ = byNode.get(n.id) ?? [];
    const code = n.code as string;
    const state: NodeRunState = occ.length > 0 && run !== null ? stateOf(occ, run, code) : stoppedBefore.includes(code) ? "stopped-before" : "not-run";
    views.set(n.id, {
      id: n.id, code, name: n.name, type: n.type, state,
      steps: occ.flatMap((o) => (o.step !== null ? [o.step] : [])),
      breakpoint: breakpoints.includes(code),
    });
  }
  const taken = new Set<string>();
  if (run !== null) {
    const entered = [...run.occurrences].sort((a, b) => a.entryIndex - b.entryIndex)
      .map((o) => def.byCode.get(o.nodeCode)).filter((n): n is NonNullable<typeof n> => n !== undefined);
    for (let i = 1; i < entered.length; i++) {
      const a = entered[i - 1], b = entered[i];
      const e = edges.find((x) => x.from === a.id && x.to === b.id && x.kind === "outcome") ?? edges.find((x) => x.from === a.id && x.to === b.id);
      if (e !== undefined) taken.add(e.id);
    }
  }
  return { views, taken, unknownCodes: [...unknown] };
}

/** Where to look first: the box around the given nodes (Studio units), else the whole graph's top. */
export function focusOf(def: WorkflowDefinition, nodeIds: string[], fallback: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const pts = nodeIds.map((id) => def.byId.get(id)).filter((n) => n !== undefined && n.x !== undefined && n.y !== undefined) as Array<{ x: number; y: number }>;
  if (pts.length === 0) return { x: fallback.x, y: fallback.y, w: Math.min(fallback.w, 1400), h: Math.min(fallback.h, 1000) };
  // The nodes centred, with about two columns and two rows of their neighbours around them (Studio's grid: 225 / 220).
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: x - 450, y: y - 350, w: Math.max(...xs) - x + 1100, h: Math.max(...ys) - y + 772 };
}
