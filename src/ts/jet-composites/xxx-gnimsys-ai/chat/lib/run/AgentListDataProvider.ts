// The agent list as a JET DataProvider over the endpoint layer (design §5.1, §9): one instance per version and search text;
// fetchFirst pages through the directory (OracleAgentDirectory, endpoint BOSS) as the list view scrolls. Keys are workflow
// codes; a code already given in an earlier block of the same iteration is not given again (a key must be unique).
import type {
  ContainsKeysResults, DataProvider, FetchByKeysParameters, FetchByKeysResults, FetchByOffsetParameters, FetchByOffsetResults,
  FetchListParameters, FetchListResult, ItemMetadata,
} from "ojs/ojdataprovider";
import type { ArtifactVersion } from "../config/types";
import { AGENT_PAGE_SIZE } from "./OracleAgentDirectory";
import type { AgentDirectory, AgentRow } from "./OracleAgentDirectory";

type Block = FetchListResult<string, AgentRow>;

/**
 * Pages in a row that may bring no new agent while the pod still reports more (rows all filtered out or already given):
 * the third such page ends the list with an error. The list view keeps asking for the next block until it is full, so a
 * pod that answers `hasMore` without moving on (an ignored `$offset`) would otherwise be called without end — and the
 * pod's WAF bans request bursts.
 */
export const MAX_EMPTY_PAGES = 3;

/** The pod reported more agents but the pages stopped bringing new ones: the list ends here, explicitly. */
export class AgentListStalledError extends Error {
  constructor(offset: number, why: string) {
    super(`the agent list stopped at row ${offset}: ${why}`);
    this.name = "AgentListStalledError";
  }
}

export class AgentListDataProvider implements DataProvider<string, AgentRow> {
  private readonly directory: AgentDirectory;
  private readonly version: ArtifactVersion;
  private readonly query: string;
  private readonly onError: (e: unknown) => void;
  /** The rows fetched so far, for fetchByKeys / containsKeys. */
  private readonly rows = new Map<string, AgentRow>();
  private readonly events = new EventTarget();

  /** `onError`: called with a failed page's error before the iteration rejects with it (the list view does not show it). */
  constructor(options: { directory: AgentDirectory; version: ArtifactVersion; query: string; onError: (e: unknown) => void }) {
    this.directory = options.directory;
    this.version = options.version;
    this.query = options.query;
    this.onError = options.onError;
  }

  /** One pod page; a failure is reported unless the fetch was aborted (the list view moved on to another fetch). */
  private async load(offset: number, size: number, signal: AbortSignal | undefined): Promise<{ rows: AgentRow[]; hasMore: boolean; next: number }> {
    try {
      const page = await this.directory.page(this.version, this.query, offset, size);
      for (const r of page.rows) this.rows.set(r.workflowCode, r);
      return page;
    } catch (e) {
      if (signal?.aborted !== true) this.onError(e);
      throw e;
    }
  }

  fetchFirst(params?: FetchListParameters<AgentRow>): AsyncIterable<Block> {
    const size = params?.size !== undefined && params.size > 0 ? params.size : AGENT_PAGE_SIZE;
    const fetchParameters = params ?? {};
    let offset = 0;
    let more = true;
    let empty = 0;
    const given = new Set<string>();
    const block = (data: AgentRow[]): Block =>
      ({ fetchParameters, data, metadata: data.map((r): ItemMetadata<string> => ({ key: r.workflowCode })) });
    const stalled = (why: string): never => {
      more = false;
      const e = new AgentListStalledError(offset, why);
      if (params?.signal?.aborted !== true) this.onError(e);
      throw e;
    };
    const next = async (): Promise<IteratorResult<Block, Block>> => {
      if (!more) return { done: true, value: block([]) };
      const page = await this.load(offset, size, params?.signal);
      if (page.hasMore && page.next <= offset) stalled("the pod reports more agents but returned no rows");
      const data = page.rows.filter((r) => !given.has(r.workflowCode));
      empty = data.length === 0 ? empty + 1 : 0;
      if (page.hasMore && empty >= MAX_EMPTY_PAGES) stalled(`the pod reports more agents but ${MAX_EMPTY_PAGES} pages in a row brought no new one`);
      offset = page.next;
      more = page.hasMore;
      for (const r of data) given.add(r.workflowCode);
      return { done: !more, value: block(data) };
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }

  fetchByKeys(params: FetchByKeysParameters<string>): Promise<FetchByKeysResults<string, AgentRow>> {
    const results = new Map<string, { metadata: ItemMetadata<string>; data: AgentRow }>();
    for (const key of params.keys) {
      const data = this.rows.get(key);
      if (data !== undefined) results.set(key, { metadata: { key }, data });
    }
    return Promise.resolve({ fetchParameters: params, results });
  }

  containsKeys(params: FetchByKeysParameters<string>): Promise<ContainsKeysResults<string>> {
    return Promise.resolve({ containsParameters: params, results: new Set([...params.keys].filter((k) => this.rows.has(k))) });
  }

  /** By iteration: offsets count the rows fetchFirst gives (codes deduplicated), not the pod's rows. */
  async fetchByOffset(params: FetchByOffsetParameters<AgentRow>): Promise<FetchByOffsetResults<string, AgentRow>> {
    const size = params.size !== undefined && params.size > 0 ? params.size : AGENT_PAGE_SIZE;
    const end = params.offset + size;
    const rows: AgentRow[] = [];
    const it = this.fetchFirst({ size, ...(params.signal !== undefined && { signal: params.signal }) })[Symbol.asyncIterator]();
    let done = false;
    while (rows.length < end && !done) {
      const r = await it.next();
      rows.push(...r.value.data);
      done = r.done === true;
    }
    return {
      fetchParameters: params,
      results: rows.slice(params.offset, end).map((data) => ({ metadata: { key: data.workflowCode }, data })),
      done: done && rows.length <= end,
    };
  }

  getCapability(capabilityName: string): unknown {
    // Rows arrive page by page from the pod; keys are looked up among the rows fetched so far. Nothing else is supported
    // (no sort, no filter criterion: the search text is part of the instance).
    if (capabilityName === "fetchFirst") return { iterationSpeed: "delayed" };
    if (capabilityName === "fetchByKeys") return { implementation: "lookup" };
    if (capabilityName === "fetchByOffset") return { implementation: "iteration" };
    return null;
  }

  getTotalSize(): Promise<number> {
    return Promise.resolve(-1);
  }

  isEmpty(): "yes" | "no" | "unknown" {
    return "unknown";
  }

  addEventListener(eventType: string, listener: EventListener): void {
    this.events.addEventListener(eventType, listener);
  }

  removeEventListener(eventType: string, listener: EventListener): void {
    this.events.removeEventListener(eventType, listener);
  }

  dispatchEvent(evt: Event): boolean {
    return this.events.dispatchEvent(evt);
  }
}
