// Mock Fusion pod for e2e: token relay, AI Studio v2 chat and debug (draft, or published with status) SSE, BOSS history
// and workflows (filtered and paged like BOSS: see WORKFLOWS / parseWorkflowFilter), messages, attachments.
// Zero dependencies (Node 22 `http`). State is in memory and resets on process start.
// BOSS PATCH/DELETE on userConversations require `If-Match: "1"` (the rows' etag) and answer 412 without it.
//   node tests/mock-pod/server.mjs        (PORT env, default 8787; binds 0.0.0.0)
// Test controls (open; /__mock/* is never logged):
//   GET/DELETE /__mock/requests         -> read / clear the request log
//   POST /__mock/reset                  -> reload the fixture conversation rows and clear the armed one-shots (log kept)
//   GET /__mock/arm?workflows=<status>  -> the next BOSS workflows query answers <status> (4xx/5xx) once
//   GET /__mock/arm?workflowsStall=1    -> until reset, every paged workflows query ($offset) answers {items: [], hasMore: true}
//   GET /__mock/arm?listDelay=<ms>      -> the next BOSS userConversations list answers <ms> (0..30000) late, once
//   GET /__mock/arm?attachUpload=<status> -> the next attachUpload answers <status> (4xx/5xx) once
//   GET /__mock/arm?anticsrf=<status>   -> the next /fscmRestApi/anticsrf answers <status> (4xx/5xx) once
//   GET /__mock/arm?chat=<status>       -> the next /chat answers <status> (4xx/5xx) once, JSON {detail}
//   GET /__mock/arm?sseGap=<ms>         -> the next SSE stream writes its frames <ms> (0..1000) apart instead of 20 ms;
//                                          0 = every frame and the end of the stream at once
//   GET /__mock/arm?wizardVersion=<n>   -> until reset, the WIZARD_WF DRAFT row reports version <n> (a saved draft)
//                                          (the parameters may be combined in one call)
//   /chat by message: "approve me" / "wait for me" / "send me a file" (a HUMAN wait for a free-text reply: no approval, no
//   feedback; callbackToken "cb-3", jobId "job-3") / "fail" / "unsafe html" / "long list" (see the route), "pick subinventory"
//   (a gnimsys-ui form: 24-option select + hidden + Approve/Back), "pick from datasource" (a select searched and paged
//   through GET /fscmRestApi/resources/11.13.18.05/subinventories, 300 rows), "choose next step" (radio + checkbox +
//   hidden + confirm button, then an invalid block); anything else -> chat-hello.sse.
//   /debug (any other workflow than the golden ones) by message: "approve me" (as /chat), "pick from fa and boss" (a
//   gnimsys-ui form: an FA select over /subinventories preset to 12026 + a BOSS select over the workflows object preset to
//   PAGED_WF_02, both searchable), "long return" (START + a RETURN whose input and output are a ~1000-character
//   multi-line reply with a long unbroken JSON line: the inspector's long-value view); anything else -> chat-hello.sse.
//   GET /fscmRestApi/anticsrf           -> { "xsrftoken": "test-xsrf" } (open; the relay requires it as x-xsrf-token)
//   GET /fscmRestApi/tokenrelay?$mock=expired -> the next relay answers login HTML once (this call is logged)
import http from "node:http";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIXTURES), "utf8");
const XSRF = "test-xsrf";
const ETAG = '"1"';
const SSE_GAP_MS = 20;
const BOSS = "/api/boss/data/objects/ora/commonFusionAI/agents/v1/\\$en";
const RECORDED_HEADERS = ["authorization", "content-type", "accept", "if-match", "x-xsrf-token", "cache-control"];

const state = {
  conversations: JSON.parse(fixture("conversations.json")),
  relayExpiredNext: false,
  workflowsStatusNext: null,
  workflowsStall: false,
  listDelayNext: null,
  attachUploadStatusNext: null,
  anticsrfStatusNext: null,
  chatStatusNext: null,
  sseGapNext: null,
  requests: [],
};

// ---- helpers ---------------------------------------------------------------------------------

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

/** Streams every `data:` line of an .sse fixture as its own frame, SSE_GAP_MS apart. */
async function streamSse(res, fixtureName) {
  const lines = fixture(fixtureName).split("\n").filter((l) => l.startsWith("data:"));
  const gap = state.sseGapNext ?? SSE_GAP_MS;
  state.sseGapNext = null;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  for (const line of lines) {
    res.write(line + "\n\n");
    if (gap > 0) await sleep(gap);
  }
  res.end();
}

/**
 * A /debug turn of the golden workflows: message "start" = turn 1, anything else = turn 2; the final frame carries the
 * request's conversationId. With debugParams.breakPoints the run stops as Oracle's does (Studio HAR 2026-10-25): the
 * frames end before the first breakpoint node's first frame and the turn ends `stop` with the last executed node's output
 * as its output (no TEXT deltas after the stop).
 */
async function streamDebugTurn(res, b) {
  const frames = fixture(DEBUG_TURNS[b.message === "start" ? 0 : 1]).split("\n").filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
  const finalFrame = frames[frames.length - 1];
  const breakPoints = Array.isArray(b.debugParams?.breakPoints) ? b.debugParams.breakPoints : [];
  let out = frames.slice(0, -1);
  let final = { ...finalFrame, conversationId: b.conversationId };
  const stopAt = breakPoints.length === 0 ? -1 : out.findIndex((f) => breakPoints.includes(f.nodeProgressMessage?.nodeCode));
  if (stopAt >= 0) {
    out = out.slice(0, stopAt).filter((f) => f.nodeProgressMessage !== undefined);
    const last = [...out].reverse().find((f) => f.nodeProgressMessage.type !== "NODE_START");
    final = { ...final, message: { finishReason: "stop", output: last?.nodeProgressMessage.nodeOutput ?? "", followUpQuestions: [] } };
  }
  const gap = state.sseGapNext ?? 5;
  state.sseGapNext = null;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  for (const f of [...out, final]) {
    res.write("data: " + JSON.stringify(f) + "\n\n");
    if (gap > 0) await sleep(gap);
  }
  res.end();
}

function parseBody(contentType, buf) {
  if (buf.length === 0) return null;
  const text = buf.toString("utf8");
  if (/[/+]json\b/.test(contentType ?? "")) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

function recordedHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (RECORDED_HEADERS.includes(k) || k.startsWith("x-ora-ai-api-v2-")) out[k] = v;
  }
  return out;
}

function relayToken(scope) {
  // urn:opc:resource:fusion:<pod>:<audience>/ -> <audience>; no scope = the plain REST token
  const aud = scope ? scope.replace(/\/+$/, "").split(":").pop() : "rest";
  const iat = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({ aud, iat, exp: iat + 3600 })}.mock-signature`;
}

const rowOut = (r) => ({ ...r, $context: { etag: ETAG } });
const findRow = (id) => state.conversations.find((r) => r.id === id);

// The debugger's golden run (fixtures/debug-wizard-*: a real 72-node DRAFT workflow and two real /debug turns of it,
// sanitized — structure, timings, Studio x/y and Oracle's cuts kept, every value, name and code replaced). WIZARD_WF is that
// workflow; NOXY_WF the same without Studio positions. Both rows are hidden (hiddenFlag), so the agent lists of the run
// selection tests do not change; the debugger binds them through its URL.
const WIZARD = JSON.parse(fixture("debug-wizard-workflow.json"));
const NOXY = (() => {
  const spec = JSON.parse(WIZARD.specification);
  const strip = (nodes) => nodes.map(({ diagram: _d, ...n }) => (n.metadata?.dataPipeline
    ? { ...n, metadata: { ...n.metadata, dataPipeline: { ...n.metadata.dataPipeline, pipelineNodes: strip(n.metadata.dataPipeline.pipelineNodes) } } }
    : n));
  spec.dataPipeline.pipelineNodes = strip(spec.dataPipeline.pipelineNodes);
  return { ...WIZARD, workflowCode: "NOXY_WF", name: "No Layout Agent", specification: JSON.stringify(spec) };
})();
const DEBUG_TURNS = ["debug-wizard-turn1.sse", "debug-wizard-turn2.sse"];

// The widget datasource rows: 300 subinventories 12001..12300, descriptions cycling through 24 names ("Raw Materials 2"
// = code 12002, "Raw Materials 26" = 12026, …), so a typed prefix narrows the list and a page of 25 never holds it all.
const SUBINV_NAMES = [
  "Main Store", "Raw Materials", "Finished Goods", "Quarantine", "Returns", "Spare Parts", "Consignment", "Packaging",
  "Staging In", "Staging Out", "Line 1 Floor Stock", "Line 2 Floor Stock", "Line 3 Floor Stock", "Tooling", "Maintenance", "Samples",
  "Demo Units", "Service Van 1", "Service Van 2", "Rework", "Scrap", "Bonded", "Export Hold", "Overflow",
];
const SUBINVENTORIES = Array.from({ length: 300 }, (_, i) => ({
  SubinventoryCode: String(12001 + i),
  Description: `${SUBINV_NAMES[i % SUBINV_NAMES.length]} ${i + 1}`,
}));
const DEBUG_WORKFLOWS = new Set(["WIZARD_WF", "NOXY_WF"]);

// BOSS workflows: MOCK_WF (PUBLISHED + DRAFT), a template, a hidden row, a customization row (sourceWorkflowCode set),
// INVOICE_WF (PUBLISHED), DRAFT_ONLY_WF (DRAFT), then 30 PUBLISHED rows so the agent list has a second page; then the
// debugger's hidden WIZARD_WF / NOXY_WF DRAFT rows (WIZARD_WF's version is state: /__mock/arm?wizardVersion bumps it).
const WORKFLOWS = [
  ...JSON.parse(fixture("workflows.json")),
  ...Array.from({ length: 30 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { workflowCode: `PAGED_WF_${n}`, name: `Paged Agent ${n}`, status: "PUBLISHED", sourceWorkflowCode: null, isTemplate: false, hiddenFlag: false };
  }),
  { ...WIZARD, hiddenFlag: true },
  { ...NOXY, hiddenFlag: true },
];

// WORKFLOW_FILTER: the BOSS $filter subset the chat sends: comparisons `field = 'v'` / `field = null` / `field ~= 'v'`
// (case-insensitive equal) / `field ~LIKE '%v%'` (case-insensitive, % = any text), joined by `and` / `or` (and binds
// tighter) with parentheses. Returns a row predicate; throws on anything else.
function parseWorkflowFilter(text) {
  const tokens = [];
  const re = /\s*(\(|\)|'(?:[^']|'')*'|~LIKE\b|~=|=|[A-Za-z_][A-Za-z0-9_.]*)/gy;
  let m;
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    m = re.exec(text);
    if (m === null) {
      if (text.slice(at).trim() === "") break;
      throw new Error(`unexpected input at ${at}: ${text.slice(at, at + 20)}`);
    }
    tokens.push(m[1]);
    at = re.lastIndex;
  }
  let i = 0;
  const peek = () => tokens[i];
  const take = (want) => {
    const t = tokens[i++];
    if (want !== undefined && t !== want) throw new Error(`expected ${want}, got ${t}`);
    return t;
  };
  const value = () => {
    const t = take();
    if (t === "null") return null;
    if (t === undefined || !t.startsWith("'")) throw new Error(`expected a value, got ${t}`);
    return t.slice(1, -1).replace(/''/g, "'");
  };
  const comparison = () => {
    const field = take();
    const op = take();
    const v = value();
    if (op === "=") return (row) => (v === null ? row[field] == null : row[field] === v);
    if (op === "~=") return (row) => typeof row[field] === "string" && row[field].toLowerCase() === String(v).toLowerCase();
    if (op === "~LIKE") {
      const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp("^" + String(v).split("%").map(escape).join(".*") + "$", "i");
      return (row) => typeof row[field] === "string" && pattern.test(row[field]);
    }
    throw new Error(`unknown operator ${op}`);
  };
  const factor = () => {
    if (peek() === "(") {
      take("(");
      const e = expr();
      take(")");
      return e;
    }
    return comparison();
  };
  const term = () => {
    let left = factor();
    while (peek() === "and") {
      take();
      const l = left;
      const r = factor();
      left = (row) => l(row) && r(row);
    }
    return left;
  };
  function expr() {
    let left = term();
    while (peek() === "or") {
      take();
      const l = left;
      const r = term();
      left = (row) => l(row) || r(row);
    }
    return left;
  }
  const result = expr();
  if (i !== tokens.length) throw new Error(`unexpected ${tokens[i]}`);
  return result;
}

// ---- routes (first match wins) ---------------------------------------------------------------

const routes = [
  {
    method: "GET", path: /^\/__mock\/requests$/, open: true,
    handle: ({ res }) => json(res, 200, state.requests),
  },
  {
    method: "DELETE", path: /^\/__mock\/requests$/, open: true,
    handle: ({ res }) => { state.requests = []; json(res, 204); },
  },
  {
    method: "POST", path: /^\/__mock\/reset$/, open: true,
    handle: ({ res }) => {
      state.conversations = JSON.parse(fixture("conversations.json"));
      state.relayExpiredNext = false;
      state.workflowsStatusNext = null;
      state.workflowsStall = false;
      state.listDelayNext = null;
      state.attachUploadStatusNext = null;
      state.anticsrfStatusNext = null;
      state.chatStatusNext = null;
      state.sseGapNext = null;
      WORKFLOWS.find((r) => r.workflowCode === "WIZARD_WF").version = WIZARD.version;
      return json(res, 204);
    },
  },
  {
    method: "GET", path: /^\/__mock\/arm$/, open: true,
    handle: ({ res, url }) => {
      const p = url.searchParams;
      const usage = "arm: workflows=<4xx|5xx>, workflowsStall=1, listDelay=<0..30000 ms>, attachUpload=<4xx|5xx>, anticsrf=<4xx|5xx>, chat=<4xx|5xx>, sseGap=<0..1000 ms> and/or wizardVersion=<int> required";
      if (!["workflows", "workflowsStall", "listDelay", "attachUpload", "anticsrf", "chat", "sseGap", "wizardVersion"].some((k) => p.has(k))) return json(res, 400, { detail: usage });
      const wizardVersion = Number(p.get("wizardVersion"));
      if (p.has("wizardVersion") && !Number.isInteger(wizardVersion)) return json(res, 400, { detail: usage });
      const status = Number(p.get("workflows"));
      const delay = Number(p.get("listDelay"));
      if (p.has("workflows") && (!Number.isInteger(status) || status < 400 || status > 599)) return json(res, 400, { detail: usage });
      if (p.has("listDelay") && (!Number.isInteger(delay) || delay < 0 || delay > 30000)) return json(res, 400, { detail: usage });
      const upload = Number(p.get("attachUpload"));
      if (p.has("attachUpload") && (!Number.isInteger(upload) || upload < 400 || upload > 599)) return json(res, 400, { detail: usage });
      const anti = Number(p.get("anticsrf"));
      if (p.has("anticsrf") && (!Number.isInteger(anti) || anti < 400 || anti > 599)) return json(res, 400, { detail: usage });
      const chat = Number(p.get("chat"));
      if (p.has("chat") && (!Number.isInteger(chat) || chat < 400 || chat > 599)) return json(res, 400, { detail: usage });
      const sseGap = Number(p.get("sseGap"));
      if (p.has("sseGap") && (!Number.isInteger(sseGap) || sseGap < 0 || sseGap > 1000)) return json(res, 400, { detail: usage });
      const armed = {};
      if (p.has("workflows")) state.workflowsStatusNext = armed.workflows = status;
      if (p.has("workflowsStall")) state.workflowsStall = armed.workflowsStall = p.get("workflowsStall") === "1";
      if (p.has("listDelay")) state.listDelayNext = armed.listDelay = delay;
      if (p.has("attachUpload")) state.attachUploadStatusNext = armed.attachUpload = upload;
      if (p.has("anticsrf")) state.anticsrfStatusNext = armed.anticsrf = anti;
      if (p.has("chat")) state.chatStatusNext = armed.chat = chat;
      if (p.has("sseGap")) state.sseGapNext = armed.sseGap = sseGap;
      if (p.has("wizardVersion")) WORKFLOWS.find((r) => r.workflowCode === "WIZARD_WF").version = armed.wizardVersion = wizardVersion;
      return json(res, 200, { armed });
    },
  },
  {
    method: "GET", path: /^\/fscmRestApi\/anticsrf$/, open: true,
    handle: ({ res }) => {
      if (state.anticsrfStatusNext !== null) {
        const status = state.anticsrfStatusNext;
        state.anticsrfStatusNext = null;
        return json(res, status, { detail: `mock pod: armed anticsrf ${status}` });
      }
      return json(res, 200, { xsrftoken: XSRF });
    },
  },
  {
    method: "GET", path: /^\/fscmRestApi\/tokenrelay$/, open: true,
    handle: ({ req, res, url }) => {
      if (url.searchParams.get("$mock") === "expired") {
        state.relayExpiredNext = true;
        return json(res, 200, { mock: "next relay answers HTML once" });
      }
      if (state.relayExpiredNext) {
        state.relayExpiredNext = false;
        return html(res, "<html>login</html>");
      }
      if (req.headers["x-xsrf-token"] !== XSRF) return html(res, "<html>login</html>");
      return json(res, 200, {
        principal: "test.user",
        expires_in: 3600,
        token_type: "Bearer",
        access_token: relayToken(url.searchParams.get("scopesfq")),
      });
    },
  },
  {
    method: "POST", path: /^\/api\/fusion-ai\/orchestrator\/agent\/v2\/[^/]+\/chat$/,
    handle: ({ res, body }) => {
      if (state.chatStatusNext !== null) {
        const status = state.chatStatusNext;
        state.chatStatusNext = null;
        return json(res, status, { detail: `mock pod: armed chat ${status}` });
      }
      const b = body && typeof body === "object" ? body : {};
      const pick = b.resumeInput ? "chat-resumed.sse"
        : b.message === "approve me" ? "chat-wait.sse"
        : b.message === "wait for me" ? "chat-wait-timer.sse"
        : b.message === "send me a file" ? "chat-wait-input.sse"
        : b.message === "fail" ? "chat-error.sse"
        : b.message === "unsafe html" ? "chat-unsafe.sse"
        : b.message === "long list" ? "chat-long-list.sse"
        : b.message === "pick subinventory" ? "chat-widget-subinv.sse"
        : b.message === "pick from datasource" ? "chat-widget-datasource.sse"
        : b.message === "choose next step" ? "chat-widget-choice.sse"
        : "chat-hello.sse";
      return streamSse(res, pick);
    },
  },
  {
    // The widget datasource (chat-widget-datasource.sse and the overlay e2e): a Fusion REST collection of SUBINVENTORIES
    // (300 rows), filtered by `q` as the endpoint data provider writes it (`Description LIKE '<prefix>%'`, case-insensitive,
    // or `SubinventoryCode IN ('k1','k2')`), paged by `limit`/`offset` (no limit = every match), `hasMore`, and
    // `totalResults` when asked for. `fields` is ignored (whole rows come back).
    method: "GET", path: /^\/fscmRestApi\/resources\/11\.13\.18\.05\/subinventories$/,
    handle: ({ res, url }) => {
      const q = url.searchParams.get("q");
      let match = () => true;
      if (q !== null) {
        const like = /^Description LIKE '(.*)%'$/.exec(q);
        const within = /^SubinventoryCode IN \((.*)\)$/.exec(q);
        if (like) {
          const prefix = like[1].replace(/''/g, "'").toLowerCase();
          match = (r) => r.Description.toLowerCase().startsWith(prefix);
        } else if (within) {
          const keys = new Set(within[1].split(",").map((k) => k.trim().replace(/^'|'$/g, "").replace(/''/g, "'")));
          match = (r) => keys.has(r.SubinventoryCode);
        } else {
          return json(res, 400, { detail: `mock pod: unsupported subinventories q: ${q}` });
        }
      }
      const hits = SUBINVENTORIES.filter(match);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : hits.length;
      const items = hits.slice(offset, offset + limit);
      const body = { items, hasMore: offset + items.length < hits.length, offset, limit, count: items.length };
      if (url.searchParams.get("totalResults") === "true") body.totalResults = hits.length;
      return json(res, 200, body);
    },
  },
  {
    // Studio's test path, as the vendored aistudio CLI's debug runner calls it: the run must say it is an ADMIN debug run;
    // no `status` runs the draft, `status: "PUBLISHED"` the published copy (any other status is refused).
    method: "POST", path: /^\/api\/fusion-ai\/orchestrator\/agent\/v2\/[^/]+\/debug$/,
    handle: ({ res, body, url }) => {
      const b = body && typeof body === "object" ? body : {};
      if (b.invocationMode !== "ADMIN" || b.debugParams?.isDebug !== true) {
        return json(res, 400, { detail: "mock pod: /debug needs invocationMode ADMIN and debugParams.isDebug" });
      }
      if (b.status !== undefined && b.status !== "PUBLISHED") {
        return json(res, 400, { detail: "mock pod: /debug status must be absent (draft) or PUBLISHED" });
      }
      const wf = decodeURIComponent(url.pathname.split("/")[6]);
      if (DEBUG_WORKFLOWS.has(wf)) return streamDebugTurn(res, b);
      return streamSse(res, b.resumeInput ? "chat-resumed.sse" : b.message === "approve me" ? "chat-wait.sse"
        : b.message === "pick from fa and boss" ? "chat-widget-targets.sse"
        : b.message === "long return" ? "debug-return-long.sse" : "chat-hello.sse");
    },
  },
  {
    method: "GET", path: /^\/api\/fusion-ai\/orchestrator\/conversations\/v1\/([^/]+)\/messages$/,
    handle: ({ res, m }) => {
      const id = decodeURIComponent(m[1]);
      if (id === "conv-1") return json(res, 200, JSON.parse(fixture("messages-conv-1.json")));
      if (id === "broken") return json(res, 500, { detail: "boom" });
      return json(res, 200, { items: [] });
    },
  },
  {
    method: "GET", path: new RegExp(`^${BOSS}/userConversations$`),
    handle: async ({ res }) => {
      if (state.listDelayNext !== null) {
        const ms = state.listDelayNext;
        state.listDelayNext = null;
        await sleep(ms);
      }
      return json(res, 200, { items: state.conversations.map(rowOut), hasMore: false, count: state.conversations.length });
    },
  },
  {
    method: "GET", path: new RegExp(`^${BOSS}/userConversations/([^/]+)$`),
    handle: ({ res, m }) => {
      const row = findRow(decodeURIComponent(m[1]));
      return row ? json(res, 200, rowOut(row), { ETag: ETAG }) : json(res, 404, { detail: "not found" });
    },
  },
  {
    method: "PATCH", path: new RegExp(`^${BOSS}/userConversations/([^/]+)$`),
    handle: ({ req, res, m, body }) => {
      const row = findRow(decodeURIComponent(m[1]));
      if (!row) return json(res, 404, { detail: "not found" });
      if (req.headers["if-match"] !== ETAG) return json(res, 412, { detail: "If-Match must be " + ETAG });
      if (body && typeof body.name === "string") row.name = body.name;
      return json(res, 200, rowOut(row), { ETag: ETAG });
    },
  },
  {
    method: "DELETE", path: new RegExp(`^${BOSS}/userConversations/([^/]+)$`),
    handle: ({ req, res, m }) => {
      const id = decodeURIComponent(m[1]);
      if (!findRow(id)) return json(res, 404, { detail: "not found" });
      if (req.headers["if-match"] !== ETAG) return json(res, 412, { detail: "If-Match must be " + ETAG });
      state.conversations = state.conversations.filter((r) => r.id !== id);
      return json(res, 204);
    },
  },
  {
    // The rows of fixtures/workflows.json + PAGED_WF_01..30 (PUBLISHED), filtered by $filter (WORKFLOW_FILTER grammar) and
    // paged by $limit/$offset (no $limit = every match); $fields is ignored (whole rows come back).
    method: "GET", path: new RegExp(`^${BOSS}/workflows$`),
    handle: ({ res, url }) => {
      if (state.workflowsStatusNext !== null) {
        const status = state.workflowsStatusNext;
        state.workflowsStatusNext = null;
        return json(res, status, { detail: `mock pod: armed workflows ${status}` });
      }
      // A pod that keeps reporting more rows without returning any (the agent list must stop by itself).
      if (state.workflowsStall && url.searchParams.has("$offset")) return json(res, 200, { items: [], hasMore: true });
      const filter = url.searchParams.get("$filter");
      let match;
      try {
        match = filter === null ? () => true : parseWorkflowFilter(filter);
      } catch (e) {
        return json(res, 400, { detail: `mock pod: bad $filter: ${e instanceof Error ? e.message : String(e)}` });
      }
      const hits = WORKFLOWS.filter(match);
      const offset = Number(url.searchParams.get("$offset") ?? 0);
      const limit = url.searchParams.has("$limit") ? Number(url.searchParams.get("$limit")) : hits.length;
      const items = hits.slice(offset, offset + limit);
      return json(res, 200, { items, hasMore: offset + items.length < hits.length, offset, limit, count: items.length });
    },
  },
  {
    method: "POST", path: /^\/hcmRestApi\/.+\/hcmAiStudioConversations$/,
    handle: ({ res, body }) => json(res, 201, body ?? {}),
  },
  {
    method: "POST", path: /^\/hcmRestApi\/.+\/$/, // ADF batch on `${hcmRestBase}/`
    handle: ({ res, body }) => json(res, 200, { parts: body?.parts ?? [] }),
  },
  {
    method: "POST", path: /^\/fscmRestApi\/applcoreApi\/v1\/attachDocTracker\/$/,
    handle: ({ res }) => json(res, 200, { trackers: [{ trackerId: "trk-1" }], username: "test.user" }),
  },
  {
    method: "POST", path: /^\/fscmRestApi\/applcoreApi\/v1\/attachUpload$/,
    handle: ({ res }) => {
      if (state.attachUploadStatusNext !== null) {
        const status = state.attachUploadStatusNext;
        state.attachUploadStatusNext = null;
        return json(res, status, { detail: `mock pod: armed attachUpload ${status}` });
      }
      return json(res, 200, {});
    },
  },
];

// ---- server ----------------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = new URL(req.url, "http://mock-pod");
  const body = parseBody(req.headers["content-type"], Buffer.concat(chunks));
  if (!url.pathname.startsWith("/__mock/")) {
    state.requests.push({ method: req.method, url: req.url, headers: recordedHeaders(req.headers), body });
  }

  let m = null;
  const route = routes.find((r) => r.method === req.method && (m = r.path.exec(url.pathname)));
  if (!route) return json(res, 404, { detail: `mock pod: no route for ${req.method} ${url.pathname}` });
  if (!route.open && !/^Bearer \S+/.test(req.headers.authorization ?? "")) return json(res, 401, { detail: "unauthorized" });
  try {
    await route.handle({ req, res, url, m, body });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { detail: "mock pod error: " + (e instanceof Error ? e.message : String(e)) });
    else res.end();
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, "0.0.0.0", () => console.log(`mock pod listening on http://0.0.0.0:${port}`));
