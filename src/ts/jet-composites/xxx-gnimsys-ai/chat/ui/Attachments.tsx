import { useRef } from "preact/hooks";
import type { Rejection } from "../lib/files/AttachmentService";
import type { AttachmentTray, PendingFile } from "./useChatController";

/** `files.accept` as an <input accept> list: a bare extension gets its dot, a MIME pattern (image/*) stays as is. */
function acceptAttr(accept: string[]): string {
  return accept.map((a) => (a.startsWith(".") || a.includes("/") ? a : "." + a)).join(",");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rejectionText(r: Rejection, maxSizeMB: number): string {
  const why = r.reason === "count" ? "too many files" : r.reason === "size" ? `too large (max ${maxSizeMB} MB)` : "type not allowed";
  return `${r.file.name}: ${why}`;
}

const STATE_LABEL: Record<PendingFile["state"], string> = { pending: "", uploading: "Uploading…", uploaded: "Uploaded", failed: "" };

/** The attach button and its hidden file input (picked files go to the tray, which validates them). */
export function AttachButton(props: { tray: AttachmentTray; accept: string[]; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        class="gai-attach-input"
        data-testid="gai-attach-input"
        accept={acceptAttr(props.accept)}
        disabled={props.disabled}
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          const files = el.files ? Array.from(el.files) : [];
          el.value = ""; // picking the same file again fires change again
          props.tray.add(files);
        }}
      />
      <button type="button" class="gai-button gai-attach" data-testid="gai-attach" aria-label="Attach files"
        disabled={props.disabled} onClick={() => input.current?.click()}>
        Attach
      </button>
    </>
  );
}

/** Pending files (with their upload state) and the files refused at the last pick. */
export function AttachmentList(props: { tray: AttachmentTray; maxSizeMB: number }) {
  const { pending, rejected, uploading } = props.tray;
  if (pending.length === 0 && rejected.length === 0) return null;
  return (
    <div class="gai-attachments">
      {pending.length > 0 && (
        <ul class="gai-attach-chips">
          {pending.map((p) => (
            <li key={p.id} class={`gai-attach-chip gai-attach-chip--${p.state}`} data-testid="gai-attach-chip" data-state={p.state}>
              <span class="gai-attach-name">{p.file.name}</span>
              <span class="gai-attach-size">{formatSize(p.file.size)}</span>
              {STATE_LABEL[p.state] !== "" && <span class="gai-attach-status">{STATE_LABEL[p.state]}</span>}
              {p.state === "failed" && <span class="gai-attach-error" role="alert">{p.error}</span>}
              <button type="button" class="gai-attach-remove" data-testid="gai-attach-remove" aria-label={`Remove ${p.file.name}`}
                disabled={uploading} onClick={() => props.tray.remove(p.id)}>
                {"×"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {rejected.map((r, i) => (
        <div key={i} class="gai-attach-rejected" data-testid="gai-attach-rejected" role="alert">{rejectionText(r, props.maxSizeMB)}</div>
      ))}
    </div>
  );
}
