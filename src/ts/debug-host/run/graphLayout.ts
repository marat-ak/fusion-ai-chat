// The graph's geometry, from Studio's own canvas positions (decision 4: no layout of our own): every drawn node is a card
// of a fixed size at its Studio x/y (a LOOP keeps its own box, which encloses its body); each edge is routed orthogonally
// from the source card's exit side to the target card's entry side. Pure: RunGraph.tsx hands the result to oj-diagram's
// layout callback.
import { drawable } from "./definition";
import type { DefEdge, DefNode, WorkflowDefinition } from "./definition";

/** A card's size in Studio units (Studio's grid: columns 225 apart, rows about 220 apart). */
export const CARD = { width: 200, height: 72 } as const;

export interface GraphNodeGeometry { id: string; x: number; y: number; width: number; height: number; container: boolean }
export interface GraphEdgeGeometry { id: string; from: string; to: string; label: string; kind: DefEdge["kind"]; points: number[]; labelAt: { x: number; y: number } }

export interface GraphGeometry {
  nodes: GraphNodeGeometry[];
  edges: GraphEdgeGeometry[];
  /** The bounding box of every card. */
  bounds: { x: number; y: number; w: number; h: number };
}

function box(n: DefNode): GraphNodeGeometry {
  const container = n.type === "LOOP" && n.width !== undefined && n.height !== undefined;
  return {
    id: n.id, x: n.x as number, y: n.y as number,
    width: container ? (n.width as number) : CARD.width, height: container ? (n.height as number) : CARD.height, container,
  };
}

/**
 * Orthogonal route from `a` to `b` for a vertical canvas: down from a's bottom centre, across, down into b's top centre;
 * a target above or level with the source leaves a's side and enters b's side.
 */
function route(a: GraphNodeGeometry, b: GraphNodeGeometry): { points: number[]; labelAt: { x: number; y: number } } {
  const ax = a.x + a.width / 2, ay = a.y + a.height;
  const bx = b.x + b.width / 2, by = b.y;
  if (by > ay + 8) {
    const midY = ay + Math.min(40, (by - ay) / 2);
    const points = ax === bx ? [ax, ay, bx, by] : [ax, ay, ax, midY, bx, midY, bx, by];
    return { points, labelAt: { x: bx + 6, y: midY + 2 } };
  }
  // Upwards or sideways: out of the side facing the target, around, into the target's facing side.
  const right = b.x > a.x;
  const sx = right ? a.x + a.width : a.x, sy = a.y + a.height / 2;
  const tx = right ? b.x : b.x + b.width, ty = b.y + b.height / 2;
  const midX = (sx + tx) / 2;
  return { points: [sx, sy, midX, sy, midX, ty, tx, ty], labelAt: { x: midX + 4, y: sy - 4 } };
}

/** The geometry of a definition whose layout is complete (definition.layout.ok); throws otherwise. */
export function graphGeometry(def: WorkflowDefinition): GraphGeometry {
  if (!def.layout.ok) throw new Error("graphGeometry: the definition has no Studio positions");
  const { nodes, edges } = drawable(def);
  const geo = nodes.map(box);
  const byId = new Map(geo.map((g) => [g.id, g]));
  const out: GraphEdgeGeometry[] = edges.map((e) => {
    const r = route(byId.get(e.from) as GraphNodeGeometry, byId.get(e.to) as GraphNodeGeometry);
    return { id: e.id, from: e.from, to: e.to, label: e.label, kind: e.kind, ...r };
  });
  const xs = geo.flatMap((g) => [g.x, g.x + g.width]);
  const ys = geo.flatMap((g) => [g.y, g.y + g.height]);
  const bounds = geo.length === 0 ? { x: 0, y: 0, w: 0, h: 0 }
    : { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { nodes: geo, edges: out, bounds };
}
