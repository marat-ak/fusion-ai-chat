// The run's steps as a list (Core Pack list view): step number, node, type, duration (exact, or "≤" for a single-frame
// node), when it started relative to the first node, and its marks (cut by Oracle, waiting, error, breakpoint, never
// ended). A duration bar per row makes the slow steps stand out.
import "oj-c/badge";
import "oj-c/list-item-layout";
import "oj-c/list-view";
import "oj-c/meter-bar";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import { KeySetImpl } from "ojs/ojkeyset";
import { useCallback, useMemo } from "preact/hooks";
import { durationText, msText } from "../run/frames";
import type { Occurrence, RunView } from "../run/frames";

/**
 * One row: the step and what its row shows relative to its own run (the list view may still draw a previous turn's rows
 * with the current template while it fetches the new data, so a row carries its own scale and start).
 */
interface Row { key: string; index: number; o: Occurrence; max: number; first?: number }

/** The one selected key of a single-selection list view (its ImmutableKeySet), or null. */
export function firstKey(set: unknown): string | null {
  const s = set as { keys?: { all?: boolean; keys?: Set<unknown> } } | null | undefined;
  if (s?.keys?.all === true || s?.keys?.keys === undefined) return null;
  const it = s.keys.keys.values().next();
  return it.done === true ? null : String(it.value);
}

export function StepsList(props: { run: RunView; selected: number; breakpoints: readonly string[]; onSelect: (index: number) => void }) {
  const { run } = props;
  const rows = useMemo(() => {
    const first = run.occurrences.find((o) => o.timeStamp !== undefined)?.timeStamp;
    const max = Math.max(1, ...run.occurrences.map((o) => (o.durationKind === "exact" ? o.durationMs ?? 0 : 0)));
    return run.occurrences.map((o, index): Row => ({ key: `o${index}`, index, o, max, ...(first !== undefined && { first }) }));
  }, [run]);
  const data = useMemo(() => new ArrayDataProvider<string, Row>(rows, { keyAttributes: "key" }), [rows]);
  const selected = useMemo(() => new KeySetImpl<string>([`o${props.selected}`]), [props.selected]);
  const renderRow = useCallback((ctx: { data: Row }) => {
    const { o, max, first } = ctx.data;
    const marks: Array<{ label: string; variant: "danger" | "warning" | "info" | "neutral" }> = [];
    if (o.kind === "open") marks.push({ label: run.wait?.code === o.nodeCode ? "waiting" : "no end", variant: "warning" });
    if (run.errorNodeCode === o.nodeCode) marks.push({ label: "error", variant: "danger" });
    if (o.cut) marks.push({ label: "cut", variant: "warning" });
    if (props.breakpoints.includes(o.nodeCode)) marks.push({ label: "breakpoint", variant: "info" });
    const offset = o.timeStamp !== undefined && first !== undefined ? `+${msText(o.timeStamp - first)}` : "";
    return (
      <oj-c-list-item-layout data-testid="dbg-step" data-step={o.step ?? ""} data-node-code={o.nodeCode}>
        <span slot="leading" class="dbg-step__num oj-typography-body-sm oj-typography-semi-bold">{o.step !== null ? `#${o.step}` : "—"}</span>
        <span class="oj-typography-body-sm oj-typography-semi-bold">{o.nodeCode}</span>
        <span slot="secondary" class="oj-typography-body-xs oj-text-color-secondary">
          {[o.nodeType, durationText(o), offset].filter((x) => x !== undefined && x !== "").join(" · ")}
        </span>
        <span slot="tertiary">
          {o.durationMs !== undefined && o.durationKind === "exact" && (
            <oj-c-meter-bar class="dbg-step__bar" size="sm" min={0} max={max} value={Math.min(max, Math.max(0, o.durationMs))} aria-label={`Duration ${durationText(o)}`} />
          )}
        </span>
        <span slot="metadata" class="oj-flex oj-sm-flex-wrap-nowrap">
          {marks.map((m) => <oj-c-badge key={m.label} class="dbg-badge oj-sm-margin-1x-start" size="sm" variant={m.variant} label={m.label} />)}
        </span>
      </oj-c-list-item-layout>
    );
  }, [run, props.breakpoints]);
  return (
    <oj-c-list-view data-testid="dbg-steps" class="dbg-steps" aria-label="Steps" data={data} selectionMode="single" selected={selected}
      onselectedChanged={(e) => {
        // Only the user's own choice: the selection the inspector sets echoes back as an "external" change.
        if (e.detail.updatedFrom !== "internal") return;
        const key = firstKey(e.detail.value);
        if (key !== null) {
          const index = Number(key.slice(1));
          if (index !== props.selected) props.onSelect(index);
        }
      }}>
      <template slot="itemTemplate" render={renderRow} />
      <template slot="noData" render={() => <div class="oj-typography-body-sm oj-text-color-secondary oj-sm-padding-2x">No node frames in this turn</div>} />
    </oj-c-list-view>
  );
}
