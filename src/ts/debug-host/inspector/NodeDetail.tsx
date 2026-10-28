// One step in detail (Core Pack tab bar): Overview (node, timings, branch taken, cut / console / timeout marks), Input,
// Output, Vars Δ (the workflow variables this step changed: its context against the previous step's), Context ($system,
// $input, $triggers, $variables, $app after the step), Calls (the function / LLM calls with tokens, status, time), Compare
// (the same node in another turn of this page), Raw (the step's frames as received).
import "oj-c/button";
import "oj-c/select-single";
import "oj-c/tab-bar";
import "oj-c/table";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { decode } from "../run/decode";
import { diff } from "../run/diff";
import type { Change } from "../run/diff";
import type { WorkflowDefinition } from "../run/definition";
import { durationText, msText, previousWithContext, turnInput, variablesOf } from "../run/frames";
import type { Occurrence, RunView } from "../run/frames";
import { copy } from "./clipboard";
import { JsonView } from "./JsonView";

export type DetailTab = "overview" | "input" | "output" | "vars" | "context" | "calls" | "compare" | "raw";
const TABS: Array<{ itemKey: DetailTab; label: string }> = [
  { itemKey: "overview", label: "Overview" }, { itemKey: "input", label: "Input" }, { itemKey: "output", label: "Output" },
  { itemKey: "vars", label: "Vars Δ" }, { itemKey: "context", label: "Context" }, { itemKey: "calls", label: "Calls" },
  { itemKey: "compare", label: "Compare" }, { itemKey: "raw", label: "Raw" },
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown): string => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** One label/value line of the Overview (a definition list; Redwood typography). */
function Fact(props: { label: string; children: ComponentChildren; testId?: string }) {
  return (
    <div class="dbg-fact oj-flex oj-sm-flex-wrap-nowrap oj-sm-padding-1x-vertical" {...(props.testId !== undefined && { "data-testid": props.testId })}>
      <span class="dbg-fact__label oj-typography-body-sm oj-text-color-secondary">{props.label}</span>
      <span class="dbg-fact__value oj-typography-body-sm">{props.children}</span>
    </div>
  );
}

/** Where the run went from a CONDITION / SWITCH: its output names the branch; the definition names the next node. */
function branchOf(o: Occurrence, def: WorkflowDefinition | null): string | null {
  if (o.nodeType !== "CONDITION" && o.nodeType !== "SWITCH") return null;
  const out = typeof o.output === "string" ? o.output : show(o.output);
  const node = def?.byCode.get(o.nodeCode);
  const edge = node !== undefined ? def?.edges.find((e) => e.from === node.id && e.kind === "outcome" && e.label === out) : undefined;
  const to = edge !== undefined ? def?.byId.get(edge.to)?.code : undefined;
  return `${out}${to !== undefined ? ` → ${to}` : ""}`;
}

function Overview(props: { run: RunView; o: Occurrence; def: WorkflowDefinition | null }) {
  const { run, o, def } = props;
  const first = run.occurrences.find((x) => x.timeStamp !== undefined)?.timeStamp;
  const out = decode(o.output).value;
  const code = isObj(out) && ("console" in out || "timedOut" in out) ? out : null;
  const branch = branchOf(o, def);
  const node = def?.byCode.get(o.nodeCode);
  return (
    <div data-testid="dbg-detail-overview">
      <Fact label="Node">{o.nodeCode}{o.nodeName !== undefined && o.nodeName !== o.nodeCode ? ` — ${o.nodeName}` : ""}</Fact>
      <Fact label="Type">{o.nodeType ?? ""}</Fact>
      <Fact label="Step">{o.step !== null ? `#${o.step} of ${run.metrics.steps}` : "started, no end frame in this stream"}</Fact>
      <Fact label="Frames">{o.kind === "pair" ? "NODE_START … NODE_END" : o.kind === "single" ? (o.end?.type ?? "") : "NODE_START only"}{o.child ? " (child)" : ""}</Fact>
      {o.timeStamp !== undefined && first !== undefined && <Fact label="Started">{`+${msText(o.timeStamp - first)} after the first node`}</Fact>}
      <Fact label="Duration" testId="dbg-fact-duration">
        {o.durationKind === "exact" ? durationText(o) : o.durationKind === "upper-bound" ? `${durationText(o)} (time since the previous node, the orchestrator's included)` : "unknown"}
      </Fact>
      {o.progressMessage !== undefined && <Fact label="Progress">{o.progressMessage}</Fact>}
      {branch !== null && <Fact label="Branch taken" testId="dbg-fact-branch">{branch}</Fact>}
      {o.parentNodeCode !== undefined && <Fact label="Inside">{`${o.parentNodeCode}${o.loopIndex !== undefined ? `, iteration ${o.loopIndex}` : ""}`}</Fact>}
      {node === undefined && def !== null && <Fact label="Definition" testId="dbg-fact-unknown">{"no node with this code in the current definition"}</Fact>}
      {o.cut && <Fact label="Cut" testId="dbg-fact-cut">{"Oracle cut a value longer than 10 000 characters (first 10 000 + \".....\"): it is shown as text, not malformed"}</Fact>}
      {code !== null && <Fact label="Code">{`timedOut ${show(code.timedOut)}; console ${show(code.console) === "" ? "empty" : show(code.console)}`}</Fact>}
    </div>
  );
}

interface DiffRow { key: string; path: string; kind: Change["kind"]; before: string; after: string }

function VarsDelta(props: { run: RunView; o: Occurrence; query: string }) {
  const { run, o } = props;
  const prev = previousWithContext(run, o);
  const after = variablesOf(o);
  const changes = useMemo(() => (after === undefined ? [] : diff(prev !== undefined ? variablesOf(prev) : undefined, after)), [o, prev]);
  const data = useMemo(() => new ArrayDataProvider<string, DiffRow>(
    changes.map((c, i) => ({ key: `d${i}`, path: c.path, kind: c.kind, before: show(c.before), after: show(c.after) })), { keyAttributes: "key" },
  ), [changes]);
  if (after === undefined) return <p class="oj-typography-body-sm oj-text-color-secondary" data-testid="dbg-vars">{"This step has no context (the frame carries none)"}</p>;
  return (
    <div data-testid="dbg-vars">
      <p class="oj-typography-body-sm oj-text-color-secondary oj-sm-margin-1x-vertical">
        {prev !== undefined ? `$variables after #${o.step} against after #${prev.step} (${prev.nodeCode})` : "The first step with a context in this turn: every variable is listed as added"}
        {changes.length === 0 ? " — no change" : ` — ${changes.length} change${changes.length > 1 ? "s" : ""}`}
      </p>
      {changes.length > 0 && (
        <oj-c-table class="dbg-table" data-testid="dbg-vars-table" aria-label="Variable changes" data={data} layout="contents"
          columns={{
            path: { field: "path", headerText: "Variable" }, kind: { field: "kind", headerText: "Change" },
            before: { field: "before", headerText: "Before" }, after: { field: "after", headerText: "After" },
          }} />
      )}
      <JsonView value={after} label="$variables" query={props.query} testId="dbg-vars-tree" />
    </div>
  );
}

function Calls(props: { o: Occurrence; query: string }) {
  const si = props.o.stepInfo;
  const details = isObj(si) && Array.isArray(si.details) ? si.details.filter(isObj) : [];
  if (details.length === 0) return <p class="oj-typography-body-sm oj-text-color-secondary" data-testid="dbg-calls">{"No function or LLM call at this step"}</p>;
  return (
    <div data-testid="dbg-calls">
      {isObj(si) && typeof si.totalNodeTime === "number" && <Fact label="Node time">{msText(si.totalNodeTime)}</Fact>}
      {details.map((d, i) => {
        const out = decode(d.output).value;
        const status = isObj(out) && isObj(out.output) ? out.output.responseStatus : undefined;
        const head = [
          show(d.type), d.functionName !== undefined ? show(d.functionName) : d.modelName !== undefined ? show(d.modelName) : "",
          typeof d.timeTaken === "number" ? msText(d.timeTaken) : "",
          status !== undefined ? `HTTP ${show(status)}` : "",
          typeof d.inputTokens === "number" ? `${d.inputTokens} in / ${show(d.outputTokens)} out tokens` : "",
        ].filter((x) => x !== "").join(" · ");
        return (
          <div key={i} class="oj-sm-margin-2x-bottom" data-testid="dbg-call">
            <p class="oj-typography-body-sm oj-typography-semi-bold oj-sm-margin-1x-vertical">{head}</p>
            <JsonView value={d.input} label="input" query={props.query} testId="dbg-call-input" />
            <JsonView value={d.output} label="output" query={props.query} testId="dbg-call-output" />
          </div>
        );
      })}
    </div>
  );
}

function Raw(props: { run: RunView; o: Occurrence }) {
  const frames = [props.o.start, props.o.end].filter((f) => f !== undefined).map((f) => props.run.turn.frames[(f as { index: number }).index]);
  return (
    <div data-testid="dbg-raw">
      {frames.map((f, i) => (
        <div key={i} class="oj-sm-margin-2x-bottom">
          <div class="oj-flex oj-sm-align-items-center">
            <span class="oj-typography-body-xs oj-text-color-secondary">{`frame received ${new Date(f.at).toISOString()} · ${f.payload.length} characters`}</span>
            <oj-c-button size="sm" chroming="borderless" label="Copy" onojAction={() => copy(f.payload)} />
          </div>
          {/* The frame verbatim (JET has no code block component). */}
          <pre class="dbg-pre oj-typography-body-xs" data-testid="dbg-raw-frame">{f.payload}</pre>
        </div>
      ))}
    </div>
  );
}

function Compare(props: { runs: RunView[]; run: RunView; o: Occurrence; query: string }) {
  const others = props.runs.filter((r) => r !== props.run && r.occurrences.some((x) => x.nodeCode === props.o.nodeCode && x.step !== null));
  const [seq, setSeq] = useState<number | null>(null);
  const other = others.find((r) => r.turn.seq === seq) ?? others[others.length - 1];
  const data = useMemo(() => new ArrayDataProvider<number, { seq: number; label: string }>(
    others.map((r) => ({ seq: r.turn.seq, label: `Turn ${r.turn.seq} — ${turnInput(r.turn).slice(0, 40)}` })), { keyAttributes: "seq" },
  ), [others.map((r) => r.turn.seq).join(",")]);
  if (other === undefined) return <p class="oj-typography-body-sm oj-text-color-secondary" data-testid="dbg-compare">{`${props.o.nodeCode} ran in no other turn of this page`}</p>;
  const theirs = other.occurrences.filter((x) => x.nodeCode === props.o.nodeCode && x.step !== null);
  const t = theirs[theirs.length - 1];
  const input = diff(decode(t.input).value, decode(props.o.input).value);
  const output = diff(decode(t.output).value, decode(props.o.output).value);
  const vars = diff(variablesOf(t), variablesOf(props.o));
  const line = (label: string, c: Change[]) => <Fact label={label}>{c.length === 0 ? "same" : `${c.length} difference${c.length > 1 ? "s" : ""}: ${c.slice(0, 5).map((x) => x.path).join(", ")}${c.length > 5 ? ", …" : ""}`}</Fact>;
  return (
    <div data-testid="dbg-compare">
      <oj-c-select-single class="oj-sm-margin-2x-bottom" labelHint="Compare with" data={data} itemText="label" value={other.turn.seq}
        onvalueChanged={(e) => { if (typeof e.detail.value === "number") setSeq(e.detail.value); }} />
      <Fact label="This turn">{`#${props.o.step} · ${durationText(props.o) || "no duration"}`}</Fact>
      <Fact label={`Turn ${other.turn.seq}`}>{`#${t.step} · ${durationText(t) || "no duration"}`}</Fact>
      {line("Input", input)}
      {line("Output", output)}
      {line("Variables after", vars)}
      <JsonView value={t.output} label={`output in turn ${other.turn.seq}`} query={props.query} testId="dbg-compare-output" />
    </div>
  );
}

/** The breakpoint of the shown node: set it ("Stop before") or remove it; part of the page's one set of breakpoints. */
export interface BreakpointToggleProps { breakpoints: readonly string[]; onToggleBreakpoint: (code: string) => void }

function BreakpointToggle(props: BreakpointToggleProps & { code: string }) {
  const on = props.breakpoints.includes(props.code);
  return (
    <oj-c-button key={on ? "on" : "off"} data-testid="dbg-toggle-breakpoint" class="oj-sm-margin-2x-start" size="sm" chroming={on ? "outlined" : "callToAction"}
      label={on ? "Remove the breakpoint" : "Stop before this node"} onojAction={() => props.onToggleBreakpoint(props.code)}>
      <span slot="startIcon" class={on ? "oj-ux-ico-close" : "oj-ux-ico-pause-circle"} />
    </oj-c-button>
  );
}

/**
 * A node of the definition that has no step in the shown run (not executed, or no run yet): what the definition says
 * about it, and its breakpoint.
 */
export function NodeInfo(props: BreakpointToggleProps & { def: WorkflowDefinition; nodeId: string; ran: boolean }) {
  const { def } = props;
  const n = def.byId.get(props.nodeId);
  if (n === undefined || n.code === undefined) return null;
  const inside = n.parentId !== undefined ? def.byId.get(n.parentId)?.code : undefined;
  const out = def.edges.filter((e) => e.from === n.id);
  const into = def.edges.filter((e) => e.to === n.id && e.kind === "outcome");
  const code = (id: string): string => def.byId.get(id)?.code ?? id;
  return (
    <div class="dbg-detail oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap" data-testid="dbg-node-info">
      <div class="oj-flex oj-sm-align-items-center oj-sm-padding-1x-vertical">
        <span class="oj-typography-heading-xs" data-testid="dbg-detail-title">{n.code}</span>
        <span class="oj-typography-body-sm oj-text-color-secondary oj-sm-margin-2x-start">{n.type}</span>
        <BreakpointToggle code={n.code} breakpoints={props.breakpoints} onToggleBreakpoint={props.onToggleBreakpoint} />
      </div>
      <Fact label="Node">{`${n.code}${n.name !== n.code ? ` — ${n.name}` : ""}`}</Fact>
      <Fact label="Type">{n.type}</Fact>
      <Fact label="This run" testId="dbg-node-info-run">{props.ran ? "not executed" : "no run yet"}</Fact>
      {inside !== undefined && <Fact label="Inside">{inside}</Fact>}
      <Fact label="Comes from">{into.length > 0 ? into.map((e) => `${code(e.from)} (${e.label})`).join(", ") : "—"}</Fact>
      <Fact label="Goes to">{out.length > 0 ? out.map((e) => `${e.label} → ${code(e.to)}`).join(", ") : "—"}</Fact>
    </div>
  );
}

export function NodeDetail(props: BreakpointToggleProps & { runs: RunView[]; run: RunView; o: Occurrence; def: WorkflowDefinition | null; query: string; tab: DetailTab; onTab: (t: DetailTab) => void }) {
  const { run, o, query } = props;
  const contextValue = o.context;
  return (
    <div class="dbg-detail oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap" data-testid="dbg-detail">
      <div class="oj-flex oj-sm-align-items-center oj-sm-padding-1x-vertical">
        <span class="oj-typography-heading-xs" data-testid="dbg-detail-title">{`${o.step !== null ? `#${o.step} ` : ""}${o.nodeCode}`}</span>
        <span class="oj-typography-body-sm oj-text-color-secondary oj-sm-margin-2x-start">{[o.nodeType, durationText(o)].filter((x) => x).join(" · ")}</span>
        <BreakpointToggle code={o.nodeCode} breakpoints={props.breakpoints} onToggleBreakpoint={props.onToggleBreakpoint} />
      </div>
      <oj-c-tab-bar data-testid="dbg-detail-tabs" aria-label="Step details" layout="condense" overflow="conveyor" data={TABS} selection={props.tab}
        onselectionChanged={(e) => { if (e.detail.value !== undefined && e.detail.value !== props.tab) props.onTab(e.detail.value as DetailTab); }} />
      <div class="dbg-detail__body oj-sm-padding-2x-vertical">
        {props.tab === "overview" && <Overview run={run} o={o} def={props.def} />}
        {props.tab === "input" && <JsonView value={o.input} label="input" query={query} testId="dbg-input" emptyText="No input in the frames" />}
        {props.tab === "output" && <JsonView value={o.output} label="output" query={query} testId="dbg-output" emptyText="No output (the node has not ended)" />}
        {props.tab === "vars" && <VarsDelta run={run} o={o} query={query} />}
        {props.tab === "context" && <JsonView value={contextValue} label="context" query={query} testId="dbg-context" emptyText="No context in the frames" />}
        {props.tab === "calls" && <Calls o={o} query={query} />}
        {props.tab === "compare" && <Compare runs={props.runs} run={run} o={o} query={query} />}
        {props.tab === "raw" && <Raw run={run} o={o} />}
      </div>
    </div>
  );
}
