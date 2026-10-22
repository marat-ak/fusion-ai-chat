import type { AuthReason } from "../lib/auth/AuthFetch";
import { authNotice } from "../lib/auth/authNotice";
import type { Problem } from "../lib/config/types";
import type { ChatState } from "../lib/state/conversation";

/** Shown instead of the chat when the config or a required property is missing (needs-input) or wrong (invalid). */
export function StatePanel(props: { kind: "needs-input" | "invalid"; problems: Problem[] }) {
  return (
    <div class="gai-state-panel" data-testid="gai-state-panel" role="alert">
      <div class="gai-state-title">
        {props.kind === "needs-input" ? "This chat needs more configuration" : "This chat's configuration is invalid"}
      </div>
      <ul class="gai-state-problems">
        {props.problems.map((p) => (
          <li key={p.path + ":" + p.message}>
            <code>{p.path === "" ? "config" : p.path}</code>: {p.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Re-login / not-authorized / unavailable state: no retry loop, only an explicit page reload when one can help. */
export function AuthBanner(props: { state: Exclude<ChatState["authState"], "ok">; reason?: AuthReason }) {
  const notice = authNotice(props.state, props.reason);
  return (
    <div class="gai-auth-banner" data-testid="gai-auth-banner" role="alert">
      <span class="gai-auth-text">{notice.text}</span>
      {notice.reload && (
        <button type="button" class="gai-button" data-testid="gai-auth-reload" onClick={() => location.reload()}>
          Reload
        </button>
      )}
    </div>
  );
}
