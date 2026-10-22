import { useState } from "preact/hooks";

export function Composer(props: { disabled: boolean; placeholder?: string; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const empty = text.trim() === "";
  const submit = (): void => {
    if (props.disabled || empty) return;
    props.onSend(text);
    setText("");
  };
  return (
    <form class="gai-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        class="gai-composer-input"
        data-testid="gai-composer-input"
        rows={2}
        aria-label="Message"
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
      <button type="submit" class="gai-button gai-button--primary" data-testid="gai-composer-send" disabled={props.disabled || empty}>
        Send
      </button>
    </form>
  );
}
