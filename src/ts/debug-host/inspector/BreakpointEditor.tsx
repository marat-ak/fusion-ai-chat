// The breakpoints of the next /debug runs, in the Run tab (the page's ONE set, run/runStore.ts: the agent's breakpoints
// message replaces it, these controls edit it; the graph's cards toggle it too).
// - With a readable definition: a Core Pack multi-select of EVERY node of the workflow (searchable by code, name or type;
//   nodes not executed yet included — the main use) whose value IS the set: picking adds, unpicking or a chip's remove
//   removes. A code of the set the definition does not have (the agent may name one) is listed too, marked as such, so it
//   stays visible and removable.
// - Without one: the set as removable buttons and a field for node codes, comma-separated, checked only against the
//   pattern the agent's panel message uses — the codes cannot be checked against the workflow then, and it says so.
import "oj-c/button";
import "oj-c/input-text";
import "oj-c/select-multiple";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import { useMemo, useState } from "preact/hooks";
import { parseBreakpointNodes } from "../run/breakpoints";
import { editedSet, nodeOptions } from "../run/definition";
import type { NodeOption, WorkflowDefinition } from "../run/definition";

export interface BreakpointEditorProps {
  breakpoints: readonly string[];
  /** The workflow definition when it is readable; null with `unavailable` saying why (null `unavailable` = still loading). */
  definition: WorkflowDefinition | null;
  unavailable: string | null;
  /** The whole set as the user left it (the multi-select's edit). */
  onSet: (codes: string[]) => void;
  onAdd: (codes: string[]) => void;
  onRemove: (code: string) => void;
}

function NodeSelect(props: { breakpoints: readonly string[]; definition: WorkflowDefinition; onSet: (codes: string[]) => void }) {
  const { breakpoints, definition } = props;
  const known = useMemo(() => nodeOptions(definition), [definition]);
  const key = breakpoints.join(",");
  const options = useMemo((): NodeOption[] => [
    ...known,
    ...breakpoints.filter((c) => !definition.byCode.has(c)).map((c) => ({ code: c, label: `${c} (not in the definition)` })),
  ], [known, key]);
  const data = useMemo(() => new ArrayDataProvider<string, NodeOption>(options, { keyAttributes: "code" }), [options]);
  const value = useMemo(() => new Set(breakpoints), [key]);
  return (
    <oj-c-select-multiple data-testid="dbg-breakpoint-select" class="dbg-breakpoint-select" labelHint="Stop before (next runs)" labelEdge="inside"
      placeholder="Search a node by code or name" data={data} itemText="label" value={value}
      onvalueChanged={(e) => {
        // Only the user's own edit: the set the inspector passes in echoes back as an "external" change.
        if (e.detail.updatedFrom !== "internal") return;
        const next = editedSet(breakpoints, (e.detail.value ?? new Set<string>()) as Set<string>);
        if (next.join(",") !== key) props.onSet(next);
      }} />
  );
}

export function BreakpointEditor(props: BreakpointEditorProps) {
  const { breakpoints, definition } = props;
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const addTyped = (): void => {
    const text = typed.trim();
    if (text === "") return;
    try {
      const codes = parseBreakpointNodes(text.replace(/\s*,\s*/g, ","));
      setError(null);
      setTyped("");
      props.onAdd(codes);
    } catch (e) {
      setError(`Not added: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <div class="oj-flex oj-sm-align-items-center oj-sm-flex-wrap dbg-gap" data-testid="dbg-breakpoints">
      {definition !== null && <NodeSelect breakpoints={breakpoints} definition={definition} onSet={props.onSet} />}
      {definition === null && props.unavailable !== null && (
        <>
          <span class="oj-typography-body-sm oj-text-color-secondary">{breakpoints.length > 0 ? "Next runs stop before:" : "No breakpoint"}</span>
          {breakpoints.map((c) => (
            <oj-c-button key={c} data-testid="dbg-breakpoint" data-node-code={c} size="sm" chroming="outlined" label={c}
              tooltip={`Remove the breakpoint on ${c}`} onojAction={() => props.onRemove(c)}>
              <span slot="endIcon" class="oj-ux-ico-close" />
            </oj-c-button>
          ))}
          <oj-c-input-text data-testid="dbg-breakpoint-codes" class="dbg-breakpoint-select" labelHint="Node codes to stop before" labelEdge="none"
            placeholder="CODE_A,CODE_B" value={typed} onrawValueChanged={(e) => setTyped(String(e.detail.value ?? ""))}
            {...(error !== null && { messagesCustom: [{ severity: "error", detail: error }] })} />
          <oj-c-button data-testid="dbg-breakpoint-codes-add" size="sm" chroming="outlined" label="Add" onojAction={addTyped} />
          <span class="oj-typography-body-xs oj-text-color-secondary" data-testid="dbg-breakpoint-unchecked">
            {`Node codes cannot be checked: the workflow definition is unavailable (${props.unavailable}).`}
          </span>
        </>
      )}
    </div>
  );
}
