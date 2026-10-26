import "oj-c/progress-circle";
import { Fragment } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ChatState, Turn } from "../lib/state/conversation";
import { Banner } from "./Banner";
import { AGENT_INDENT, Bubble } from "./Bubble";
import { TracePanel } from "./TracePanel";
import type { MarkdownRenderer } from "./Bubble";
import type { WidgetContext } from "./Content";
import { submitsIn } from "../lib/widgets/submit";
import type { Submit } from "../lib/widgets/submit";

const SECONDARY = "oj-typography-body-sm oj-text-color-secondary oj-sm-margin-2x-bottom";

/** The widget submits carried by the user turns after turn `i` (contract §3: they make that turn's blocks read-only). */
function submitsAfter(turns: Turn[], i: number): Submit[] {
  const out: Submit[] = [];
  for (let j = i + 1; j < turns.length; j++) if (turns[j].role === "user") out.push(...submitsIn(turns[j].text));
  return out;
}

export function Feed(props: {
  turns: Turn[];
  /** The gnimsys-ui blocks' context (datasource policy, fetch, submit); absent = blocks render as raw text. */
  widgets?: WidgetContext;
  /** A turn is in flight: show the progress line under the streaming bubble. */
  busy: boolean;
  progressText?: string;
  renderer: MarkdownRenderer | null;
  /** The trace gate is open: assistant turns show their node trace. */
  showTrace: boolean;
  /**
   * History of an opened conversation: "unavailable" shows a notice at the top of the feed (it stays above the turns
   * sent afterwards); "loading" shows one at the end, above the composer.
   */
  historyStatus: ChatState["historyStatus"];
  /** The failed history load: HTTP status (0 when the request did not get an HTTP answer) and readable error body. */
  historyError?: { status: number; text?: string };
  children?: ComponentChildren;
}) {
  const err = props.historyError;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return (
    <div class="gai-feed oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-flex-1 oj-sm-padding-4x oj-bg-neutral-20" ref={ref}
      role="log" aria-live="polite">
      {props.historyStatus === "unavailable" && (
        <Banner testId="gai-history-unavailable" severity="warning" class="oj-sm-margin-2x-bottom"
          summary={`History unavailable${err?.status ? ` (HTTP ${err.status})` : ""}${err?.text ? `: ${err.text}` : ""}`} />
      )}
      {props.turns.map((t, i) => (
        <Fragment key={t.id}>
          {/* An assistant turn that has not produced text (nor failed) yet is represented by the progress line alone. */}
          {t.role === "assistant" && t.streaming && t.text === "" && !t.error ? null : (
            <Bubble turn={t} renderer={props.renderer} {...(props.widgets !== undefined && { widgets: props.widgets })}
              {...(t.role === "assistant" && { submitted: submitsAfter(props.turns, i) })} />
          )}
          {props.showTrace && t.role === "assistant" && t.trace !== undefined && t.trace.length > 0 && <TracePanel entries={t.trace} />}
        </Fragment>
      ))}
      {props.busy && (
        <div class={`oj-flex oj-sm-align-items-center oj-sm-align-self-flex-start ${AGENT_INDENT} ${SECONDARY}`}
          data-testid="gai-progress" role="status">
          {props.progressText ? props.progressText : <oj-c-progress-circle size="sm" value={-1} aria-label="Working" />}
        </div>
      )}
      {props.children}
      {props.historyStatus === "loading" && (
        <div class={`oj-flex oj-sm-align-items-center oj-sm-align-self-center ${SECONDARY}`} data-testid="gai-history-loading" role="status">
          <oj-c-progress-circle class="oj-sm-margin-2x-end" size="sm" value={-1} aria-label="Loading" />{"Loading history…"}
        </div>
      )}
    </div>
  );
}
