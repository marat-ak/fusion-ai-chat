// The workflow definition the debugger draws its graph from (bridge design §13, decisions 4 and 5): the BOSS `workflows`
// row of the run's workflow code and status, as the vendored aistudio CLI reads it (`$fields=…specification…`,
// `$filter=workflowCode='<code>' and status='<DRAFT|PUBLISHED>'`; `specification` is a JSON string or an object, the CLI
// accepts both). Pure: parseDefinition() turns the row into nodes, edges and Studio's own canvas positions; the loader
// (definitionSource.ts) does the call.
//
// Shape used (the rest of the specification is ignored): specification.dataPipeline.pipelineNodes[] =
//   {id, code?, type, metadata{name, errorNodeId?, dataPipeline?{pipelineNodes[]} (a LOOP's body)}, outcomes{label: id},
//    convergenceTargetId?, diagram?{x, y, width?, height?}}
// and specification.diagram.orientation. Positions are Studio's (decision 4: no layout of our own): a workflow whose drawn
// nodes lack x/y has no graph. END nodes without a position are not drawn (Studio's canvas omits them as well), and
// neither are the edges into them; ADD placeholders (no code) are never drawn.

/** One node of the definition. `x`/`y` are Studio's canvas coordinates (the card's top-left corner). */
export interface DefNode {
  id: string;
  /** The node code the run's frames name (`nodeCode`); absent on Studio's ADD placeholders. */
  code?: string;
  type: string;
  name: string;
  x?: number;
  y?: number;
  /** A LOOP's own box (it encloses its body). */
  width?: number;
  height?: number;
  /** The LOOP whose body holds this node. */
  parentId?: string;
  /** A LOOP: the id of its body's entry node (the body's rootNode). */
  bodyEntryId?: string;
  convergenceTargetId?: string;
}

/** One edge: an outcome (`label` = the outcome: success, true/false, a SWITCH case, a PARALLEL branch) or an error path. */
export interface DefEdge { id: string; from: string; to: string; label: string; kind: "outcome" | "error" }

export type LayoutState = { ok: true } | { ok: false; missing: string[] };

export interface WorkflowDefinition {
  workflowCode: string;
  status: string;
  /** BOSS `version` of the row (changes with every save); absent when the row has none. */
  version?: string;
  orientation?: string;
  nodes: DefNode[];
  edges: DefEdge[];
  /** The drawn nodes by code (codes are unique across the whole workflow, nested bodies included). */
  byCode: Map<string, DefNode>;
  byId: Map<string, DefNode>;
  /** Whether Studio's positions allow a graph: every node to draw has x/y (`missing` names the ones that do not). */
  layout: LayoutState;
}

/** Why a definition cannot be used (the notice shows the text). */
export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefinitionError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Whether a node is drawn: Studio draws every node with a code, except an END that has no position. */
function drawn(n: DefNode): boolean {
  if (n.code === undefined) return false;
  if (n.type === "END" && (n.x === undefined || n.y === undefined)) return false;
  return true;
}

/** The BOSS row -> the definition; throws DefinitionError naming what is wrong. */
export function parseDefinition(row: unknown): WorkflowDefinition {
  if (!isObj(row)) throw new DefinitionError("the workflow row is not an object");
  const workflowCode = str(row.workflowCode);
  const status = str(row.status);
  if (workflowCode === undefined || status === undefined) throw new DefinitionError("the workflow row has no workflowCode/status");
  let spec: unknown = row.specification;
  if (spec === undefined || spec === null || spec === "") throw new DefinitionError("the workflow row has no specification");
  if (typeof spec === "string") {
    try {
      spec = JSON.parse(spec);
    } catch (e) {
      throw new DefinitionError(`the specification is not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!isObj(spec) || !isObj(spec.dataPipeline) || !Array.isArray(spec.dataPipeline.pipelineNodes)) {
    throw new DefinitionError("the specification has no dataPipeline.pipelineNodes");
  }
  const nodes: DefNode[] = [];
  const raw: Array<{ node: DefNode; outcomes: Record<string, unknown>; errorNodeId?: string }> = [];
  const walk = (list: unknown[], parentId: string | undefined): void => {
    for (const item of list) {
      if (!isObj(item)) throw new DefinitionError("a pipeline node is not an object");
      const id = typeof item.id === "number" ? String(item.id) : str(item.id);
      const type = str(item.type);
      if (id === undefined || type === undefined) throw new DefinitionError("a pipeline node has no id/type");
      const md = isObj(item.metadata) ? item.metadata : {};
      const code = str(item.code);
      const d = isObj(item.diagram) ? item.diagram : {};
      const node: DefNode = { id, type, name: str(md.name) ?? code ?? type };
      if (code !== undefined) node.code = code;
      const x = num(d.x), y = num(d.y), w = num(d.width), h = num(d.height);
      if (x !== undefined && y !== undefined) { node.x = x; node.y = y; }
      if (w !== undefined && h !== undefined) { node.width = w; node.height = h; }
      if (parentId !== undefined) node.parentId = parentId;
      const conv = str(item.convergenceTargetId);
      if (conv !== undefined) node.convergenceTargetId = conv;
      nodes.push(node);
      const errorNodeId = typeof md.errorNodeId === "number" ? String(md.errorNodeId) : str(md.errorNodeId);
      raw.push({ node, outcomes: isObj(item.outcomes) ? item.outcomes : {}, ...(errorNodeId !== undefined && { errorNodeId }) });
      const body = isObj(md.dataPipeline) ? md.dataPipeline.pipelineNodes : undefined;
      const bodyRoot = isObj(md.dataPipeline) ? md.dataPipeline.rootNode : undefined;
      if (typeof bodyRoot === "string" && bodyRoot !== "") node.bodyEntryId = bodyRoot;
      if (Array.isArray(body)) walk(body, id);
    }
  };
  walk(spec.dataPipeline.pipelineNodes, undefined);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byCode = new Map<string, DefNode>();
  for (const n of nodes) {
    if (n.code === undefined) continue;
    if (byCode.has(n.code)) throw new DefinitionError(`node code ${n.code} appears twice`);
    byCode.set(n.code, n);
  }
  const edges: DefEdge[] = [];
  for (const { node, outcomes, errorNodeId } of raw) {
    for (const [label, target] of Object.entries(outcomes)) {
      const to = typeof target === "number" ? String(target) : str(target);
      if (to === undefined) continue;
      edges.push({ id: `${node.id}>${label}`, from: node.id, to, label, kind: "outcome" });
    }
    if (errorNodeId !== undefined) edges.push({ id: `${node.id}>error`, from: node.id, to: errorNodeId, label: "error", kind: "error" });
  }
  // Every node Studio draws needs its position; an END without one is simply not drawn (see drawn()).
  const missing = nodes.filter((n) => n.code !== undefined && n.type !== "END" && (n.x === undefined || n.y === undefined))
    .map((n) => n.code as string);
  const diagram = isObj(spec.diagram) ? spec.diagram : {};
  const version = typeof row.version === "number" ? String(row.version) : str(row.version);
  const orientation = str(diagram.orientation);
  return {
    workflowCode, status, nodes, edges, byCode, byId,
    ...(version !== undefined && { version }),
    ...(orientation !== undefined && { orientation }),
    layout: missing.length === 0 ? { ok: true } : { ok: false, missing },
  };
}

/** The nodes and edges a graph draws: drawn nodes only, and the edges between two drawn nodes. */
export function drawable(def: WorkflowDefinition): { nodes: DefNode[]; edges: DefEdge[] } {
  const nodes = def.nodes.filter(drawn);
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: def.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

/** The BOSS query of the run's definition row (the CLI's own field list, narrowed to what the graph reads). */
export function definitionUrl(workflowCode: string, status: string, fields = "workflowCode,status,version,specification"): string {
  const filter = `workflowCode='${workflowCode.replace(/'/g, "''")}' and status='${status.replace(/'/g, "''")}'`;
  return `/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=${encodeURIComponent(fields)}&$filter=${encodeURIComponent(filter)}`;
}
