import { useEffect, useState } from "preact/hooks";
import type { WaitInfo } from "../lib/state/conversation";
import type { ResumeAction, ResumeOptions } from "./useChatController";

/** Seconds before a WAIT node's Refresh is offered: the node's wait time plus a 15 s margin. */
const waitSeconds = (minutes: number): number => minutes * 60 + 15;
const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Seconds left of a countdown started at mount; 0 when there is none. */
function useCountdown(seconds: number | undefined): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (seconds === undefined) return undefined;
    const end = Date.now() + seconds * 1000;
    const tick = (): void => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [seconds]);
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
    <form class="gai-hitl-reply" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        class="gai-hitl-input"
        data-testid={props.testId}
        rows={2}
        aria-label={props.label}
        value={text}
        disabled={props.disabled}
        {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
        onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" class="gai-button gai-button--primary" data-testid={props.sendTestId} disabled={props.disabled || empty}>
        Send
      </button>
    </form>
  );
}

/**
 * Shown instead of the composer while the agent waits on the user (the wait message is the last assistant bubble).
 * Controls by the node's flags: approval + feedback -> Approve / Request change (opens a reply text); approval only ->
 * Approve / Reject; no approval -> a free-text reply. A WAIT node keeps them disabled and counts down its wait time
 * (+15 s), then offers Refresh, a status check; without a wait time Refresh is offered at once.
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
    <div class="gai-hitl" data-testid="gai-hitl" role="group" aria-label="Your response">
      {timed && (left > 0 ? (
        <div class="gai-hitl-countdown" data-testid="gai-hitl-countdown" role="timer" aria-live="off">{mmss(left)}</div>
      ) : (
        <button type="button" class="gai-button gai-button--primary" data-testid="gai-hitl-refresh" disabled={disabled}
          onClick={() => onResume("RFI_ACTION", undefined, { statusCheckOnly: true })}>
          Refresh
        </button>
      ))}
      {wait.approval && (
        <div class="gai-hitl-actions">
          <button type="button" class="gai-button gai-button--primary" data-testid="gai-hitl-approve" disabled={inputsDisabled}
            onClick={() => onResume("APPROVE_ACTION")}>
            Approve
          </button>
          {wait.feedback ? (
            <button type="button" class="gai-button" data-testid="gai-hitl-request-change" disabled={inputsDisabled}
              aria-expanded={changing} onClick={() => setChanging((c) => !c)}>
              Request change
            </button>
          ) : (
            <button type="button" class="gai-button" data-testid="gai-hitl-reject" disabled={inputsDisabled}
              onClick={() => onResume("REJECT_ACTION")}>
              Reject
            </button>
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
