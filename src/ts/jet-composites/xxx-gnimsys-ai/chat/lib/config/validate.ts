import type { ChatConfig, Problem, ValidateResult } from "./types";
export type { ChatConfig, Problem, ValidateResult } from "./types";

const DEFAULT_ACCEPT = ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "md", "html", "json", "xml", "zip", "image/*"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const join = (p: string, k: string) => (p ? `${p}.${k}` : k);

export function parseConfigProp(prop: object | string | undefined): unknown {
  if (prop === undefined || prop === null) return {};
  if (typeof prop === "string") {
    try {
      return JSON.parse(prop);
    } catch (e) {
      return { __parseError: (e as Error).message };
    }
  }
  return prop;
}

export function validateConfig(input: unknown): ValidateResult {
  const missing: Problem[] = [];
  const invalid: Problem[] = [];
  const bad = (path: string, message: string) => invalid.push({ path, message });
  const need = (path: string) => missing.push({ path, message: "required" });

  if (!isObj(input)) {
    return { ok: false, kind: "invalid", problems: [{ path: "", message: "config must be a JSON object" }] };
  }
  if (typeof input.__parseError === "string") {
    return { ok: false, kind: "invalid", problems: [{ path: "", message: `config is not valid JSON: ${input.__parseError}` }] };
  }

  // Returns the section object (undefined if absent or wrong type) and flags unknown keys.
  const section = (name: string, allowed: string[]): Obj | undefined => {
    const v = input[name];
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      bad(name, "must be an object");
      return undefined;
    }
    for (const k of Object.keys(v)) if (!allowed.includes(k)) bad(join(name, k), "unknown key");
    return v;
  };
  const str = (o: Obj | undefined, k: string, path: string, required: boolean): string | undefined => {
    const v = o?.[k];
    if (v === undefined) {
      if (required) need(path);
      return undefined;
    }
    if (typeof v !== "string") { bad(path, "must be a string"); return undefined; }
    if (required && v === "") { need(path); return undefined; }
    return v;
  };
  const bool = (o: Obj | undefined, k: string, path: string, dflt: boolean): boolean => {
    const v = o?.[k];
    if (v === undefined) return dflt;
    if (typeof v !== "boolean") { bad(path, "must be a boolean"); return dflt; }
    return v;
  };
  const posNum = (o: Obj | undefined, k: string, path: string, dflt: number): number => {
    const v = o?.[k];
    if (v === undefined) return dflt;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) { bad(path, "must be a positive number"); return dflt; }
    return v;
  };
  const strList = (o: Obj | undefined, k: string, path: string, dflt: string[]): string[] => {
    const v = o?.[k];
    if (v === undefined) return dflt;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) { bad(path, "must be an array of strings"); return dflt; }
    return v as string[];
  };

  for (const k of Object.keys(input)) {
    if (!["agent", "auth", "protocol", "ui", "files", "datasources", "widgets", "submit", "history"].includes(k)) bad(k, "unknown key");
  }

  // agent
  // The pod is not configured here: it lives in the scopes of the page's service connections (the endpoint map).
  const agent = section("agent", ["workflowCode", "triggerType", "additionalContext", "responseLanguage"]);
  const workflowCode = str(agent, "workflowCode", "agent.workflowCode", true);
  let triggerType: "chat" | undefined;
  if (agent?.triggerType !== undefined) {
    if (agent.triggerType !== "chat") bad("agent.triggerType", 'must be "chat"');
    else triggerType = "chat";
  }
  let additionalContext: Record<string, unknown> | undefined;
  if (agent?.additionalContext !== undefined) {
    if (!isObj(agent.additionalContext)) bad("agent.additionalContext", "must be an object");
    else additionalContext = agent.additionalContext;
  }
  const responseLanguage = str(agent, "responseLanguage", "agent.responseLanguage", false);

  // auth
  const auth = section("auth", ["kind"]);
  if (auth?.kind === undefined) need("auth.kind");
  else if (auth.kind !== "fusionShell") bad("auth.kind", 'must be "fusionShell"');

  // files (before protocol: hcmRestBase depends on files.enabled)
  const files = section("files", ["enabled", "maxFiles", "maxSizeMB", "accept"]);
  const filesEnabled = bool(files, "enabled", "files.enabled", false);
  const maxFiles = posNum(files, "maxFiles", "files.maxFiles", 5);
  const maxSizeMB = posNum(files, "maxSizeMB", "files.maxSizeMB", 50);
  const accept = strList(files, "accept", "files.accept", DEFAULT_ACCEPT.slice());

  // protocol
  const protocol = section("protocol", ["checkVersion", "hcmRestBase"]);
  const checkVersion = str(protocol, "checkVersion", "protocol.checkVersion", true);
  // Attachments go through the FA endpoint: the base must be an /hcmRestApi/ pod path (refused at config time, not at upload).
  const hcmRestBase = str(protocol, "hcmRestBase", "protocol.hcmRestBase", filesEnabled);
  if (hcmRestBase !== undefined && !hcmRestBase.startsWith("/hcmRestApi/")) bad("protocol.hcmRestBase", 'must start with "/hcmRestApi/"');

  // ui
  const ui = section("ui", ["title", "greeting", "placeholder", "starterQuestions", "conversations", "viewer", "trace"]);
  const title = str(ui, "title", "ui.title", false);
  const greeting = str(ui, "greeting", "ui.greeting", false);
  const placeholder = str(ui, "placeholder", "ui.placeholder", false);
  let starterQuestions: "fromWorkflow" | string[] = "fromWorkflow";
  const sq = ui?.starterQuestions;
  if (sq !== undefined) {
    if (sq === "fromWorkflow") starterQuestions = sq;
    else if (Array.isArray(sq) && sq.every((x) => typeof x === "string")) starterQuestions = sq as string[];
    else bad("ui.starterQuestions", 'must be "fromWorkflow" or an array of strings');
  }
  const conversations = bool(ui, "conversations", "ui.conversations", true);
  const viewer = bool(ui, "viewer", "ui.viewer", false);

  // ui.trace: absent = trace off for everyone; present = roles required
  let trace: { roles: string[] } | undefined;
  if (ui?.trace !== undefined) {
    if (!isObj(ui.trace)) bad("ui.trace", "must be an object");
    else {
      for (const k of Object.keys(ui.trace)) if (k !== "roles") bad(join("ui.trace", k), "unknown key");
      const r = ui.trace.roles;
      if (r === undefined) need("ui.trace.roles");
      else if (!Array.isArray(r) || r.length === 0 || r.some((x) => typeof x !== "string" || x === "")) bad("ui.trace.roles", "must be a non-empty array of non-empty strings");
      else trace = { roles: r as string[] };
    }
  }

  // datasources
  const ds = section("datasources", ["allowInline", "allowPrefixes"]);
  const allowInline = bool(ds, "allowInline", "datasources.allowInline", false);
  const allowPrefixes = strList(ds, "allowPrefixes", "datasources.allowPrefixes", []);

  // widgets (contents validated in v1.1)
  let widgets: Record<string, unknown> = {};
  if (input.widgets !== undefined) {
    if (!isObj(input.widgets)) bad("widgets", "must be an object");
    else widgets = input.widgets;
  }

  // submit / history
  const submit = section("submit", ["envelope"]);
  if (submit?.envelope !== undefined && submit.envelope !== "gnimsysSubmit") bad("submit.envelope", 'must be "gnimsysSubmit"');
  const history = section("history", ["kind"]);
  if (history?.kind !== undefined && history.kind !== "oracle") bad("history.kind", 'must be "oracle"');

  if (invalid.length) return { ok: false, kind: "invalid", problems: [...invalid, ...missing] };
  if (missing.length) return { ok: false, kind: "needs-input", problems: missing };

  const cfg: ChatConfig = {
    agent: {
      workflowCode: workflowCode!,
      ...(triggerType && { triggerType }),
      ...(additionalContext && { additionalContext }),
      ...(responseLanguage !== undefined && { responseLanguage }),
    },
    auth: { kind: "fusionShell" },
    protocol: { checkVersion: checkVersion!, ...(hcmRestBase !== undefined && { hcmRestBase }) },
    ui: {
      ...(title !== undefined && { title }),
      ...(greeting !== undefined && { greeting }),
      ...(placeholder !== undefined && { placeholder }),
      starterQuestions,
      conversations,
      viewer,
      ...(trace !== undefined && { trace }),
    },
    files: { enabled: filesEnabled, maxFiles, maxSizeMB, accept },
    datasources: { allowInline, allowPrefixes },
    widgets,
    submit: { envelope: "gnimsysSubmit" },
    history: { kind: "oracle" },
  };
  return { ok: true, config: cfg };
}
