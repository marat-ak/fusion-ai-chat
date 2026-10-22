import { useMemo } from "preact/hooks";
import type { Turn } from "../lib/state/conversation";

export interface MarkdownRenderer { render(md: string): string }

/** User turns are plain text; assistant turns are markdown sanitized by the renderer (plain text until it has loaded). */
export function Bubble(props: { turn: Turn; renderer: MarkdownRenderer | null }) {
  const { turn, renderer } = props;
  const html = useMemo(
    () => (turn.role === "assistant" && !turn.error && renderer ? renderer.render(turn.text) : null),
    [turn.role, turn.error, turn.text, renderer],
  );

  if (turn.role === "user") {
    const files = turn.attachments ?? [];
    return (
      <div class="gai-bubble gai-bubble--user" data-testid="gai-bubble-user">
        {turn.text}
        {files.length > 0 && (
          <ul class="gai-bubble-attachments">
            {files.map((a, i) => <li key={i} class="gai-bubble-attachment" data-testid="gai-bubble-attachment">{a.fileName}</li>)}
          </ul>
        )}
      </div>
    );
  }
  if (turn.error) {
    const meta = [turn.error.code, turn.error.status !== undefined ? "HTTP " + turn.error.status : undefined].filter(Boolean).join(" · ");
    return (
      <div class="gai-bubble gai-bubble--assistant gai-bubble--error" data-testid="gai-error" role="alert">
        <div class="gai-bubble-text">{turn.text}</div>
        {meta !== "" && <div class="gai-error-meta">{meta}</div>}
      </div>
    );
  }
  if (html !== null) {
    return <div class="gai-bubble gai-bubble--assistant gai-md" data-testid="gai-bubble-assistant" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <div class="gai-bubble gai-bubble--assistant gai-bubble--plain" data-testid="gai-bubble-assistant">{turn.text}</div>;
}
