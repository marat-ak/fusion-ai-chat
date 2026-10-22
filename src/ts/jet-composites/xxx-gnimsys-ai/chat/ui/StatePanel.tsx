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

/** Re-login / not-authorized state: no retry loop, only an explicit page reload. */
export function AuthBanner(props: { state: Exclude<ChatState["authState"], "ok"> }) {
  return (
    <div class="gai-auth-banner" data-testid="gai-auth-banner" role="alert">
      <span class="gai-auth-text">
        {props.state === "relogin" ? "Session expired. Reload the page to sign in again." : "Not authorized to use this agent."}
      </span>
      <button type="button" class="gai-button" data-testid="gai-auth-reload" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
