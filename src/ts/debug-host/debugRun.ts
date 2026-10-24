// What the debugger page hands to <xxx-gnimsys-ai-chat> (spec §17, §17.1; bridge design §4.1). Pure: the agent chat opens
// the page bound to one workflow run through the URL
//   /ai-chat-debug/?pod=/api/pod/c/<conversationId>/&workflow=<code>&version=DRAFT|PUBLISHED
// and this module reads the binding, asks the conversation's proxy for its pod user (`GET <pod>_info`) and builds the
// chat's props. The page's view model (hostController.ts) only shows the outcome. There is no picker and no input: a
// missing or invalid parameter is an explicit "open the debugger from the chat" outcome, and nothing is requested.
import { isConversationBase, POD_PROXY_ENDPOINTS, PodProxyRestHelper, readPodInfo } from "./podProxyRestHelper";
import type { PodInfo } from "./podProxyRestHelper";

/** The AI Studio protocol version this debugger build is tested with (the vendored aistudio CLI pins the same value). */
export const CHECK_VERSION = "2607100";
/** The trace gate: the page grants its user this role and the config asks for it, so the node trace is always visible. */
export const TRACE_ROLE = "AI_CHAT_DEBUGGER";

export type RunVersion = "PUBLISHED" | "DRAFT";
const VERSIONS: readonly RunVersion[] = ["DRAFT", "PUBLISHED"];

/** The page's URL parameters: all three required, nothing else accepted. */
export const URL_PARAMS = ["pod", "workflow", "version"] as const;

/** One workflow run as the agent chat bound it. */
export interface UrlBinding {
  /** The conversation-scoped proxy base `/api/pod/c/<conversationId>/`. */
  pod: string;
  workflowCode: string;
  version: RunVersion;
}

export type UrlBindingResult = { ok: true; binding: UrlBinding } | { ok: false; problems: string[] };

const shown = (v: string): string => JSON.stringify(v.length > 120 ? `${v.slice(0, 120)}…` : v);

/** Reads the binding from the page's query string (`location.search`); every problem is named, nothing is defaulted. */
export function bindingFromUrl(search: string): UrlBindingResult {
  const params = new URLSearchParams(search);
  const problems: string[] = [];
  const unknown = [...new Set([...params.keys()].filter((k) => !(URL_PARAMS as readonly string[]).includes(k)))];
  const one = (name: (typeof URL_PARAMS)[number]): string | undefined => {
    const all = params.getAll(name);
    if (all.length === 0) { problems.push(`${name}: missing`); return undefined; }
    if (all.length > 1) { problems.push(`${name}: given ${all.length} times`); return undefined; }
    return all[0];
  };
  const pod = one("pod");
  if (pod !== undefined && !isConversationBase(pod)) {
    problems.push(`pod: not the chat conversation's proxy base /api/pod/c/<conversation>/ (got ${shown(pod)})`);
  }
  const workflow = one("workflow");
  if (workflow !== undefined && workflow.trim() === "") problems.push("workflow: empty");
  const version = one("version");
  if (version !== undefined && !(VERSIONS as readonly string[]).includes(version)) {
    problems.push(`version: must be DRAFT or PUBLISHED (got ${shown(version)})`);
  }
  if (unknown.length > 0) problems.push(`unknown parameter${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, binding: { pod: pod as string, workflowCode: (workflow as string).trim(), version: version as RunVersion } };
}

/** The chat's config for the bound run: debug features on, attachments off (no reliable PersonId read, see the page notice). */
export function runConfig(binding: { workflowCode: string; version: RunVersion }): Record<string, unknown> {
  return {
    mode: "chat",
    agent: { workflowCode: binding.workflowCode, version: binding.version },
    // The component still requires auth.kind until the endpoint slice removes it; every call here goes through the
    // proxy rest helper, never through fusionShell.
    auth: { kind: "fusionShell" },
    protocol: { checkVersion: CHECK_VERSION },
    ui: { modeSwitch: true, debug: { rawFrames: true }, trace: { roles: [TRACE_ROLE] } },
    files: { enabled: false },
  };
}

/**
 * The chat's `user`: the pod user the conversation's proxy reports (never the Keycloak name). Without one, `userName`
 * stays unset and the chat shows its needs-input panel for it.
 */
export function runUser(podUser: string | undefined): { userName?: string; roles: string[] } {
  return { ...(podUser !== undefined && { userName: podUser }), roles: [TRACE_ROLE] };
}

/** The props of the bound run's <xxx-gnimsys-ai-chat>. */
export interface ChatRun {
  config: Record<string, unknown>;
  user: { userName?: string; roles: string[] };
  restHelper: PodProxyRestHelper;
  endpoint: Record<string, string>;
}

/**
 * What the page shows:
 * - open-from-chat: the URL does not bind a run (the header button opens the bare page); nothing was requested;
 * - auth-required: the conversation has no pod sign-in yet (`_info` answered 401 auth-required);
 * - unavailable: `_info` failed otherwise (the message says how);
 * - run: the chat, bound to the URL's workflow and version over the conversation's proxy base.
 */
export type RunOutcome =
  | { kind: "open-from-chat"; problems: string[] }
  | { kind: "auth-required"; binding: UrlBinding }
  | { kind: "unavailable"; binding: UrlBinding; message: string }
  | { kind: "run"; binding: UrlBinding; instance: string; podUser?: string; chat: ChatRun };

export async function startRun(options: { search: string; origin: string; fetchImpl?: (request: Request) => Promise<Response> }): Promise<RunOutcome> {
  const parsed = bindingFromUrl(options.search);
  if (!parsed.ok) return { kind: "open-from-chat", problems: parsed.problems };
  const { binding } = parsed;
  const { origin, fetchImpl } = options;
  let info: PodInfo;
  try {
    info = await readPodInfo({ pod: binding.pod, origin, ...(fetchImpl !== undefined && { fetchImpl }) });
  } catch (e) {
    return { kind: "unavailable", binding, message: e instanceof Error ? e.message : String(e) };
  }
  if (info.state === "auth-required") return { kind: "auth-required", binding };
  const chat: ChatRun = {
    config: runConfig(binding),
    user: runUser(info.podUser),
    restHelper: new PodProxyRestHelper({ pod: binding.pod, label: info.instance, origin, ...(fetchImpl !== undefined && { fetchImpl }) }),
    endpoint: { ...POD_PROXY_ENDPOINTS },
  };
  return { kind: "run", binding, instance: info.instance, ...(info.podUser !== undefined && { podUser: info.podUser }), chat };
}
