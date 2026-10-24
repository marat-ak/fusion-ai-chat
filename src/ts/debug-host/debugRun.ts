// What the debugger page hands to <xxx-gnimsys-ai-chat> for one Run (spec §17, §17.1). Pure: the page's view model
// (hostController.ts) owns the inputs and the instance list; this decides what is missing and builds the chat's props.
import type { PodInstance } from "./podProxyRestHelper";

/** The AI Studio protocol version this debugger build is tested with (the vendored aistudio CLI pins the same value). */
export const CHECK_VERSION = "2607100";
/** The trace gate: the page grants its user this role and the config asks for it, so the node trace is always visible. */
export const TRACE_ROLE = "AI_CHAT_DEBUGGER";

export type RunVersion = "PUBLISHED" | "DRAFT";

/** The page's inputs; nothing is preselected or defaulted. */
export interface RunInputs {
  instance: PodInstance | null;
  workflowCode: string;
  appCode: string;
  version: RunVersion | null;
}

/** Why Run cannot start yet: the inputs still missing, or the instance has no pod sign-in. */
export function runProblems(inputs: RunInputs): string[] {
  const problems: string[] = [];
  if (inputs.instance === null) problems.push("Instance: pick one");
  else if (!inputs.instance.connected) problems.push(`Instance: sign in to ${inputs.instance.label} through the agent chat first, then Refresh`);
  if (inputs.workflowCode.trim() === "" && inputs.appCode.trim() === "") problems.push("Workflow code or app code: enter one");
  if (inputs.version === null) problems.push("Version: pick PUBLISHED or DRAFT");
  return problems;
}

/** The chat's config for a Run: debug features on, attachments off (no reliable PersonId read, see the page notice). */
export function runConfig(inputs: { workflowCode: string; appCode: string; version: RunVersion }): Record<string, unknown> {
  const workflowCode = inputs.workflowCode.trim();
  const appCode = inputs.appCode.trim();
  return {
    // A workflow runs in the workflow mode `chat`; only an app code means mode `app` (not built yet: the chat says so).
    mode: workflowCode !== "" ? "chat" : "app",
    ...(workflowCode !== "" && { agent: { workflowCode, version: inputs.version } }),
    ...(appCode !== "" && { app: { applicationCode: appCode, applicationType: inputs.version } }),
    // The component still requires auth.kind until the endpoint slice removes it; every call here goes through the
    // proxy rest helper, never through fusionShell.
    auth: { kind: "fusionShell" },
    protocol: { checkVersion: CHECK_VERSION },
    ui: { modeSwitch: true, debug: { rawFrames: true }, trace: { roles: [TRACE_ROLE] } },
    files: { enabled: false },
  };
}

/**
 * The chat's `user`: the pod user the proxy reports for the instance (never the Keycloak name). Without one, `userName`
 * stays unset and the chat shows its needs-input panel for it.
 */
export function runUser(instance: PodInstance): { userName?: string; roles: string[] } {
  return { ...(instance.podUser !== undefined && { userName: instance.podUser }), roles: [TRACE_ROLE] };
}
