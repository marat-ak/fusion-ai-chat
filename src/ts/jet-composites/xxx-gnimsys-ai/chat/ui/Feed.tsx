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
  /** History of an opened conversation: loading / unavailable show a notice at the end of the feed, above the composer. */
  historyStatus: ChatState["historyStatus"];
  /** HTTP status of the failed history load (0 when the request did not get an HTTP answer). */
  historyError?: number;
  children?: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return (
    <div class="gai-feed" ref={ref} role="log" aria-live="polite">
      {props.turns.map((t) =>
        // An assistant turn that has not produced text yet is represented by the progress line alone.
        t.role === "assistant" && t.streaming && t.text === "" ? null : <Bubble key={t.id} turn={t} renderer={props.renderer} />,
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
      {props.historyStatus === "unavailable" && (
        <div class="gai-history-notice gai-history-notice--unavailable" data-testid="gai-history-unavailable" role="status">
          History unavailable{props.historyError ? ` (HTTP ${props.historyError})` : ""}
        </div>
      )}
    </div>
  );
}
