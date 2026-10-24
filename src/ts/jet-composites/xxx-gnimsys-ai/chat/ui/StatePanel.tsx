import "oj-c/button";
import type { AuthReason } from "../lib/auth/AuthFetch";
import { authNotice } from "../lib/auth/authNotice";
import type { Problem } from "../lib/config/types";
import type { ChatState } from "../lib/state/conversation";
import { Banner } from "./Banner";

/** Shown instead of the chat when the config or a required property is missing (needs-input) or wrong (invalid). */
export function StatePanel(props: { kind: "needs-input" | "invalid"; problems: Problem[] }) {
  return (
    <Banner testId="gai-state-panel" severity={props.kind === "needs-input" ? "warning" : "error"}
      summary={props.kind === "needs-input" ? "This chat needs more configuration" : "This chat's configuration is invalid"}>
      <ul class="oj-sm-margin-0">
        {props.problems.map((p) => (
          <li key={p.path + ":" + p.message}>
            <code>{p.path === "" ? "config" : p.path}</code>: {p.message}
          </li>
        ))}
      </ul>
    </Banner>
  );
}

/**
 * Re-login / not-authorized / unavailable state: no retry loop, only an explicit page reload when one can help.
 * `detail`: the endpoint's own text from its 401 answer (what signing in means for that endpoint), shown under the notice.
 */
export function AuthBanner(props: { state: Exclude<ChatState["authState"], "ok">; reason?: AuthReason; status?: number; detail?: string; class?: string }) {
  const notice = authNotice(props.state, props.reason, props.status);
  return (
    <Banner testId="gai-auth-banner" severity="error" summary={notice.text} {...(props.class !== undefined && { class: props.class })}>
      {notice.reload || props.detail !== undefined ? (
        <>
          {props.detail !== undefined && <div data-testid="gai-auth-detail">{props.detail}</div>}
          {notice.reload && <oj-c-button data-testid="gai-auth-reload" label="Reload" chroming="outlined" onojAction={() => location.reload()} />}
        </>
      ) : undefined}
    </Banner>
  );
}
