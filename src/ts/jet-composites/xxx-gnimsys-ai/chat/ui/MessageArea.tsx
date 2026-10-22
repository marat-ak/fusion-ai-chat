import "oj-c/text-area";
import { useRef } from "preact/hooks";

/**
 * A two-row message field (Redwood text area, label hidden and used as the accessible name). The text is controlled:
 * every keystroke reports the raw text, so the caller's Send state follows it. Enter sends, Shift+Enter is a new line,
 * and an Enter that ends an IME composition is left to the IME. To empty the field after a send, the caller remounts it
 * (a new `key`): the field commits its text when it is disabled while focused, after the clear, and that late commit
 * would bring the sent text back.
 */
export function MessageArea(props: {
  testId: string;
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onInput: (text: string) => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <oj-c-text-area
      ref={ref}
      class="oj-sm-flex-1"
      data-testid={props.testId}
      labelHint={props.label}
      labelEdge="none"
      rows={2}
      resizeBehavior="none"
      userAssistanceDensity="compact"
      value={props.value}
      disabled={props.disabled}
      {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
      // Events of a field already replaced by a remount (its late commit) are not the current text.
      onrawValueChanged={(e) => { if (e.currentTarget === ref.current) props.onInput(e.detail.value ?? ""); }}
      // Capture phase: decided before the field's own key handling (the newline is prevented, not inserted then removed).
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          props.onEnter();
        }
      }}
    />
  );
}
