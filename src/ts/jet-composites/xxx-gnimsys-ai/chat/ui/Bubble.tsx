import { useMemo } from "preact/hooks";
import type { Turn } from "../lib/state/conversation";

export interface MarkdownRenderer { render(md: string): string }

// Redwood panel as the bubble: border, radius and content background; the side and colour come per role below.
const BUBBLE = "gai-bubble oj-panel oj-sm-padding-3x-horizontal oj-sm-margin-2x-bottom oj-helper-overflow-wrap-anywhere";
const USER = `${BUBBLE} gai-bubble--user oj-sm-align-self-flex-end oj-bg-brand-10 oj-helper-white-space-pre-wrap`;
const ASSISTANT = `${BUBBLE} gai-bubble--assistant oj-sm-align-self-flex-start`;

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
      <div class={USER} data-testid="gai-bubble-user">
        {turn.text}
        {files.length > 0 && (
          <div role="list" class="oj-flex oj-helper-white-space-normal oj-sm-margin-1x-top">
            {files.map((a, i) => (
              <span key={i} role="listitem" class="oj-badge oj-badge-subtle oj-sm-margin-1x-end" data-testid="gai-bubble-attachment">{a.fileName}</span>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (turn.error) {
    const meta = [turn.error.code, turn.error.status !== undefined ? "HTTP " + turn.error.status : undefined].filter(Boolean).join(" · ");
    const afterText = turn.text !== "";
    // The text received before the failure (if any), then the error itself unless it is that same text.
    return (
      <div class={`${ASSISTANT} gai-bubble--error oj-bg-danger-10 oj-text-color-danger oj-helper-white-space-pre-wrap`} data-testid="gai-error" role="alert">
        {afterText && <div>{turn.text}</div>}
        {turn.error.message !== turn.text && (
          <div class={afterText ? "oj-typography-semi-bold oj-sm-margin-1x-top" : undefined} data-testid="gai-error-message">{turn.error.message}</div>
        )}
        {meta !== "" && <div class="oj-typography-body-xs oj-text-color-secondary oj-sm-margin-1x-top">{meta}</div>}
      </div>
    );
  }
  if (html !== null) {
    return <div class={`${ASSISTANT} oj-bg-neutral-20 gai-md`} data-testid="gai-bubble-assistant" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <div class={`${ASSISTANT} oj-bg-neutral-20 oj-helper-white-space-pre-wrap`} data-testid="gai-bubble-assistant">{turn.text}</div>;
}
