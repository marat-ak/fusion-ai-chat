import { useState } from "preact/hooks";
import type { TraceEntry } from "../lib/transport/events";

/** Collapsible list of the agent's node progress frames, shown under an assistant reply to users passing the trace gate. */
export function TracePanel(props: { entries: TraceEntry[] }) {
  const [open, setOpen] = useState(false);
  const { entries } = props;
  if (entries.length === 0) return null;
  const traceId = entries.find((e) => e.traceId !== undefined)?.traceId;
  return (
    <div class="gai-trace-wrap">
      <button type="button" class="gai-trace-toggle" data-testid="gai-trace-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {`Trace (${entries.length})`}
      </button>
      {open && (
        <div class="gai-trace" data-testid="gai-trace">
          {traceId !== undefined && <div class="gai-trace-id" data-testid="gai-trace-id">{`traceId ${traceId}`}</div>}
          {entries.map((e, i) => (
            <div key={i} class="gai-trace-row" data-testid="gai-trace-row" data-node-type={e.nodeType}>
              {`${e.nodeType} ${e.nodeCode}${e.kind !== undefined ? ` (${e.kind})` : ""}${e.message !== undefined ? ` — ${e.message}` : ""}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
