export interface ChatConfig {
  agent: { workflowCode: string; pod: string; triggerType?: "chat"; additionalContext?: Record<string, unknown>; responseLanguage?: string | "auto" };
  auth: { kind: "fusionShell" };
  // hcmRestBase is required only when files.enabled (validator enforces); no data default exists, so it is optional here.
  protocol: { checkVersion: string; hcmRestBase?: string };
  ui: { title?: string; placeholder?: string; starterQuestions: "fromWorkflow" | string[]; conversations: boolean; viewer: boolean };
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
