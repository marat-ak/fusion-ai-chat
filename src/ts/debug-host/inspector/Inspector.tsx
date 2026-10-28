// The Run Inspector (bridge design §13, decision 5: the debugger page only, never a VB end-user page). It reads the page's
// run record (runStore.ts: every turn's request and raw frames, captured through the chat's run observer) and shows, for the
// selected turn: the workflow graph with the path the run took (classic oj-diagram at Studio's own positions) or the
// steps list, a stepper (first / previous / next / last / play, arrow keys), the selected step in detail (NodeDetail),
// a search through every step's data, the turn's metrics, the breakpoint verdict, the breakpoints of the next runs
// (BreakpointEditor: add from a picker of every node, remove; also from a graph node or the step detail), and Export.
// Without a readable definition or without Studio positions there is no graph (decision 4: no layout of our own) and a
// notice says why; a definition saved after the run is named as such.
import "oj-c/button";
import "oj-c/buttonset-single";
import "oj-c/input-text";
import "oj-c/list-item-layout";
import "oj-c/list-view";
import "oj-c/message-banner";
import "oj-c/message-toast";
import "oj-c/select-single";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import MutableArrayDataProvider = require("ojs/ojmutablearraydataprovider");
import { Component, render } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { breakpointVerdict } from "../run/breakpoints";
import type { BreakpointVerdict } from "../run/breakpoints";
import { decode, search, tree } from "../run/decode";
import { drawable } from "../run/definition";
import type { WorkflowDefinition } from "../run/definition";
import type { DefinitionResult, DefinitionSource } from "../run/definitionSource";
import { msText, runView, turnInput } from "../run/frames";
import type { Occurrence, RunView } from "../run/frames";
import { graphGeometry } from "../run/graphLayout";
import { focusOf, runOnGraph } from "../run/graphRun";
import type { RecordedTurn, RunStore } from "../run/runStore";
import { onCopy } from "./clipboard";
import { BreakpointEditor } from "./BreakpointEditor";
import { NodeDetail, NodeInfo } from "./NodeDetail";
import type { DetailTab } from "./NodeDetail";
import { RunGraph } from "./RunGraph";
import { StepsList } from "./StepsList";

export interface InspectorProps {
  store: RunStore;
  source: DefinitionSource;
  /** The run the page is bound to (its workflow definition is the graph). */
  workflowCode: string;
  version: string;
  onExport: () => void;
  /**
   * The Run tab is shown. The graph is drawn only then: oj-diagram lays out against its size, and a hidden pane has none.
   */
  active: boolean;
}

type Severity = "error" | "warning" | "info" | "confirmation";
interface Notice { id: string; severity: Severity; summary: string; closeAffordance: "off" }
const PLAY_MS = 900;
const SEARCH_DEBOUNCE_MS = 250;
const MAX_HITS = 100;

/** Re-renders on every change of the run record. */
function useRevision(store: RunStore): number {
  const [rev, setRev] = useState(store.revision);
  useEffect(() => store.subscribe(() => setRev(store.revision)), [store]);
  return rev;
}

/** "Turn 2 · Move 5 units · stop · 24 steps" */
function turnLabel(r: RunView): string {
  const status = r.final?.finishReason ?? (r.turn.error !== undefined ? "error" : r.turn.endedAt === undefined ? "running" : "no outcome");
  const input = turnInput(r.turn);
  return `Turn ${r.turn.seq} · ${input === "" ? "(no message)" : input.length > 40 ? input.slice(0, 39) + "…" : input} · ${status} · ${r.metrics.steps} steps`;
}

function metricsText(r: RunView): string {
  const m = r.metrics;
  return [
    m.nodeTimeMs !== undefined ? `${msText(m.nodeTimeMs)} first to last node` : "",
    r.turn.endedAt !== undefined ? `${msText(r.turn.endedAt - r.turn.sentAt)} request to end` : "",
    m.llmCalls > 0 ? `${m.llmCalls} LLM call${m.llmCalls > 1 ? "s" : ""} (${m.tokensIn} in / ${m.tokensOut} out tokens)` : "",
    m.functionCalls > 0 ? `${m.functionCalls} function call${m.functionCalls > 1 ? "s" : ""}` : "",
    m.cutValues > 0 ? `${m.cutValues} step${m.cutValues > 1 ? "s" : ""} with a value cut by Oracle` : "",
    r.jobId !== undefined ? `job ${r.jobId}` : "",
  ].filter((x) => x !== "").join(" · ");
}

function verdictText(v: BreakpointVerdict): string | null {
  if (v.stop === undefined) {
    return v.notExecuted.length === 0 ? `Breakpoints ${v.requested.join(", ")}: every one was executed (no stop)` : null;
  }
  return v.stop.verified ? `Stopped before ${v.stop.before.join(" or ")} (breakpoint; verified against the graph): the output is ${v.lastExecuted}'s output, not the agent's reply`
    : `Breakpoint ${v.notExecuted.join(", ")} not executed — unverified stop: ${v.stop.reason}`;
}

/** A search hit: which step, which tab, which path. */
interface Hit { key: string; index: number; step: number | null; code: string; tab: DetailTab; path: string }

function searchRun(run: RunView, query: string): Hit[] {
  if (query.trim() === "") return [];
  const hits: Hit[] = [];
  const fields: Array<[DetailTab, (o: Occurrence) => unknown]> = [["input", (o) => o.input], ["output", (o) => o.output], ["context", (o) => o.context], ["calls", (o) => o.stepInfo]];
  run.occurrences.forEach((o, index) => {
    if (hits.length >= MAX_HITS) return;
    if (o.nodeCode.toLowerCase().includes(query.toLowerCase())) hits.push({ key: `${index}:overview`, index, step: o.step, code: o.nodeCode, tab: "overview", path: "node code" });
    for (const [tab, get] of fields) {
      const v = get(o);
      if (v === undefined) continue;
      for (const path of search(tree(decode(v)), query)) {
        if (hits.length >= MAX_HITS) return;
        hits.push({ key: `${index}:${tab}:${path}`, index, step: o.step, code: o.nodeCode, tab, path });
      }
    }
  });
  return hits;
}

/** Turns read as runs, each re-read only when it changed (new frames, its end, its definition version). */
function useRuns(turns: readonly RecordedTurn[], rev: number, active: boolean): RunView[] {
  const cache = useRef(new Map<RecordedTurn, { key: string; view: RunView }>());
  return useMemo(() => {
    // Nothing is read while the Run tab is hidden: a run streaming in the Chat tab costs no parsing here.
    if (!active) return [];
    const next = new Map<RecordedTurn, { key: string; view: RunView }>();
    const out = turns.map((t) => {
      const key = `${t.frames.length}|${t.endedAt ?? ""}|${JSON.stringify(t.definitionVersion ?? null)}|${t.error?.message ?? ""}`;
      const hit = cache.current.get(t);
      const entry = hit !== undefined && hit.key === key ? hit : { key, view: runView(t) };
      next.set(t, entry);
      return entry.view;
    });
    cache.current = next;
    return out;
  }, [turns, rev, active]);
}

/**
 * Keeps an error of the inspector inside it: Preact renders every root of the page (the chat's too) from one queue, so an
 * error escaping here would stop the chat from updating.
 */
class InspectorBoundary extends Component<{ children: ComponentChildren }, { error: string | null }> {
  state = { error: null as string | null };
  componentDidCatch(e: unknown): void {
    this.setState({ error: e instanceof Error ? e.message : String(e) });
  }
  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div data-testid="dbg-inspector-failed" class="oj-sm-padding-2x">
        <p class="oj-typography-body-sm oj-text-color-danger">{`The Run Inspector failed: ${this.state.error}`}</p>
        <oj-c-button size="sm" chroming="outlined" label="Show it again" onojAction={() => this.setState({ error: null })} />
      </div>
    );
  }
}

export function Inspector(props: InspectorProps) {
  const { store, source } = props;
  const rev = useRevision(store);
  const turns = store.turns;
  const runs = useRuns(turns, rev, props.active);
  const [pinned, setPinned] = useState<number | null>(null);
  const run = (pinned !== null ? runs.find((r) => r.turn.seq === pinned) : undefined) ?? runs[runs.length - 1] ?? null;
  const [picked, setPicked] = useState<{ seq: number; index: number } | null>(null);
  const lastDone = run === null ? -1 : run.occurrences.reduce((acc, o, i) => (o.step !== null ? i : acc), run.occurrences.length - 1);
  const index = run !== null && picked !== null && picked.seq === run.turn.seq && picked.index < run.occurrences.length ? picked.index : lastDone;
  const occ = run !== null && index >= 0 ? run.occurrences[index] : null;
  const [tab, setTab] = useState<DetailTab>("overview");
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [playing, setPlaying] = useState(false);
  const [focusNode, setFocusNode] = useState<string | null>(null);

  // ---- definition: loaded once, again when a turn ended on another saved version ----------------
  const [def, setDef] = useState<DefinitionResult | null>(null);
  const loading = useRef(false);
  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    source.load(props.workflowCode, props.version).then(
      (r) => { loading.current = false; setDef(r); },
      (e: unknown) => { loading.current = false; setDef({ ok: false, reason: e instanceof Error ? e.message : String(e) }); },
    );
  }, [source]);
  // First read when the Run tab is first shown (a page whose chat never runs reads nothing).
  const [wanted, setWanted] = useState(false);
  useEffect(() => { if (props.active && !wanted) { setWanted(true); load(); } }, [props.active]);
  const definition: WorkflowDefinition | null = def !== null && def.ok ? def.definition : null;
  const latestVersion = runs.length > 0 ? runs[runs.length - 1].turn.definitionVersion : undefined;
  useEffect(() => {
    if (definition !== null && latestVersion !== undefined && "version" in latestVersion && latestVersion.version !== undefined && latestVersion.version !== definition.version) load();
  }, [latestVersion]);
  const geometry = useMemo(() => (definition !== null && definition.layout.ok ? graphGeometry(definition) : null), [definition]);
  const graphOk = geometry !== null;
  const [view, setView] = useState<"graph" | "steps">("graph");
  const shown = graphOk ? view : "steps";

  const verdict = useMemo(() => (run !== null ? breakpointVerdict(run, definition) : null), [run, definition]);
  const onGraph = useMemo(() => (definition !== null && geometry !== null ? runOnGraph(definition, run, verdict) : null), [definition, geometry, run, verdict]);

  // ---- notices -----------------------------------------------------------------------------------
  const notices: Notice[] = [];
  const note = (id: string, severity: Severity, summary: string): void => { notices.push({ id, severity, summary, closeAffordance: "off" }); };
  if (def === null) note("def-loading", "info", "Loading the workflow definition…");
  else if (!def.ok) note("def-unavailable", "warning", `No graph: ${def.reason}. The Steps view shows the run.`);
  else if (!def.definition.layout.ok) {
    const m = def.definition.layout.missing;
    note("def-no-layout", "info", `No graph: the workflow has no Studio positions for ${m.length} node${m.length > 1 ? "s" : ""} (${m.slice(0, 5).join(", ")}${m.length > 5 ? ", …" : ""}). The Steps view shows the run.`);
  }
  if (run !== null && definition !== null) {
    const tv = run.turn.definitionVersion;
    if (tv !== undefined && "version" in tv && tv.version !== undefined && definition.version !== undefined && tv.version !== definition.version) {
      note("def-changed", "warning", `The workflow definition changed since this run (version ${tv.version} at the run, ${definition.version} now): the graph shows the current definition.`);
    } else if (tv !== undefined && "error" in tv) {
      note("def-version-unknown", "info", `The definition version at the end of this run is unknown (${tv.error}).`);
    }
    if (onGraph !== null && onGraph.unknownCodes.length > 0) {
      note("def-unknown-codes", "warning", `The run went through nodes the current definition does not have: ${onGraph.unknownCodes.join(", ")}.`);
    }
  }
  if (run !== null && run.problems.length > 0) note("frames", "warning", `${run.problems.length} frame${run.problems.length > 1 ? "s" : ""} could not be read: ${run.problems.slice(0, 3).map((p) => `#${p.index + 1} ${p.why}`).join("; ")}`);
  if (run !== null && run.turn.error !== undefined) note("turn-error", "error", `The turn failed: ${run.turn.error.message}`);
  const verdictLine = verdict !== null ? verdictText(verdict) : null;
  if (verdictLine !== null) note("verdict", verdict?.stop?.verified === true ? "confirmation" : "info", verdictLine);
  const unknownBreakpoints = definition !== null ? store.breakpoints.filter((c) => !definition.byCode.has(c)) : [];
  if (unknownBreakpoints.length > 0) note("bp-unknown", "warning", `Breakpoint${unknownBreakpoints.length > 1 ? "s" : ""} ${unknownBreakpoints.join(", ")} name${unknownBreakpoints.length > 1 ? "" : "s"} no node of the current definition.`);
  const noticeData = useMemo(() => new MutableArrayDataProvider<string, Notice>([], { keyAttributes: "id" }), []);
  const noticeKey = JSON.stringify(notices);
  useEffect(() => { noticeData.data = notices; }, [noticeKey]);

  // ---- toast (copy outcome) ----------------------------------------------------------------------
  const toasts = useMemo(() => new MutableArrayDataProvider<number, { id: number; severity: Severity; summary: string; autoTimeout: "on" }>([], { keyAttributes: "id" }), []);
  const toastSeq = useRef(0);
  useEffect(() => onCopy((o) => {
    toasts.data = [{ id: ++toastSeq.current, severity: o.ok ? "confirmation" : "error", summary: o.ok ? o.what : `Copy failed: ${o.why}`, autoTimeout: "on" }];
  }), []);

  // ---- navigation --------------------------------------------------------------------------------
  const count = run?.occurrences.length ?? 0;
  // A graph node shown from the definition alone (no step of the shown run there); any step navigation leaves it.
  const [graphNode, setGraphNode] = useState<string | null>(null);
  const toggleBreakpoint = useCallback((code: string) => {
    if (store.breakpoints.includes(code)) store.removeBreakpoint(code);
    else store.addBreakpoint(code);
  }, [store]);
  const go = useCallback((i: number, fromGraph = false) => {
    if (run === null || count === 0) return;
    const j = Math.max(0, Math.min(count - 1, i));
    setGraphNode(null);
    setPicked({ seq: run.turn.seq, index: j });
    if (!fromGraph && definition !== null) setFocusNode(definition.byCode.get(run.occurrences[j].nodeCode)?.id ?? null);
  }, [run, count, definition]);
  useEffect(() => {
    if (!playing) return undefined;
    if (index >= count - 1) { setPlaying(false); return undefined; }
    const t = window.setTimeout(() => go(index + 1), PLAY_MS);
    return () => window.clearTimeout(t);
  }, [playing, index, count, go]);
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [typed]);
  const hits = useMemo(() => (run !== null ? searchRun(run, query) : []), [run, query]);
  const hitData = useMemo(() => new ArrayDataProvider<string, Hit>(hits, { keyAttributes: "key" }), [hits]);

  const turnData = useMemo(() => new ArrayDataProvider<number, { seq: number; label: string }>(
    runs.map((r) => ({ seq: r.turn.seq, label: turnLabel(r) })).reverse(), { keyAttributes: "seq" },
  ), [runs]);

  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
  };

  const nodeIdOfOcc = occ !== null && definition !== null ? definition.byCode.get(occ.nodeCode)?.id ?? null : null;
  // The graph opens on the selected step of each turn (its last, until another is picked); afterwards the stepper, the
  // steps list and the search move it, while a click in the graph keeps the user's own pan and zoom.
  useEffect(() => { setFocusNode(nodeIdOfOcc); setGraphNode(null); }, [run?.turn.seq, definition]);
  const focus = useMemo(() => {
    if (definition === null || geometry === null) return undefined;
    if (focusNode !== null) return focusOf(definition, [focusNode], geometry.bounds);
    const start = drawable(definition).nodes.find((n) => n.type === "START" && n.parentId === undefined);
    return focusOf(definition, start !== undefined ? [start.id] : [], geometry.bounds);
  }, [definition, geometry, focusNode]);

  return (
    <div class="dbg-inspector oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap" data-testid="dbg-inspector" onKeyDown={onKey} tabIndex={-1}>
      <div class="oj-flex oj-sm-align-items-center oj-sm-flex-wrap oj-sm-padding-1x-vertical dbg-gap">
        {runs.length > 0 && (
          // Keyed by its label: the select keeps the text of its value when only the items change (a turn still streaming).
          <oj-c-select-single key={run !== null ? turnLabel(run) : "none"} data-testid="dbg-turn" class="dbg-turn" labelHint="Turn" labelEdge="none" data={turnData} itemText="label"
            value={run?.turn.seq ?? null}
            onvalueChanged={(e) => {
              const v = e.detail.value;
              if (typeof v === "number" && v !== run?.turn.seq) { setPinned(v === runs[runs.length - 1].turn.seq ? null : v); setPlaying(false); setFocusNode(null); }
            }} />
        )}
        {graphOk && (
          <oj-c-buttonset-single data-testid="dbg-view" aria-label="View" size="sm" chroming="outlined" value={shown}
            items={[{ value: "graph", label: "Graph" }, { value: "steps", label: "Steps" }]}
            onvalueChanged={(e) => { const v = e.detail.value; if (v === "graph" || v === "steps") setView(v); }} />
        )}
        <oj-c-button data-testid="dbg-reload-definition" size="sm" chroming="borderless" label="Reload definition" onojAction={load}>
          <span slot="startIcon" class="oj-ux-ico-refresh" />
        </oj-c-button>
        <oj-c-button data-testid="dbg-export" size="sm" chroming="outlined" label="Export" onojAction={props.onExport}>
          <span slot="startIcon" class="oj-ux-ico-download" />
        </oj-c-button>
      </div>
      <BreakpointEditor breakpoints={store.breakpoints} definition={definition} unavailable={def !== null && !def.ok ? def.reason : null}
        onSet={(codes) => store.setBreakpoints(codes)} onAdd={(codes) => { for (const c of codes) store.addBreakpoint(c); }}
        onRemove={(c) => store.removeBreakpoint(c)} />
      {run !== null && <p class="oj-typography-body-xs oj-text-color-secondary oj-sm-margin-0" data-testid="dbg-metrics">{metricsText(run)}</p>}
      {notices.length > 0 && <oj-c-message-banner data-testid="dbg-inspector-notices" type="section" data={noticeData} />}
      {run !== null && count > 0 && (
        <div class="oj-flex oj-sm-align-items-center oj-sm-flex-wrap dbg-gap oj-sm-padding-1x-vertical">
          <oj-c-button data-testid="dbg-first" size="sm" chroming="borderless" display="icons" label="First step" onojAction={() => go(0)}>
            <span slot="startIcon" class="oj-ux-ico-chevron-left-end" />
          </oj-c-button>
          <oj-c-button data-testid="dbg-prev" size="sm" chroming="borderless" display="icons" label="Previous step" onojAction={() => go(index - 1)}>
            <span slot="startIcon" class="oj-ux-ico-arrow-left" />
          </oj-c-button>
          <span class="oj-typography-body-sm" data-testid="dbg-position">
            {occ !== null ? `${occ.step !== null ? `Step ${occ.step} of ${run.metrics.steps}` : "Unfinished"} · ${occ.nodeCode}` : ""}
          </span>
          <oj-c-button data-testid="dbg-next" size="sm" chroming="borderless" display="icons" label="Next step" onojAction={() => go(index + 1)}>
            <span slot="startIcon" class="oj-ux-ico-arrow-right" />
          </oj-c-button>
          <oj-c-button data-testid="dbg-last" size="sm" chroming="borderless" display="icons" label="Last step" onojAction={() => go(count - 1)}>
            <span slot="startIcon" class="oj-ux-ico-chevron-right-end" />
          </oj-c-button>
          <oj-c-button data-testid="dbg-play" size="sm" chroming="borderless" label={playing ? "Pause" : "Play"}
            onojAction={() => { if (!playing && index >= count - 1) go(0); setPlaying(!playing); }}>
            <span slot="startIcon" class={playing ? "oj-ux-ico-pause" : "oj-ux-ico-play"} />
          </oj-c-button>
          <oj-c-input-text data-testid="dbg-search" class="dbg-search" labelHint="Search in this turn" labelEdge="none" placeholder="Search keys and values"
            clearIcon="conditional" value={typed} onrawValueChanged={(e) => setTyped(String(e.detail.value ?? ""))} />
        </div>
      )}
      {query.trim() !== "" && run !== null && (
        <div class="dbg-hits" data-testid="dbg-hits">
          <p class="oj-typography-body-xs oj-text-color-secondary oj-sm-margin-0">{hits.length === 0 ? "No match in this turn" : `${hits.length}${hits.length >= MAX_HITS ? "+" : ""} match${hits.length > 1 ? "es" : ""}`}</p>
          {hits.length > 0 && (
            <oj-c-list-view class="dbg-hits__list" aria-label="Search matches" data={hitData} selectionMode="none"
              onojItemAction={(e) => { const h = e.detail.context.data as Hit; go(h.index); setTab(h.tab); }}>
              <template slot="itemTemplate" render={(ctx: { data: Hit }) => (
                <oj-c-list-item-layout data-testid="dbg-hit">
                  <span class="oj-typography-body-xs">{`${ctx.data.step !== null ? `#${ctx.data.step}` : "—"} ${ctx.data.code} · ${ctx.data.tab} · ${ctx.data.path}`}</span>
                </oj-c-list-item-layout>
              )} />
            </oj-c-list-view>
          )}
        </div>
      )}
      {run === null && (
        <p class="oj-typography-body-sm oj-text-color-secondary" data-testid="dbg-no-run">
          {"No run yet: send a message in the Chat tab — every turn's run appears here."}
        </p>
      )}
      <div class="dbg-body">
        {shown === "graph" && props.active && geometry !== null && onGraph !== null && definition !== null && (
          <div class="dbg-body__nav">
            <RunGraph geometry={geometry} views={onGraph.views} taken={onGraph.taken} showErrorEdges={false} selectedId={graphNode ?? nodeIdOfOcc}
              breakpoints={store.breakpoints} onToggleBreakpoint={toggleBreakpoint}
              {...(focus !== undefined && { focus })}
              onSelect={(nodeId) => {
                const code = definition.byId.get(nodeId)?.code;
                // A node run several times: the next of its runs after the current step, else its first. A node with no
                // step in this run (or no run yet) is shown from the definition, with its breakpoint.
                const mine = run === null ? [] : run.occurrences.map((o, i) => (o.nodeCode === code ? i : -1)).filter((i) => i >= 0);
                if (mine.length === 0) { setGraphNode(nodeId); return; }
                go(mine.find((i) => i > index) ?? mine[0], true);
              }} />
          </div>
        )}
        {shown === "steps" && run !== null && (
          <div class="dbg-body__nav">
            <StepsList run={run} selected={index} breakpoints={store.breakpoints} onSelect={(i) => go(i)} />
          </div>
        )}
        {graphNode !== null && definition !== null && shown === "graph" ? (
          <div class="dbg-body__detail">
            <NodeInfo def={definition} nodeId={graphNode} ran={run !== null} breakpoints={store.breakpoints} onToggleBreakpoint={toggleBreakpoint} />
          </div>
        ) : run !== null && occ !== null && (
          <div class="dbg-body__detail">
            <NodeDetail runs={runs} run={run} o={occ} def={definition} query={query} tab={tab} onTab={setTab}
              breakpoints={store.breakpoints} onToggleBreakpoint={toggleBreakpoint} />
          </div>
        )}
      </div>
      <oj-c-message-toast data={toasts} onojClose={() => { toasts.data = []; }} />
    </div>
  );
}

/**
 * Mounts the inspector into the page's Run pane (an element outside Knockout's bindings); the returned function tells it
 * whether the Run tab is shown (it re-renders with its state kept).
 */
export function mountInspector(el: HTMLElement, props: Omit<InspectorProps, "active">, active: boolean): (active: boolean) => void {
  const draw = (a: boolean): void => { render(<InspectorBoundary><Inspector {...props} active={a} /></InspectorBoundary>, el); };
  draw(active);
  return draw;
}
