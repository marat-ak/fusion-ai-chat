import "oj-c/button";
import "oj-c/toggle-button";
import { useEffect, useState } from "preact/hooks";
import type { WaitInfo } from "../lib/state/conversation";
import { MessageArea } from "./MessageArea";
import type { ResumeAction, ResumeOptions } from "./useChatController";

/** Seconds before a WAIT node's Refresh is offered: the node's wait time plus a 15 s margin. */
const waitSeconds = (minutes: number): number => minutes * 60 + 15;
const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Whole seconds left of a countdown started at mount; 0 when there is none. */
function useCountdown(seconds: number | undefined): number {
  const total = seconds === undefined ? 0 : Math.floor(seconds);
  const [left, setLeft] = useState(total);
  useEffect(() => {
    if (total <= 0) return undefined;
    const end = Date.now() + total * 1000;
    const timer = setInterval(() => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [total]);
  return left;
}

/** A reply text with its Send button (Enter sends, Shift+Enter is a new line). */
function ReplyText(props: {
  testId: string; sendTestId: string; label: string; placeholder?: string; disabled: boolean; onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const empty = text.trim() === "";
  const submit = (): void => {
    if (props.disabled || empty) return;
    props.onSend(text.trim());
  };
  return (
    <div class="oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-flex-end">
      <MessageArea testId={props.testId} label={props.label} value={text} disabled={props.disabled}
        {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
        onInput={setText} onEnter={submit} />
      <oj-c-button class="oj-sm-margin-2x-start" data-testid={props.sendTestId} chroming="callToAction" label="Send"
        disabled={props.disabled || empty} onojAction={submit}>
        <span slot="startIcon" class="oj-ux-ico-send" />
      </oj-c-button>
    </div>
  );
}

/**
 * Shown instead of the composer while the agent waits on the user (the wait message is the last assistant bubble).
 * Controls by the node's flags: approval + feedback -> Approve / Request change (opens a reply text); approval only ->
 * Approve / Reject; no approval -> a free-text reply. A WAIT node keeps them disabled and counts down its wait time
 * (+15 s), then offers Refresh, a status check; without a wait time Refresh is offered at once. `disabled` (auth
 * problem, or the reply stream still open) disables every control.
 */
export function HitlBar(props: {
  wait: WaitInfo;
  disabled: boolean;
  onResume: (action: ResumeAction, content?: string, opts?: ResumeOptions) => void;
}) {
  const { wait, disabled, onResume } = props;
  const timed = wait.kind === "WAIT";
  const left = useCountdown(timed && wait.waitMinutes !== undefined ? waitSeconds(wait.waitMinutes) : undefined);
  const inputsDisabled = disabled || timed;
  const [changing, setChanging] = useState(false);

  return (
    <div class="oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-padding-3x-vertical oj-sm-padding-4x-horizontal oj-border-top"
      data-testid="gai-hitl" role="group" aria-label="Your response">
      {timed && (left > 0 ? (
        <div class="oj-typography-body-md oj-text-color-secondary oj-helper-tabular-nums oj-sm-margin-2x-bottom" data-testid="gai-hitl-countdown"
          role="timer" aria-live="off">{mmss(left)}</div>
      ) : (
        <div class="oj-sm-margin-2x-bottom">
          <oj-c-button data-testid="gai-hitl-refresh" chroming="callToAction" label="Refresh" disabled={disabled}
            onojAction={() => onResume("RFI_ACTION", undefined, { statusCheckOnly: true })}>
            <span slot="startIcon" class="oj-ux-ico-refresh" />
          </oj-c-button>
        </div>
      ))}
      {wait.approval && (
        <div class="oj-flex oj-sm-margin-2x-bottom">
          <oj-c-button class="oj-sm-margin-2x-end" data-testid="gai-hitl-approve" chroming="callToAction" label="Approve"
            disabled={inputsDisabled} onojAction={() => onResume("APPROVE_ACTION")} />
          {wait.feedback ? (
            <oj-c-toggle-button data-testid="gai-hitl-request-change" label="Request change" value={changing}
              disabled={inputsDisabled} onvalueChanged={(e) => setChanging(e.detail.value === true)} />
          ) : (
            <oj-c-button data-testid="gai-hitl-reject" chroming="outlined" label="Reject" disabled={inputsDisabled}
              onojAction={() => onResume("REJECT_ACTION")} />
          )}
        </div>
      )}
      {wait.approval && wait.feedback && changing && (
        <ReplyText testId="gai-hitl-change-text" sendTestId="gai-hitl-change-send" label="Requested change"
          {...(wait.requestChangeMessage !== undefined && { placeholder: wait.requestChangeMessage })}
          disabled={inputsDisabled} onSend={(text) => onResume("RFI_ACTION", text)} />
      )}
      {!wait.approval && (
        <ReplyText testId="gai-hitl-free-text" sendTestId="gai-hitl-free-send" label="Your reply"
          disabled={inputsDisabled} onSend={(text) => onResume("RFI_ACTION", text)} />
      )}
    </div>
  );
}
