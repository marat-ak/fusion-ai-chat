import "oj-c/avatar";
import "oj-c/badge";
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import type { Turn } from "../lib/state/conversation";

export interface MarkdownRenderer { render(md: string): string }

// Redwood panel as the bubble: border, radius and content background; the colour comes per role below.
const BUBBLE = "gai-bubble oj-panel oj-sm-padding-3x-horizontal oj-helper-overflow-wrap-anywhere";
const USER = `${BUBBLE} gai-bubble--user oj-bg-brand-10 oj-helper-white-space-pre-wrap`;
const ASSISTANT = `${BUBBLE} gai-bubble--assistant`;

/** One transcript line: the agent's avatar before its bubble, the user's (initials) after theirs, on the user's side. */
function TurnRow(props: { user: boolean; initials?: string; children: ComponentChildren }) {
  const { user } = props;
  return (
    <div class={`oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-flex-start oj-sm-margin-2x-bottom${user ? " oj-sm-justify-content-flex-end" : ""}`}>
      {!user && <oj-c-avatar class="oj-sm-margin-2x-end" size="xs" iconClass="oj-ux-ico-oracle-ai" />}
      {props.children}
      {user && <oj-c-avatar class="oj-sm-margin-2x-start" size="xs" initials={props.initials ?? null} />}
    </div>
  );
}

/**
 * User turns are plain text; assistant turns are markdown sanitized by the renderer (plain text until it has loaded).
 * `userInitials` (from the user name) label the user's avatar; without them it shows the Redwood placeholder.
 */
export function Bubble(props: { turn: Turn; renderer: MarkdownRenderer | null; userInitials?: string }) {
  const { turn, renderer } = props;
  const html = useMemo(
    () => (turn.role === "assistant" && !turn.error && renderer ? renderer.render(turn.text) : null),
    [turn.role, turn.error, turn.text, renderer],
  );

  if (turn.role === "user") {
    const files = turn.attachments ?? [];
    return (
      <TurnRow user {...(props.userInitials !== undefined && { initials: props.userInitials })}>
        <div class={USER} data-testid="gai-bubble-user">
          {turn.text}
          {files.length > 0 && (
            <div role="list" class="oj-flex oj-helper-white-space-normal oj-sm-margin-1x-top">
              {files.map((a, i) => (
                <oj-c-badge key={i} role="listitem" class="oj-sm-margin-1x-end" variant="neutralSubtle" label={a.fileName}
                  data-testid="gai-bubble-attachment" />
              ))}
            </div>
          )}
        </div>
      </TurnRow>
    );
  }
  if (turn.error) {
    const meta = [turn.error.code, turn.error.status !== undefined ? "HTTP " + turn.error.status : undefined].filter(Boolean).join(" · ");
    const afterText = turn.text !== "";
    // The text received before the failure (if any), then the error itself unless it is that same text.
    return (
      <TurnRow user={false}>
        <div class={`${ASSISTANT} gai-bubble--error oj-bg-danger-10 oj-text-color-danger oj-helper-white-space-pre-wrap`} data-testid="gai-error" role="alert">
          {afterText && <div>{turn.text}</div>}
          {turn.error.message !== turn.text && (
            <div class={afterText ? "oj-typography-semi-bold oj-sm-margin-1x-top" : undefined} data-testid="gai-error-message">{turn.error.message}</div>
          )}
          {meta !== "" && <div class="oj-typography-body-xs oj-text-color-secondary oj-sm-margin-1x-top">{meta}</div>}
        </div>
      </TurnRow>
    );
  }
  return (
    <TurnRow user={false}>
      {html !== null
        ? <div class={`${ASSISTANT} oj-bg-neutral-20 gai-md`} data-testid="gai-bubble-assistant" dangerouslySetInnerHTML={{ __html: html }} />
        : <div class={`${ASSISTANT} oj-bg-neutral-20 oj-helper-white-space-pre-wrap`} data-testid="gai-bubble-assistant">{turn.text}</div>}
    </TurnRow>
  );
}
