import { useState } from "preact/hooks";
import { AttachButton, AttachmentList } from "./Attachments";
import type { AttachmentTray } from "./useChatController";

export interface ComposerAttachments { tray: AttachmentTray; accept: string[]; maxSizeMB: number }

export function Composer(props: {
  disabled: boolean;
  placeholder?: string;
  /** Resolves whether the message was sent; the text is kept when it was not (e.g. a failed upload). */
  onSend: (text: string) => Promise<boolean>;
  /** Present when files are enabled. */
  attachments?: ComposerAttachments;
}) {
  const [text, setText] = useState("");
  const empty = text.trim() === "";
  const att = props.attachments;
  const submit = (): void => {
    if (props.disabled || empty) return;
    const sent = text;
    void props.onSend(sent).then((ok) => { if (ok) setText((cur) => (cur === sent ? "" : cur)); });
  };
  return (
    <div class="gai-composer">
      {att && <AttachmentList tray={att.tray} maxSizeMB={att.maxSizeMB} />}
      <form class="gai-composer-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {att && <AttachButton tray={att.tray} accept={att.accept} disabled={props.disabled} />}
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
    </div>
  );
}
