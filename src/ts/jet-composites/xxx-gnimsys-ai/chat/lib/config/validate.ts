import { ARTIFACT_VERSIONS as VERSIONS, CHAT_MODES, IMPLEMENTED_MODES, PUBLISHED_VIA } from "./types";
import type { ArtifactVersion, ChatConfig, ChatMode, Problem, PublishedVia, RunSettings, ValidateResult, WidgetOverlay } from "./types";
import { ID_RE } from "../widgets/block";
import { validateDataSource, validateSourceFields } from "../widgets/datasource";
import type { DataSourceOptions } from "../widgets/datasource";
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
    if (!["mode", "agent", "app", "auth", "protocol", "ui", "files", "datasources", "widgets", "submit", "history"].includes(k)) bad(k, "unknown key");
  }

  // mode: required, no default; a mode that is not built yet is refused rather than shown half-working.
  let mode: ChatMode | undefined;
  if (input.mode === undefined) need("mode");
  else if (typeof input.mode !== "string" || !(CHAT_MODES as readonly string[]).includes(input.mode)) bad("mode", `must be one of ${CHAT_MODES.map((m) => `"${m}"`).join(", ")}`);
  else if (!(IMPLEMENTED_MODES as readonly string[]).includes(input.mode)) bad("mode", `"${input.mode}" is not built yet`);
  else mode = input.mode as ChatMode;
  const version = (o: Obj | undefined, k: string, path: string, required: boolean): ArtifactVersion | undefined => {
    const v = o?.[k];
    if (v === undefined) {
      if (required) need(path);
      return undefined;
    }
    if (!(VERSIONS as readonly unknown[]).includes(v)) { bad(path, 'must be "PUBLISHED" or "DRAFT"'); return undefined; }
    return v as ArtifactVersion;
  };

  // agent
  // The pod is not configured here: it lives in the scopes of the page's service connections (the endpoint map).
  const agent = section("agent", ["workflowCode", "version", "publishedVia", "triggerType", "additionalContext", "responseLanguage"]);
  // The workflow modes (chat, gnimsys) say what the page binds in `agent` (possibly nothing: `{}`); mode `app` talks to an
  // app instead.
  if (input.agent === undefined && input.mode !== "app") need("agent");
  // workflowCode / version: absent or "" = not bound by the page (a VB page parameter missing from the URL arrives as ""):
  // the component resolves the run from ui.runSettings and the user's roles (design §5.1). Nothing is defaulted here, so an
  // absent version stays distinguishable from a bound PUBLISHED.
  const workflowCode = agent?.workflowCode === "" ? undefined : str(agent, "workflowCode", "agent.workflowCode", false);
  const agentVersion = agent?.version === "" ? undefined : version(agent, "version", "agent.version", false);
  // publishedVia: absent = a PUBLISHED run uses /chat (the documented behaviour, not a data default). It only means
  // something for a run that can be PUBLISHED: a bound DRAFT refuses it rather than ignoring it.
  let publishedVia: PublishedVia | undefined;
  if (agent?.publishedVia !== undefined) {
    if (!(PUBLISHED_VIA as readonly unknown[]).includes(agent.publishedVia)) bad("agent.publishedVia", 'must be "chat" or "debug"');
    else if (agentVersion === "DRAFT") bad("agent.publishedVia", 'only for a run that can be PUBLISHED (agent.version is "DRAFT")');
    else publishedVia = agent.publishedVia as PublishedVia;
  }
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

  // app (mode `app`, spec §8): when present, the app and its version are required.
  const app = section("app", ["applicationCode", "applicationType", "panel", "appContext"]);
  const appRequired = app !== undefined || input.mode === "app";
  const applicationCode = str(app, "applicationCode", "app.applicationCode", appRequired);
  const applicationType = version(app, "applicationType", "app.applicationType", appRequired);
  const panel = str(app, "panel", "app.panel", false);
  const appContext = str(app, "appContext", "app.appContext", false);

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
  const ui = section("ui", ["title", "greeting", "placeholder", "starterQuestions", "conversations", "viewer", "trace", "modeSwitch", "runSettings"]);
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

  const modeSwitch = bool(ui, "modeSwitch", "ui.modeSwitch", false);

  // ui.runSettings: absent = nobody may choose; present = both role lists required (an empty list = nobody), no default
  // role names.
  let runSettings: RunSettings | undefined;
  if (ui?.runSettings !== undefined) {
    const rs = ui.runSettings;
    if (!isObj(rs)) bad("ui.runSettings", "must be an object");
    else {
      for (const k of Object.keys(rs)) if (k !== "allAgentsRoles" && k !== "draftRoles") bad(join("ui.runSettings", k), "unknown key");
      const roles = (k: "allAgentsRoles" | "draftRoles"): string[] | undefined => {
        const path = `ui.runSettings.${k}`;
        const v = rs[k];
        if (v === undefined) { need(path); return undefined; }
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x === "")) { bad(path, "must be an array of non-empty strings"); return undefined; }
        return v as string[];
      };
      const allAgentsRoles = roles("allAgentsRoles");
      const draftRoles = roles("draftRoles");
      if (allAgentsRoles !== undefined && draftRoles !== undefined) runSettings = { allAgentsRoles, draftRoles };
    }
  }

  // datasources
  const ds = section("datasources", ["allowInline", "allowPrefixes", "pageSize"]);
  const allowInline = bool(ds, "allowInline", "datasources.allowInline", false);
  const allowPrefixes = strList(ds, "allowPrefixes", "datasources.allowPrefixes", []);
  // pageSize: rows per page of a datasource select (the endpoint data provider's limit); 25 = the contract's default.
  const pageSize = posNum(ds, "pageSize", "datasources.pageSize", 25);
  if (ds?.pageSize !== undefined && !Number.isInteger(ds.pageSize)) bad("datasources.pageSize", "must be an integer");

  // widgets: the gnimsys-ui overlay widgets[widgetId].fields[fieldId] = { dataSource, valueField, labelField } (D7)
  const widgets: Record<string, WidgetOverlay> = {};
  if (input.widgets !== undefined) {
    if (!isObj(input.widgets)) bad("widgets", "must be an object");
    else {
      for (const [wid, w] of Object.entries(input.widgets)) {
        const wp = `widgets.${wid}`;
        if (!ID_RE.test(wid)) bad(wp, "widget id must match [A-Za-z0-9_-]{1,64}");
        if (!isObj(w)) { bad(wp, "must be an object"); continue; }
        for (const k of Object.keys(w)) if (k !== "fields") bad(join(wp, k), "unknown key");
        if (!isObj(w.fields)) { bad(`${wp}.fields`, "must be an object"); continue; }
        const fields: Record<string, DataSourceOptions> = {};
        for (const [fid, f] of Object.entries(w.fields)) {
          const fp = `${wp}.fields.${fid}`;
          if (!ID_RE.test(fid)) bad(fp, "field id must match [A-Za-z0-9_-]{1,64}");
          if (!isObj(f)) { bad(fp, "must be an object"); continue; }
          for (const k of Object.keys(f)) if (!["dataSource", "valueField", "labelField", "searchTemplate"].includes(k)) bad(join(fp, k), "unknown key");
          const ds = validateDataSource(f.dataSource, `${fp}.dataSource`, invalid);
          const names = validateSourceFields(f, fp, invalid);
          if (ds !== undefined && names !== undefined) fields[fid] = { dataSource: ds, ...names };
        }
        widgets[wid] = { fields };
      }
    }
  }

  // submit / history
  const submit = section("submit", ["envelope"]);
  if (submit?.envelope !== undefined && submit.envelope !== "gnimsysSubmit") bad("submit.envelope", 'must be "gnimsysSubmit"');
  const history = section("history", ["kind"]);
  if (history?.kind !== undefined && history.kind !== "oracle") bad("history.kind", 'must be "oracle"');

  if (invalid.length) return { ok: false, kind: "invalid", problems: [...invalid, ...missing] };
  if (missing.length) return { ok: false, kind: "needs-input", problems: missing };

  const cfg: ChatConfig = {
    mode: mode as "chat", // the only implemented mode
    agent: {
      ...(workflowCode !== undefined && { workflowCode }),
      ...(agentVersion !== undefined && { version: agentVersion }),
      ...(publishedVia !== undefined && { publishedVia }),
      ...(triggerType && { triggerType }),
      ...(additionalContext && { additionalContext }),
      ...(responseLanguage !== undefined && { responseLanguage }),
    },
    ...(app !== undefined && {
      app: {
        applicationCode: applicationCode!,
        applicationType: applicationType!,
        ...(panel !== undefined && { panel }),
        ...(appContext !== undefined && { appContext }),
      },
    }),
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
      modeSwitch,
      ...(runSettings !== undefined && { runSettings }),
    },
    files: { enabled: filesEnabled, maxFiles, maxSizeMB, accept },
    datasources: { allowInline, allowPrefixes, pageSize },
    widgets,
    submit: { envelope: "gnimsysSubmit" },
    history: { kind: "oracle" },
  };
  return { ok: true, config: cfg };
}
