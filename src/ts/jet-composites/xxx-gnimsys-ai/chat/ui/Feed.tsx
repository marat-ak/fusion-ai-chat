import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Turn } from "../lib/state/conversation";
import { Bubble } from "./Bubble";
import type { MarkdownRenderer } from "./Bubble";

export function Feed(props: {
  turns: Turn[];
  /** A turn is in flight: show the progress line under the streaming bubble. */
  busy: boolean;
  progressText?: string;
  renderer: MarkdownRenderer | null;
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
    </div>
  );
}
