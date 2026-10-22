// Mock Fusion pod for e2e: token relay, AI Studio v2 chat SSE, BOSS history, messages, attachments.
// Zero dependencies (Node 22 `http`). State is in memory and resets on process start.
// BOSS PATCH/DELETE on userConversations require `If-Match: "1"` (the rows' etag) and answer 412 without it.
//   node tests/mock-pod/server.mjs        (PORT env, default 8787; binds 0.0.0.0)
// Test controls (open; /__mock/* is never logged):
//   GET/DELETE /__mock/requests         -> read / clear the request log
//   POST /__mock/reset                  -> reload the fixture conversation rows and clear the armed one-shots (log kept)
//   GET /__mock/arm?workflows=<status>  -> the next BOSS workflows query answers <status> (4xx/5xx) once
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
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  for (const line of lines) {
    res.write(line + "\n\n");
    await sleep(SSE_GAP_MS);
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
      return json(res, 204);
    },
  },
  {
    method: "GET", path: /^\/__mock\/arm$/, open: true,
    handle: ({ res, url }) => {
      const status = Number(url.searchParams.get("workflows"));
      if (!Number.isInteger(status) || status < 400 || status > 599) return json(res, 400, { detail: "arm: workflows=<4xx|5xx> required" });
      state.workflowsStatusNext = status;
      return json(res, 200, { armed: { workflows: status } });
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
      const b = body && typeof body === "object" ? body : {};
      const pick = b.resumeInput ? "chat-resumed.sse"
        : b.message === "approve me" ? "chat-wait.sse"
        : b.message === "fail" ? "chat-error.sse"
        : "chat-hello.sse";
      return streamSse(res, pick);
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
    handle: ({ res }) => json(res, 200, { items: state.conversations.map(rowOut), hasMore: false, count: state.conversations.length }),
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
    method: "GET", path: new RegExp(`^${BOSS}/workflows$`),
    handle: ({ res }) => {
      if (state.workflowsStatusNext !== null) {
        const status = state.workflowsStatusNext;
        state.workflowsStatusNext = null;
        return json(res, status, { detail: `mock pod: armed workflows ${status}` });
      }
      return json(res, 200, {
        items: [{ name: "Mock Agent", firstStarterQuestion: "Show my invoices", secondStarterQuestion: "", thirdStarterQuestion: "Create a PO" }],
      });
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
    handle: ({ res }) => json(res, 200, {}),
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
