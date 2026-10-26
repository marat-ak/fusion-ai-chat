// Loads the run's workflow definition (definition.ts) through the conversation's pod proxy, BOSS target: the same endpoint
// layer the chat uses (EndpointFetch over DashboardRestHelper over the page's PodProxyRestHelper), so the proxy's states
// read the same way. One row is expected for (workflowCode, status); none = "no <status> row", more = refused.
import DashboardRestHelper = require("xxx-gnimsys-data/rest/dashboard-rest-helper");
import { EndpointError, EndpointFetch, endpointBodyText, objectBody } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/endpoints/EndpointFetch";
import type { VbRestHelper } from "xxx-gnimsys-data/rest/index";
import { DefinitionError, definitionUrl, parseDefinition } from "./definition";
import type { WorkflowDefinition } from "./definition";

/** What the graph can be drawn from: the definition, or why there is none (shown as a notice; the Steps view stays). */
export type DefinitionResult = { ok: true; definition: WorkflowDefinition } | { ok: false; reason: string };

/** The BOSS `version` of the row now (a small read, done when a turn ends: the version the run most likely executed). */
export type VersionResult = { ok: true; version?: string } | { ok: false; reason: string };

export interface DefinitionSource {
  load(workflowCode: string, status: string): Promise<DefinitionResult>;
  version(workflowCode: string, status: string): Promise<VersionResult>;
}

const failure = (e: unknown): string => {
  if (e instanceof EndpointError) {
    const body = endpointBodyText(e.body);
    const detail = typeof e.body === "object" && e.body !== null && typeof (e.body as { detail?: unknown }).detail === "string"
      ? (e.body as { detail: string }).detail : body;
    return e.kind === "http" ? `HTTP ${e.status}${detail !== undefined ? `: ${detail.slice(0, 300)}` : ""}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
};

/** The BOSS reader over the page's rest helper and endpoint map (the debug host's proxy helper). */
export function bossDefinitionSource(restHelper: VbRestHelper, endpoints: Record<string, string>): DefinitionSource {
  const fetcher = new EndpointFetch({ helper: new DashboardRestHelper(restHelper, endpoints) });
  const rows = async (workflowCode: string, status: string, fields?: string): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; reason: string }> => {
    let res;
    try {
      res = await fetcher.request("BOSS", definitionUrl(workflowCode, status, fields));
    } catch (e) {
      return { ok: false, reason: `the workflow definition could not be read (${failure(e)})` };
    }
    const json = objectBody(res);
    const items = json !== null && Array.isArray(json.items) ? json.items : null;
    if (items === null) return { ok: false, reason: "the workflow definition answer has no items" };
    if (items.length === 0) return { ok: false, reason: `the pod has no ${status} row of ${workflowCode}` };
    if (items.length > 1) return { ok: false, reason: `the pod has ${items.length} ${status} rows of ${workflowCode}` };
    const row = items[0];
    if (typeof row !== "object" || row === null || Array.isArray(row)) return { ok: false, reason: "the workflow row is not an object" };
    return { ok: true, row: row as Record<string, unknown> };
  };
  return {
    async load(workflowCode, status) {
      const r = await rows(workflowCode, status);
      if (!r.ok) return r;
      try {
        return { ok: true, definition: parseDefinition(r.row) };
      } catch (e) {
        return { ok: false, reason: e instanceof DefinitionError ? e.message : String(e) };
      }
    },
    async version(workflowCode, status) {
      const r = await rows(workflowCode, status, "workflowCode,status,version");
      if (!r.ok) return r;
      const v = r.row.version;
      return { ok: true, ...(typeof v === "number" || (typeof v === "string" && v !== "") ? { version: String(v) } : {}) };
    },
  };
}
