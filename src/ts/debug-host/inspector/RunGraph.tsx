// The run drawn on the workflow's graph: JET's classic oj-diagram (the Core Pack has no diagram), nodes at Studio's own
// canvas positions (graphLayout.ts), each card coloured by what the run did there, the taken edges drawn strong. Pan,
// zoom and the overview window are oj-diagram's own; clicking a card selects it (onSelect); the round marker at a card's
// top-right corner adds or removes its breakpoint ("stop before", onToggleBreakpoint) right on the map.
import "ojs/ojdiagram";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { GraphGeometry } from "../run/graphLayout";

import type { GraphNodeView } from "../run/graphRun";

export interface RunGraphProps {
  geometry: GraphGeometry;
  views: Map<string, GraphNodeView>;
  /** Edge ids the run took. */
  taken: Set<string>;
  showErrorEdges: boolean;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** The page's breakpoints (the cards' markers show them). */
  breakpoints: readonly string[];
  /** The breakpoint marker of a card was clicked: add or remove "stop before" that node. */
  onToggleBreakpoint: (code: string) => void;
  /** The part of the canvas shown first (Studio units); the whole graph when absent. */
  focus?: { x: number; y: number; w: number; h: number };
}

const SVG = "http://www.w3.org/2000/svg";
function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface NodeItem { id: string; view: GraphNodeView; x: number; y: number; width: number; height: number; container: boolean }
interface LinkItem { id: string; startNode: string; endNode: string; svgClassName: string; label?: string; points: number[]; labelAt: { x: number; y: number } }

// One object for the whole page life: a new overview object on a re-render is a property change, and oj-diagram 19 then
// re-renders with the overview's sizes unset (NaN rects in the console) and the viewport reset.
const OVERVIEW = { rendered: "on" };

const markerTitle = (code: string, on: boolean): string =>
  (on ? `Remove the breakpoint: the next runs stop before ${code}` : `Stop before ${code} on the next runs`);

/**
 * The breakpoint markers drawn in the diagram follow the set without a diagram data change (a data change re-runs the
 * layout, which resets the user's pan and zoom).
 */
function paintMarkers(root: Element, on: ReadonlySet<string>): void {
  for (const m of root.querySelectorAll("[data-breakpoint-toggle]")) {
    const code = m.getAttribute("data-breakpoint-toggle") ?? "";
    m.classList.toggle("dbg-node__bp--on", on.has(code));
    const title = m.querySelector("title");
    if (title !== null) title.textContent = markerTitle(code, on.has(code));
  }
}

/**
 * A node card (custom SVG: oj-diagram draws node content through a renderer): a rounded box in the state's colours, the
 * code, the type, and the run's step numbers. A LOOP is drawn as a frame around its body, under it. `breakpoints` = the
 * set at the time the card is drawn (paintMarkers keeps drawn cards current).
 */
function renderNode(ctx: { itemData: NodeItem; state?: { selected?: boolean; hovered?: boolean } }, breakpoints: ReadonlySet<string>): { insert: SVGElement } {
  const { view, width, height, container } = ctx.itemData;
  const on = breakpoints.has(view.code);
  const g = el("g", { class: `dbg-node dbg-node--${view.state}${ctx.state?.selected ? " dbg-node--selected" : ""}`, "data-node-code": view.code });
  g.appendChild(el("rect", { class: container ? "dbg-node__frame" : "dbg-node__box", x: 0, y: 0, width, height, rx: 10, ry: 10 }));
  g.appendChild(el("text", { class: "dbg-node__code", x: 12, y: 26 }, clip(view.code, 19)));
  g.appendChild(el("text", { class: "dbg-node__type", x: 12, y: 50 }, view.type));
  if (view.steps.length > 0) {
    const label = view.steps.length > 3 ? `#${view.steps[0]}…#${view.steps[view.steps.length - 1]} ×${view.steps.length}` : view.steps.map((s) => `#${s}`).join(" ");
    g.appendChild(el("text", { class: "dbg-node__steps", x: width - 12, y: 50, "text-anchor": "end" }, label));
  }
  // The breakpoint marker (custom SVG, see above): filled = the next runs stop before this node; hollow = click to set.
  const bp = el("g", { class: `dbg-node__bp${on ? " dbg-node__bp--on" : ""}`, "data-breakpoint-toggle": view.code, role: "button" });
  bp.appendChild(el("title", {}, markerTitle(view.code, on)));
  bp.appendChild(el("circle", { class: "dbg-node__bp-hit", cx: width - 16, cy: 16, r: 14 }));
  bp.appendChild(el("circle", { class: "dbg-node__bp-dot", cx: width - 16, cy: 16, r: 8 }));
  g.appendChild(bp);
  return { insert: g };
}

export function RunGraph(props: RunGraphProps) {
  const { geometry, views, taken, showErrorEdges } = props;
  const nodeData = useMemo(() => new ArrayDataProvider<string, NodeItem>(
    geometry.nodes.flatMap((g) => {
      const view = views.get(g.id);
      return view === undefined ? [] : [{ id: g.id, view, x: g.x, y: g.y, width: g.width, height: g.height, container: g.container }];
    }),
    { keyAttributes: "id" },
  ), [geometry, views]);
  const linkData = useMemo(() => new ArrayDataProvider<string, LinkItem>(
    geometry.edges.filter((e) => e.kind === "outcome" || showErrorEdges).map((e) => {
      const state = taken.has(e.id) ? "taken" : "idle";
      const labelled = e.label !== "success" && e.kind === "outcome";
      return {
        id: e.id, startNode: e.from, endNode: e.to, points: e.points, labelAt: e.labelAt,
        svgClassName: `dbg-link dbg-link--${state}${e.kind === "error" ? " dbg-link--error" : ""}`,
        ...(labelled && { label: e.label }),
      };
    }),
    { keyAttributes: "id" },
  ), [geometry, taken, showErrorEdges]);
  const focus = props.focus ?? geometry.bounds;
  // The focus is applied once per focus. oj-diagram runs the layout again when its frame resizes (a banner above it, the
  // full screen) or a property changes, and by default resets the view to fit; onojBeforePanZoomReset cancels that reset
  // (JET's documented way), so the layout gets the user's own pan and zoom as the current viewport and keeps it.
  const applied = useRef<string | null>(null);
  const focusKey = `${focus.x},${focus.y},${focus.w},${focus.h}`;
  const layout = useMemo(() => (ctx: any) => {
    for (let i = 0; i < ctx.getNodeCount(); i++) {
      const n = ctx.getNodeByIndex(i);
      const d = n.getData() as NodeItem;
      n.setPosition({ x: d.x, y: d.y });
    }
    for (let i = 0; i < ctx.getLinkCount(); i++) {
      const l = ctx.getLinkByIndex(i);
      const d = l.getData() as LinkItem;
      l.setPoints(d.points);
      if (d.label !== undefined) l.setLabelPosition(d.labelAt);
    }
    const current = applied.current === focusKey ? ctx.getCurrentViewport() : null;
    if (current !== null && current !== undefined) { ctx.setViewport(current); return; }
    applied.current = focusKey;
    ctx.setViewport({ x: focus.x - 40, y: focus.y - 40, w: focus.w + 80, h: focus.h + 80 });
  }, [focusKey]);
  // The breakpoint set reaches the cards through a ref (the renderer) and paintMarkers (drawn cards), never through the
  // diagram's data.
  const set = useMemo(() => new Set(props.breakpoints), [props.breakpoints.join(",")]);
  const setRef = useRef(set);
  setRef.current = set;
  const root = useRef<HTMLElement | null>(null);
  useEffect(() => { if (root.current !== null) paintMarkers(root.current, set); }, [set]);
  const nodeContent = useMemo(() => ({ renderer: (ctx: { itemData: NodeItem }) => renderNode(ctx, setRef.current) }), []);
  return (
    <oj-diagram ref={root as any} data-testid="dbg-graph" class="dbg-graph" aria-label="Workflow graph"
      nodeData={nodeData} linkData={linkData} layout={layout} nodeContent={nodeContent as any}
      selectionMode="single" selection={props.selectedId !== null ? [props.selectedId] : []}
      onselectionChanged={(e: { detail: { value: unknown; updatedFrom?: string } }) => {
        // Only the user's own clicks: a selection the inspector sets echoes back as an "external" change.
        if (e.detail.updatedFrom !== "internal") return;
        const v = e.detail.value as string[] | undefined;
        if (v !== undefined && v.length > 0 && v[0] !== props.selectedId) props.onSelect(v[0]);
      }}
      panning="auto" zooming="auto" minZoom={0.02} maxZoom={1.5}
      animationOnDisplay="none" animationOnDataChange="none"
      overview={OVERVIEW as any}
      onojBeforePanZoomReset={(e: Event) => e.preventDefault()}
      onClick={(e: MouseEvent) => {
        // The marker's click (it also selects the card, as any click on it does).
        const t = e.target instanceof Element ? e.target.closest("[data-breakpoint-toggle]") : null;
        const code = t?.getAttribute("data-breakpoint-toggle");
        if (code !== null && code !== undefined && code !== "") props.onToggleBreakpoint(code);
      }} />
  );
}
