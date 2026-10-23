import "oj-c/button";
import { useRef, useState } from "preact/hooks";
import { AttachButton, AttachmentList } from "./Attachments";
import { MessageArea } from "./MessageArea";
import type { AttachmentTray } from "./useChatController";

export interface ComposerAttachments { tray: AttachmentTray; accept: string[]; maxSizeMB: number }

export function Composer(props: {
  disabled: boolean;
  placeholder: string;
  /** Resolves whether the message was sent; the text is kept when it was not (e.g. a failed upload). */
  onSend: (text: string) => Promise<boolean>;
  /** Present when files are enabled. */
  attachments?: ComposerAttachments;
}) {
  const [text, setText] = useState("");
  const current = useRef(text);
  current.current = text;
  // Bumped to empty the field after a send (see MessageArea).
  const [field, setField] = useState(0);
  const empty = text.trim() === "";
  const att = props.attachments;
  const submit = (): void => {
    if (props.disabled || empty) return;
    const sent = text;
    void props.onSend(sent).then((ok) => {
      // Emptied only if the text is still the one sent.
      if (ok && current.current === sent) {
        setText("");
        setField((n) => n + 1);
      }
    });
  };
  // One slim bar on the content surface under a divider: attach (when files are on), the field, the send icon button.
  return (
    <div class="oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-padding-2x-vertical oj-sm-padding-3x-horizontal oj-bg-neutral-0 oj-border-top">
      {att && <AttachmentList tray={att.tray} maxSizeMB={att.maxSizeMB} />}
      <div class="oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-flex-end">
        {att && <AttachButton tray={att.tray} accept={att.accept} disabled={props.disabled} />}
        <MessageArea key={field} testId="gai-composer-input" label="Message" value={text} disabled={props.disabled}
          placeholder={props.placeholder} onInput={setText} onEnter={submit} />
        <oj-c-button class="oj-sm-margin-2x-start" data-testid="gai-composer-send" chroming="callToAction" display="icons" label="Send"
          disabled={props.disabled || empty} onojAction={submit}>
          <span slot="startIcon" class="oj-ux-ico-send" />
        </oj-c-button>
      </div>
    </div>
  );
}
