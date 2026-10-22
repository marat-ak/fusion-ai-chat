import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ChatState, Turn } from "../lib/state/conversation";
import { Bubble } from "./Bubble";
import type { MarkdownRenderer } from "./Bubble";

export function Feed(props: {
  turns: Turn[];
  /** A turn is in flight: show the progress line under the streaming bubble. */
  busy: boolean;
  progressText?: string;
  renderer: MarkdownRenderer | null;
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
    <div class="gai-feed" ref={ref} role="log" aria-live="polite">
      {props.historyStatus === "unavailable" && (
        <div class="gai-history-notice gai-history-notice--unavailable" data-testid="gai-history-unavailable" role="status">
          History unavailable{err?.status ? ` (HTTP ${err.status})` : ""}{err?.text ? `: ${err.text}` : ""}
        </div>
      )}
      {props.turns.map((t) =>
        // An assistant turn that has not produced text (nor failed) yet is represented by the progress line alone.
        t.role === "assistant" && t.streaming && t.text === "" && !t.error ? null : <Bubble key={t.id} turn={t} renderer={props.renderer} />,
      )}
      {props.busy && (
        <div class="gai-progress" data-testid="gai-progress" role="status">
          {props.progressText ? props.progressText : (
            <span class="gai-typing" aria-label="Working"><span /><span /><span /></span>
          )}
        </div>
      )}
      {props.children}
      {props.historyStatus === "loading" && (
        <div class="gai-history-notice" data-testid="gai-history-loading" role="status">{"Loading history…"}</div>
      )}
    </div>
  );
}
