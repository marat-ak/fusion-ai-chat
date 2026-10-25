/** The component's modes (spec §2). */
export type ChatMode = "chat" | "app" | "gnimsys";
export const CHAT_MODES: readonly ChatMode[] = ["chat", "app", "gnimsys"];
/** The modes this build implements: a config naming another mode is invalid until that mode is built. */
export const IMPLEMENTED_MODES: readonly ChatMode[] = ["chat"];
/** Which copy of a workflow (or app) runs: the published one (`/chat`) or the draft (Studio's `/debug` test path). */
export type ArtifactVersion = "PUBLISHED" | "DRAFT";
export const ARTIFACT_VERSIONS: readonly ArtifactVersion[] = ["PUBLISHED", "DRAFT"];
/**
 * The endpoint a PUBLISHED run uses: `chat` = the Studio chat client's `/chat`; `debug` = Studio's test path `/debug` with
 * `status: "PUBLISHED"` (an ADMIN invocation whose stream carries node data — debug hosts only, not end-user pages).
 */
export type PublishedVia = "chat" | "debug";
export const PUBLISHED_VIA: readonly PublishedVia[] = ["chat", "debug"];

/**
 * Who may choose what the page did not bind (design §5.1): a user holding one of `allAgentsRoles` picks the agent, one
 * holding one of `draftRoles` may run drafts. Both lists are required; an empty list = nobody.
 */
export interface RunSettings { allAgentsRoles: string[]; draftRoles: string[] }

/** The workflow and version a chat runs. */
export interface Run { workflowCode: string; version: ArtifactVersion }

export interface ChatConfig {
  /** Only an implemented mode passes validation (IMPLEMENTED_MODES). */
  mode: "chat";
  /**
   * `workflowCode` / `version` absent = not bound by the page: who may choose them is `ui.runSettings` (design §5.1); the
   * run is resolved in the component, never defaulted here. `publishedVia` absent = a PUBLISHED run uses `/chat` (the
   * documented behaviour); present only where a run can be PUBLISHED (refused with a bound DRAFT).
   */
  agent: {
    workflowCode?: string; version?: ArtifactVersion; publishedVia?: PublishedVia; triggerType?: "chat";
    additionalContext?: Record<string, unknown>; responseLanguage?: string | "auto";
  };
  /** The Agentic App of mode `app` (spec §8, not built): carried so a mode switch can offer it once it is built. */
  app?: { applicationCode: string; applicationType: ArtifactVersion; panel?: string; appContext?: string };
  auth: { kind: "fusionShell" };
  // hcmRestBase is required only when files.enabled (validator enforces); no data default exists, so it is optional here.
  protocol: { checkVersion: string; hcmRestBase?: string };
  ui: {
    title?: string; greeting?: string; placeholder?: string; starterQuestions: "fromWorkflow" | string[]; conversations: boolean; viewer: boolean;
    trace?: { roles: string[] };
    /** Debug hosts: the header's mode switch (spec §2). */
    modeSwitch: boolean;
    /** Debug hosts: `rawFrames` lists each reply's raw SSE frames under it. */
    debug: { rawFrames: boolean };
    /** Absent = nobody may choose an unbound agent or version. */
    runSettings?: RunSettings;
  };
  files: { enabled: boolean; maxFiles: number; maxSizeMB: number; accept: string[] };
  datasources: { allowInline: boolean; allowPrefixes: string[] };
  widgets: Record<string, unknown>; // consumed in v1.1
  submit: { envelope: "gnimsysSubmit" };
  history: { kind: "oracle" };
}
/** The config of a running chat: its run resolved (bound by the page or chosen by the user). */
export type RunConfig = Omit<ChatConfig, "agent"> & { agent: ChatConfig["agent"] & Run };

export function withRun(config: ChatConfig, run: Run): RunConfig {
  return { ...config, agent: { ...config.agent, workflowCode: run.workflowCode, version: run.version } };
}

export type Problem = { path: string; message: string };
export type ValidateResult =
  | { ok: true; config: ChatConfig }
  | { ok: false; kind: "needs-input" | "invalid"; problems: Problem[] };
