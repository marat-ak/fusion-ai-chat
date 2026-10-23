import "oj-c/button";
import "oj-c/progress-circle";
import "oj-c/truncating-text";
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

/** Text after the name by upload state (an uploading chip shows a progress circle instead). */
const STATE_LABEL: Record<PendingFile["state"], string> = { pending: "", uploading: "", uploaded: "Uploaded", failed: "" };
/** Redwood background of a chip by upload state (a pending chip keeps the panel's own background). */
const STATE_BG: Record<PendingFile["state"], string> = { pending: "", uploading: "oj-bg-info-10", uploaded: "oj-bg-info-10", failed: "oj-bg-danger-10" };

/**
 * The attach button and its hidden file input (picked files go to the tray, which validates them). The input stays:
 * oj-c-file-picker refuses a whole pick when one file misses `accept` and reports it with its own messages, so it cannot
 * carry the tray's per-file count/size/type verdicts while keeping the browser dialog's type filter.
 */
export function AttachButton(props: { tray: AttachmentTray; accept: string[]; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
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
      <oj-c-button class="oj-sm-margin-1x-end" data-testid="gai-attach" chroming="borderless" display="icons" label="Attach files"
        disabled={props.disabled} onojAction={() => input.current?.click()}>
        <span slot="startIcon" class="oj-ux-ico-attach-file" />
      </oj-c-button>
    </>
  );
}

/**
 * Pending files (with their upload state) and the files refused at the last pick. A chip is a Redwood panel with utility
 * classes: the Core Pack has no chip / file-list component (oj-c-badge holds a label only, no remove action or state).
 * The refusals stay inline next to the composer, like field validation, until the next pick or send.
 */
export function AttachmentList(props: { tray: AttachmentTray; maxSizeMB: number }) {
  const { pending, rejected, uploading } = props.tray;
  if (pending.length === 0 && rejected.length === 0) return null;
  return (
    <div class="oj-sm-margin-2x-bottom">
      {pending.length > 0 && (
        <div role="list" class="oj-flex">
          {pending.map((p) => (
            <div key={p.id} role="listitem" data-testid="gai-attach-chip" data-state={p.state}
              class={`oj-panel oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-center oj-sm-padding-0-vertical oj-sm-padding-3x-start oj-sm-padding-0-end oj-sm-margin-2x-end oj-sm-margin-1x-bottom oj-typography-body-sm ${STATE_BG[p.state]}`}>
              <oj-c-truncating-text class="gai-attach-name gai-shrink" value={p.file.name} truncation="ellipsis" />
              <span class="oj-text-color-secondary oj-helper-white-space-nowrap oj-sm-margin-2x-start">{formatSize(p.file.size)}</span>
              {p.state === "uploading" && (
                <oj-c-progress-circle class="oj-sm-margin-2x-start" size="sm" value={-1} aria-label={`Uploading ${p.file.name}`} />
              )}
              {STATE_LABEL[p.state] !== "" && (
                <span class="oj-text-color-secondary oj-helper-white-space-nowrap oj-sm-margin-2x-start">{STATE_LABEL[p.state]}</span>
              )}
              {p.state === "failed" && <span class="oj-text-color-danger oj-sm-margin-2x-start" role="alert">{p.error}</span>}
              <oj-c-button class="oj-sm-margin-1x-start" data-testid="gai-attach-remove" chroming="borderless" display="icons" size="sm"
                label={`Remove ${p.file.name}`} disabled={uploading} onojAction={() => props.tray.remove(p.id)}>
                <span slot="startIcon" class="oj-ux-ico-close" />
              </oj-c-button>
            </div>
          ))}
        </div>
      )}
      {rejected.map((r, i) => (
        <div key={i} class="oj-typography-body-sm oj-text-color-danger" data-testid="gai-attach-rejected" role="alert">{rejectionText(r, props.maxSizeMB)}</div>
      ))}
    </div>
  );
}
