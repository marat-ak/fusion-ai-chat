import "oj-c/collapsible";
import { useState } from "preact/hooks";
import type { TraceEntry } from "../lib/transport/events";

/** Collapsible list of the agent's node progress frames, shown under an assistant reply to users passing the trace gate. */
export function TracePanel(props: { entries: TraceEntry[] }) {
  const [open, setOpen] = useState(false);
  const { entries } = props;
  if (entries.length === 0) return null;
  const traceId = entries.find((e) => e.traceId !== undefined)?.traceId;
  return (
    <oj-c-collapsible class="oj-sm-align-self-flex-start oj-sm-margin-2x-bottom" expanded={open}
      onexpandedChanged={(e) => setOpen(e.detail.value === true)}>
      <span slot="header" class="oj-typography-body-xs oj-text-color-secondary" data-testid="gai-trace-toggle">
        {`Trace (${entries.length})`}
      </span>
      {/* Rows are rendered only while expanded. The fixed wrapper is the element's one default-slot node (it moves its
          slot nodes into its own layout, so a slot node that comes and goes would not be removed). */}
      <div>
        {open && (
          <div class="oj-panel oj-typography-body-xs oj-text-color-secondary oj-helper-white-space-pre-wrap oj-helper-overflow-wrap-anywhere"
            data-testid="gai-trace">
            {traceId !== undefined && <div data-testid="gai-trace-id"><code>{`traceId ${traceId}`}</code></div>}
            {entries.map((e, i) => (
              <div key={i} data-testid="gai-trace-row" data-node-type={e.nodeType}>
                <code>{`${e.nodeType} ${e.nodeCode}${e.kind !== undefined ? ` (${e.kind})` : ""}${e.message !== undefined ? ` — ${e.message}` : ""}`}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </oj-c-collapsible>
  );
}
