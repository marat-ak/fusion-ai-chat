/** The component's modes (spec §2). */
export type ChatMode = "chat" | "app" | "gnimsys";
export const CHAT_MODES: readonly ChatMode[] = ["chat", "app", "gnimsys"];
/** The modes this build implements: a config naming another mode is invalid until that mode is built. */
export const IMPLEMENTED_MODES: readonly ChatMode[] = ["chat"];
/** Which copy of a workflow (or app) runs: the published one (`/chat`) or the draft (Studio's `/debug` test path). */
export type ArtifactVersion = "PUBLISHED" | "DRAFT";

export interface ChatConfig {
  /** Only an implemented mode passes validation (IMPLEMENTED_MODES). */
  mode: "chat";
  agent: { workflowCode: string; version: ArtifactVersion; triggerType?: "chat"; additionalContext?: Record<string, unknown>; responseLanguage?: string | "auto" };
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
  };
  files: { enabled: boolean; maxFiles: number; maxSizeMB: number; accept: string[] };
  datasources: { allowInline: boolean; allowPrefixes: string[] };
  widgets: Record<string, unknown>; // consumed in v1.1
  submit: { envelope: "gnimsysSubmit" };
  history: { kind: "oracle" };
}
export type Problem = { path: string; message: string };
export type ValidateResult =
  | { ok: true; config: ChatConfig }
  | { ok: false; kind: "needs-input" | "invalid"; problems: Problem[] };
