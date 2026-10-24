// The agents a user may pick (design §5.1): ALL the workflows the user can read on the pod (BOSS `workflows`, endpoint
// BOSS), as the vendored Oracle aistudio CLI lists them (fusion-ai-agent/mcp/vendor/aistudio.js, read-only reference):
// - list query = the CLI's workflow list `vz` (lines 4283-4284): `$filter=(status = '<V>' and sourceWorkflowCode = null
//   [and (name ~LIKE '%q%' or workflowCode ~LIKE '%q%')])`, `$limit` (CLI default 25) + `$offset`, `hasMore`; a row without
//   a workflowCode is skipped and a blank name shows the code, as there. `sourceWorkflowCode = null` drops customization
//   rows; the status filter is the selected version instead of the CLI's fixed PUBLISHED;
// - one agent's versions = the CLI's workflow read `oh` (line 8485): `workflowCode='<code>' and (status='DRAFT' or
//   status='PUBLISHED')`; for an agent picked from the list (a restored choice), with the list's exclusions too, so a
//   version counts only where the list shows it; for an agent the page bound, as is (bound parts are never checked);
// - templates (`isTemplate`) and hidden rows (`hiddenFlag`) are dropped here: the CLI reads those fields (line 8443) but
//   its list query does not filter them; dropping them is the design's call (§5.1 [my call]).
// Live pod: whether an end-user token holding the chat roles may read these rows (both statuses) is [open] (design §8).
import { ARTIFACT_VERSIONS } from "../config/types";
import type { ArtifactVersion } from "../config/types";
import type { EndpointFetch } from "../endpoints/EndpointFetch";
import { historyCall, historyJson } from "../history/OracleHistoryStore";

const WORKFLOWS = "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows";
/** The CLI's list page size (aistudio.js `vz`: `$limit` default 25). */
export const AGENT_PAGE_SIZE = 25;
/** Rows read for one page's version markers: a page has at most AGENT_PAGE_SIZE codes, a code a few rows per status. */
const MARKER_LIMIT = 100;
const LIST_FIELDS = "workflowCode,name,status,sourceWorkflowCode,isTemplate,hiddenFlag";
const VERSION_FIELDS = "workflowCode,status,sourceWorkflowCode,isTemplate,hiddenFlag";

/** One agent of the list: its code, its name and the versions it has (the row's Published/Draft markers). */
export interface AgentRow { workflowCode: string; name: string; versions: ArtifactVersion[] }

/** One page: its rows (deduplicated by code within the page) and where the next page starts (pod rows, not shown rows). */
export interface AgentPage { rows: AgentRow[]; hasMore: boolean; next: number }

/** What the run selection reads (the controller and the panel take this interface, so tests can fake it). */
export interface AgentDirectory {
  page(version: ArtifactVersion, query: string, offset: number, limit?: number): Promise<AgentPage>;
  /**
   * The versions one agent has (in ARTIFACT_VERSIONS order); empty when it has none. `listedOnly`: count only rows the
   * agent list shows (an agent the user picked from it); off for an agent the page bound, which is never checked against
   * the list (a template, hidden or customization workflow bound by the page still has its versions).
   */
  versionsOf(workflowCode: string, opts: { listedOnly: boolean }): Promise<ArtifactVersion[]>;
}

const quote = (s: string): string => s.replace(/'/g, "''");
const codeOf = (row: Record<string, unknown>): string => String(row.workflowCode ?? "").trim();
/** A row the list shows: neither a template nor hidden (customization rows never come back: the query excludes them). */
const listed = (row: Record<string, unknown>): boolean => row.isTemplate !== true && row.hiddenFlag !== true;
const items = (json: Record<string, unknown>): Record<string, unknown>[] =>
  (Array.isArray(json.items) ? json.items : []).filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);

export class OracleAgentDirectory implements AgentDirectory {
  private readonly endpoints: EndpointFetch;

  constructor(deps: { endpoints: EndpointFetch }) {
    this.endpoints = deps.endpoints;
  }

  private async get(filter: string, fields: string, extra = ""): Promise<Record<string, unknown>> {
    const url = `${WORKFLOWS}?$filter=${encodeURIComponent(filter)}&$fields=${encodeURIComponent(fields)}${extra}`;
    return historyJson(await historyCall(this.endpoints, "BOSS", url));
  }

  async page(version: ArtifactVersion, query: string, offset: number, limit = AGENT_PAGE_SIZE): Promise<AgentPage> {
    const q = quote(query.trim());
    const search = q === "" ? "" : ` and (name ~LIKE '%${q}%' or workflowCode ~LIKE '%${q}%')`;
    const json = await this.get(`(status = '${version}' and sourceWorkflowCode = null${search})`, LIST_FIELDS, `&$limit=${limit}&$offset=${offset}`);
    const raw = items(json);
    const seen = new Set<string>();
    const rows: Array<{ workflowCode: string; name: string }> = [];
    for (const r of raw) {
      const workflowCode = codeOf(r);
      if (workflowCode === "" || !listed(r) || seen.has(workflowCode)) continue;
      seen.add(workflowCode);
      rows.push({ workflowCode, name: String(r.name ?? "").trim() || workflowCode });
    }
    const other = await this.otherVersion(version, rows.map((r) => r.workflowCode));
    return {
      rows: rows.map((r) => ({ ...r, versions: ARTIFACT_VERSIONS.filter((v) => v === version || other.has(r.workflowCode)) })),
      hasMore: json.hasMore === true,
      next: offset + raw.length,
    };
  }

  /** The codes (of `codes`) that also have the other version: the rows' markers. One call per page. */
  private async otherVersion(version: ArtifactVersion, codes: string[]): Promise<Set<string>> {
    if (codes.length === 0) return new Set();
    const other: ArtifactVersion = version === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    const anyOf = codes.map((c) => `workflowCode = '${quote(c)}'`).join(" or ");
    const json = await this.get(`(status = '${other}' and sourceWorkflowCode = null and (${anyOf}))`, VERSION_FIELDS, `&$limit=${MARKER_LIMIT}`);
    return new Set(items(json).filter(listed).map(codeOf));
  }

  async versionsOf(workflowCode: string, opts: { listedOnly: boolean }): Promise<ArtifactVersion[]> {
    const code = `workflowCode = '${quote(workflowCode)}'`;
    const statuses = "(status = 'DRAFT' or status = 'PUBLISHED')";
    // Listed only: the list's own exclusions (customization rows in the query, templates / hidden rows here). Otherwise the
    // CLI's workflow read as is (line 8485).
    const json = await this.get(opts.listedOnly ? `(${code} and sourceWorkflowCode = null and ${statuses})` : `(${code} and ${statuses})`, VERSION_FIELDS);
    const found = new Set(items(json).filter((r) => (!opts.listedOnly || listed(r)) && codeOf(r) === workflowCode).map((r) => r.status));
    return ARTIFACT_VERSIONS.filter((v) => found.has(v));
  }
}
