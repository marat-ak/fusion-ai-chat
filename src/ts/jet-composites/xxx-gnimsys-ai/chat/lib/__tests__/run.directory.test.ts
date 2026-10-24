// The agent list (design §5.1) over the real endpoint layer: the same rows the vendored Oracle aistudio CLI lists
// (fusion-ai-agent/mcp/vendor/aistudio.js: list `vz` lines 4283-4284, one workflow `oh` line 8485), plus the design's
// template/hidden exclusion; paged as a JET DataProvider.
import { AgentListDataProvider } from "../run/AgentListDataProvider";
import { OracleAgentDirectory } from "../run/OracleAgentDirectory";
import type { AgentDirectory } from "../run/OracleAgentDirectory";
import { HistoryError } from "../history/HistoryStore";
import { fakeEndpoints, vb } from "./helpers.endpoints";

const WORKFLOWS = "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows";
const enc = encodeURIComponent;
const LIST_FIELDS = enc("workflowCode,name,status,sourceWorkflowCode,isTemplate,hiddenFlag");
const VERSION_FIELDS = enc("workflowCode,status,sourceWorkflowCode,isTemplate,hiddenFlag");
const row = (workflowCode: string, more: object = {}) => ({ workflowCode, name: `Agent ${workflowCode}`, status: "PUBLISHED", sourceWorkflowCode: null, ...more });

test("list_filters_like_oracle_cli", async () => {
  const { endpoints, calls } = fakeEndpoints([
    vb({
      items: [
        row("WF_A"),
        row("TPL", { isTemplate: true }),
        row("HID", { hiddenFlag: true }),
        row("", { name: "no code" }),
        row("WF_B", { name: "  " }),
        row("WF_A", { name: "duplicate row" }),
        row("WF_C", { isTemplate: false, hiddenFlag: false }),
      ],
      hasMore: true,
    }),
    // The page's markers: which of its agents also have a draft.
    vb({ items: [{ workflowCode: "WF_A", status: "DRAFT" }, { workflowCode: "WF_C", status: "DRAFT", hiddenFlag: true }] }),
  ]);
  const page = await new OracleAgentDirectory({ endpoints }).page("PUBLISHED", "inv'oice", 50, 25);
  // The CLI's list query (status + customization rows excluded server-side + name/code search, $limit/$offset), for the
  // selected version.
  const filter = enc("(status = 'PUBLISHED' and sourceWorkflowCode = null and (name ~LIKE '%inv''oice%' or workflowCode ~LIKE '%inv''oice%'))");
  expect(calls[0]).toMatchObject({ target: "BOSS", method: "GET", url: `${WORKFLOWS}?$filter=${filter}&$fields=${LIST_FIELDS}&$limit=25&$offset=50` });
  const markers = enc("(status = 'DRAFT' and sourceWorkflowCode = null and (workflowCode = 'WF_A' or workflowCode = 'WF_B' or workflowCode = 'WF_C'))");
  expect(calls[1]).toMatchObject({ target: "BOSS", method: "GET", url: `${WORKFLOWS}?$filter=${markers}&$fields=${VERSION_FIELDS}&$limit=100` });
  // Templates, hidden rows and rows without a code are dropped; a blank name shows the code (as the CLI); a code once.
  expect(page.rows).toEqual([
    { workflowCode: "WF_A", name: "Agent WF_A", versions: ["PUBLISHED", "DRAFT"] },
    { workflowCode: "WF_B", name: "WF_B", versions: ["PUBLISHED"] },
    { workflowCode: "WF_C", name: "Agent WF_C", versions: ["PUBLISHED"] },
  ]);
  // The next page starts after the pod's rows, not after the shown ones.
  expect([page.hasMore, page.next]).toEqual([true, 57]);
});

test("draft_list_without_search_and_without_markers_call_for_an_empty_page", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ items: [row("TPL", { status: "DRAFT", isTemplate: true })], hasMore: false })]);
  const page = await new OracleAgentDirectory({ endpoints }).page("DRAFT", "  ", 0);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(`${WORKFLOWS}?$filter=${enc("(status = 'DRAFT' and sourceWorkflowCode = null)")}&$fields=${LIST_FIELDS}&$limit=25&$offset=0`);
  expect(page).toEqual({ rows: [], hasMore: false, next: 1 });
});

test("versions_of_one_agent_like_the_cli_workflow_read", async () => {
  const { endpoints, calls } = fakeEndpoints([
    vb({ items: [{ workflowCode: "WF_A", status: "DRAFT" }, { workflowCode: "WF_A", status: "DRAFT" }, { workflowCode: "WF_A", status: "PUBLISHED", hiddenFlag: true }, { workflowCode: "WF_A", status: "ARCHIVED" }] }),
  ]);
  expect(await new OracleAgentDirectory({ endpoints }).versionsOf("WF_A")).toEqual(["DRAFT"]);
  const filter = enc("(workflowCode = 'WF_A' and sourceWorkflowCode = null and (status = 'DRAFT' or status = 'PUBLISHED'))");
  expect(calls[0].url).toBe(`${WORKFLOWS}?$filter=${filter}&$fields=${VERSION_FIELDS}`);
});

test("failures_are_explicit", async () => {
  const { endpoints } = fakeEndpoints([vb({ detail: "denied" }, 403), vb("<html>login</html>")]);
  const dir = new OracleAgentDirectory({ endpoints });
  const e1 = await dir.page("PUBLISHED", "", 0).catch((x) => x);
  expect([e1 instanceof HistoryError, e1.status]).toEqual([true, 403]);
  const e2 = await dir.versionsOf("WF_A").catch((x) => x);
  expect([e2 instanceof HistoryError, e2.body]).toEqual([true, "non-JSON response"]);
});

describe("AgentListDataProvider", () => {
  const pages = (version: string, query: string, offset: number): { rows: { workflowCode: string; name: string; versions: ["PUBLISHED"] }[]; hasMore: boolean; next: number } => {
    const codes = offset === 0 ? ["A", "B", "C"] : ["C", "D"]; // C again on page 2 (several rows per code)
    return { rows: codes.map((c) => ({ workflowCode: `${version}_${query}_${c}`, name: c, versions: ["PUBLISHED"] })), hasMore: offset === 0, next: offset + 3 };
  };
  const fake = (): AgentDirectory & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    return {
      calls,
      page: (version, query, offset, limit) => { calls.push([version, query, offset, limit]); return Promise.resolve(pages(version, query, offset)); },
      versionsOf: () => Promise.resolve([]),
    };
  };

  test("pages_through_the_directory_with_unique_keys", async () => {
    const dir = fake();
    const dp = new AgentListDataProvider({ directory: dir, version: "PUBLISHED", query: "q", onError: () => undefined });
    const it = dp.fetchFirst({ size: 25 })[Symbol.asyncIterator]();
    const first = await it.next();
    expect([first.done, first.value.metadata.map((m) => m.key)]).toEqual([false, ["PUBLISHED_q_A", "PUBLISHED_q_B", "PUBLISHED_q_C"]]);
    const second = await it.next();
    expect([second.done, second.value.data.map((r) => r.name)]).toEqual([true, ["D"]]);
    expect(dir.calls).toEqual([["PUBLISHED", "q", 0, 25], ["PUBLISHED", "q", 3, 25]]);
    expect((await it.next()).done).toBe(true);
    expect(dir.calls).toHaveLength(2);
    // Keys of fetched rows resolve; offsets count the rows the iteration gives.
    expect((await dp.fetchByKeys({ keys: new Set(["PUBLISHED_q_D", "nope"]) })).results.size).toBe(1);
    expect((await dp.containsKeys({ keys: new Set(["PUBLISHED_q_A", "nope"]) })).results).toEqual(new Set(["PUBLISHED_q_A"]));
    const byOffset = await dp.fetchByOffset({ offset: 2, size: 2 });
    expect(byOffset.results.map((r) => r.data.name)).toEqual(["C", "D"]);
    expect(dp.getTotalSize instanceof Function && (await dp.getTotalSize())).toBe(-1);
  });

  test("a_failed_page_is_reported_and_rejects", async () => {
    const errors: unknown[] = [];
    const boom = new HistoryError(500, "boom");
    const dir: AgentDirectory = { page: () => Promise.reject(boom), versionsOf: () => Promise.resolve([]) };
    const dp = new AgentListDataProvider({ directory: dir, version: "DRAFT", query: "", onError: (e) => errors.push(e) });
    await expect(dp.fetchFirst()[Symbol.asyncIterator]().next()).rejects.toBe(boom);
    expect(errors).toEqual([boom]);
    // An aborted fetch (the list moved on) is not reported.
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(dp.fetchFirst({ signal: ctrl.signal })[Symbol.asyncIterator]().next()).rejects.toBe(boom);
    expect(errors).toHaveLength(1);
  });
});
