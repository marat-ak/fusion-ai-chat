import "oj-c/avatar";
import "oj-c/badge";
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import type { Turn } from "../lib/state/conversation";
import { withoutEnvelopes } from "../lib/widgets/submit";
import type { Submit } from "../lib/widgets/submit";
import { AssistantContent } from "./Content";
import type { WidgetContext } from "./Content";

export interface MarkdownRenderer { render(md: string): string }

// A bubble is a rounded block without border (chat-styles.css .gai-bubble): white for the agent on the feed's neutral,
// a darker neutral for the user. Padding and wrapping come from utilities.
const BUBBLE = "gai-bubble oj-sm-padding-3x-vertical oj-sm-padding-4x-horizontal oj-helper-overflow-wrap-anywhere";
const USER = `${BUBBLE} gai-bubble--user oj-helper-white-space-pre-wrap`;
const ASSISTANT = `${BUBBLE} gai-bubble--assistant`;

/**
 * Start indent of content that belongs to the agent but has no avatar of its own (follow-ups, progress): the avatar's
 * width (xs = 11x) plus its gap (3x), as margin + padding utilities (12x + 2x).
 */
export const AGENT_INDENT = "oj-sm-margin-12x-start oj-sm-padding-2x-start";

/** The agent's avatar: a flat Redwood avatar with the AI icon (decorative; the texture is removed in chat-styles.css). */
export function AgentAvatar(props: { size: "2xs" | "xs"; class?: string }) {
  return (
    <oj-c-avatar class={`gai-avatar${props.class !== undefined ? " " + props.class : ""}`} size={props.size} shape="square"
      background="teal" iconClass="oj-ux-ico-oracle-ai" />
  );
}

/** A transcript line of the agent: its avatar, then the content. */
export function AgentRow(props: { children: ComponentChildren }) {
  return (
    <div class="oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-flex-start oj-sm-margin-4x-bottom">
      <AgentAvatar size="xs" class="oj-sm-margin-3x-end" />
      {props.children}
    </div>
  );
}

/** A transcript line of the user: the bubble on the user's side, no avatar. */
function UserRow(props: { children: ComponentChildren }) {
  return <div class="oj-flex oj-sm-flex-wrap-nowrap oj-sm-justify-content-flex-end oj-sm-margin-4x-bottom">{props.children}</div>;
}

/**
 * User turns are plain text (a widget submit shows its readable line; the envelope stays in the sent message); assistant
 * turns are markdown sanitized by the renderer (plain text until it has loaded) with their gnimsys-ui blocks rendered by
 * WidgetHost (`widgets`; `submitted` = the submits of the user turns after this one, which make its blocks read-only).
 */
export function Bubble(props: { turn: Turn; renderer: MarkdownRenderer | null; widgets?: WidgetContext; submitted?: Submit[] }) {
  const { turn, renderer } = props;
  const submitted = useMemo(() => props.submitted ?? [], [props.submitted]);

  if (turn.role === "user") {
    const files = turn.attachments ?? [];
    return (
      <UserRow>
        <div class={USER} data-testid="gai-bubble-user">
          {withoutEnvelopes(turn.text)}
          {files.length > 0 && (
            <div role="list" class="oj-flex oj-helper-white-space-normal oj-sm-margin-1x-top">
              {files.map((a, i) => (
                <oj-c-badge key={i} role="listitem" class="oj-sm-margin-1x-end" variant="neutralSubtle" label={a.fileName}
                  data-testid="gai-bubble-attachment" />
              ))}
            </div>
          )}
        </div>
      </UserRow>
    );
  }
  if (turn.error) {
    const meta = [turn.error.code, turn.error.status !== undefined ? "HTTP " + turn.error.status : undefined].filter(Boolean).join(" · ");
    const afterText = turn.text !== "";
    // The text received before the failure (if any), then the error itself unless it is that same text.
    return (
      <AgentRow>
        <div class={`${ASSISTANT} gai-bubble--error oj-bg-danger-10 oj-text-color-danger oj-helper-white-space-pre-wrap`} data-testid="gai-error" role="alert">
          {afterText && <div>{turn.text}</div>}
          {turn.error.message !== turn.text && (
            <div class={afterText ? "oj-typography-semi-bold oj-sm-margin-1x-top" : undefined} data-testid="gai-error-message">{turn.error.message}</div>
          )}
          {meta !== "" && <div class="oj-typography-body-xs oj-text-color-secondary oj-sm-margin-1x-top">{meta}</div>}
        </div>
      </AgentRow>
    );
  }
  return (
    <AgentRow>
      <div class={`${ASSISTANT} oj-bg-neutral-0`} data-testid="gai-bubble-assistant">
        <AssistantContent text={turn.text} renderer={renderer} {...(props.widgets !== undefined && { ctx: props.widgets })} submitted={submitted} />
      </div>
    </AgentRow>
  );
}
