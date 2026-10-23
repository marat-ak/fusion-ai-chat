import "oj-c/text-area";
import { useEffect, useRef } from "preact/hooks";

/**
 * A message field that starts as one row and grows with its text up to five (Redwood text area, label hidden and used
 * as the accessible name). The text is controlled: every keystroke reports the text, so the caller's Send state follows
 * it. Enter sends, Shift+Enter is a new line, and an Enter that ends an IME composition is left to the IME.
 *
 * The caller empties the field after a send by setting `value` to "" in the render that disables the field. The field is
 * never remounted for that: a newly created Core Pack element replays the property sets it got before its asynchronous
 * creation after any later ones (JET IntrinsicElement early sets), so a new field whose `disabled` flips back within
 * milliseconds (a send that fails at once) would stay disabled. Three behaviours of the field are handled instead:
 * - Only user edits are reported: the DOM `input` events of the inner textarea. The field's rawValueChanged also echoes
 *   programmatic value changes (an emptied or restored field) a moment later, which would overwrite newer text.
 * - The sending Enter does not reach the field: its own Enter handling would commit the typed text asynchronously, after
 *   the clear, and bring the sent text back.
 * - A focused field that gets disabled loses the focus while it still shows the sent text, and its blur commits that text
 *   (again after the clear). On such a blur the textarea is aligned with `value` first, so the commit is an empty one.
 * The listeners sit on the element because its typings have no onInput/onBlur.
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
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onInput = (e: Event): void => latest.current.onInput((e.target as HTMLTextAreaElement).value);
    // Capture phase: runs before the field's own blur handler on the textarea. Only a blur caused by disabling the field
    // is touched (the textarea is already disabled then); a user's blur leaves the field alone.
    const onBlur = (e: Event): void => {
      const t = e.target;
      if (t instanceof HTMLTextAreaElement && t.disabled && t.value !== latest.current.value) t.value = latest.current.value;
    };
    el.addEventListener("input", onInput);
    el.addEventListener("blur", onBlur, true);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("blur", onBlur, true);
    };
  }, []);
  return (
    <oj-c-text-area
      ref={ref}
      class="oj-sm-flex-1"
      data-testid={props.testId}
      labelHint={props.label}
      labelEdge="none"
      rows={1}
      maxRows={5}
      resizeBehavior="none"
      userAssistanceDensity="compact"
      value={props.value}
      disabled={props.disabled}
      {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
      // Capture phase: decided before the field's own key handling (the newline is prevented, not inserted then removed,
      // and the field does not commit on this Enter).
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          props.onEnter();
        }
      }}
    />
  );
}
