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
/**
 * The attachments' HCM REST base: the form Oracle's own chat client falls back to (and VB pages use), under the proxy's FA
 * prefix `/hcmRestApi/rest/`.
 */
export const HCM_REST_BASE = "/hcmRestApi/rest/latest/en/11.13.18.05:9";
/**
 * The debugger's per-file limit (MB): Oracle's own (50), within the pod proxy's request bound (64 MiB, setup
 * `POD_PROXY.maxRequestBytes`), multipart overhead included.
 */
export const MAX_FILE_MB = 50;

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

/**
 * The chat's config for the bound run: the mode switch on, attachments on (their conversation row carries
 * DEBUG_PERSON_ID, below). The node trace and the raw frames are the Run Inspector's (the page passes its run observer),
 * not the chat's.
 * A PUBLISHED run goes through Studio's `/debug` too (`agent.publishedVia: "debug"`, `status: "PUBLISHED"`), so agent
 * builders get the node data for it as for a draft; the key is only set for PUBLISHED (a DRAFT run refuses it).
 */
export function runConfig(binding: { workflowCode: string; version: RunVersion }): Record<string, unknown> {
  return {
    mode: "chat",
    agent: { workflowCode: binding.workflowCode, version: binding.version, ...(binding.version === "PUBLISHED" && { publishedVia: "debug" }) },
    // The component still requires auth.kind until the endpoint slice removes it; every call here goes through the
    // proxy rest helper, never through fusionShell.
    auth: { kind: "fusionShell" },
    protocol: { checkVersion: CHECK_VERSION, hcmRestBase: HCM_REST_BASE },
    ui: { modeSwitch: true },
    files: { enabled: true, maxSizeMB: MAX_FILE_MB },
  };
}

/**
 * The chat's `user`: the pod user the conversation's proxy reports (never the Keycloak name). Without one, `userName`
 * stays unset and the chat shows its needs-input panel for it. No roles: the page binds the run (nothing to choose).
 */
export function runUser(podUser: string | undefined): { userName?: string; roles: string[] } {
  return { ...(podUser !== undefined && { userName: podUser }), roles: [] };
}

/**
 * The PersonId of the attachments' conversation row (the chat's `person-id`): "-1", as Oracle's own chat client sends
 * without a user id (`userId ?? "-1"`). The pod refuses the row without PersonId (HTTP 400, o:errorCode 27014). A trial
 * (bridge design §13.2): whether a file uploaded under a "-1" row reaches the run (`$system.$ucmIdList` in the step's
 * Context) is unverified.
 */
export const DEBUG_PERSON_ID = "-1";

/** The props of the bound run's <xxx-gnimsys-ai-chat>. */
export interface ChatRun {
  config: Record<string, unknown>;
  user: { userName?: string; roles: string[] };
  personId: string;
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
    personId: DEBUG_PERSON_ID,
    restHelper: new PodProxyRestHelper({ pod: binding.pod, label: info.instance, origin, ...(fetchImpl !== undefined && { fetchImpl }) }),
    endpoint: { ...POD_PROXY_ENDPOINTS },
  };
  return { kind: "run", binding, instance: info.instance, ...(info.podUser !== undefined && { podUser: info.podUser }), chat };
}
