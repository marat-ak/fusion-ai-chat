// e2e of the debug host (tests/e2e-debug-host): a small stand-in for the engine's same-origin pod proxy (spec §17.1,
// engine contract 2026-10-24; bridge design §4.2 conversation form) in front of the mock pod, plus the delivered static
// debug-host build, on ONE origin as the gateway serves them (the fusion-ai-agent vhost: /ai-chat-debug/ from agent-ui,
// /api/pod/* engine).
//   node tests/fake-pod-proxy/server.mjs     (port 8790; serves dist/debug-host/, i.e. run after `npm run build:debug-host`)
// Proxy behaviour mirrored from the engine contract: X-Gnimsys-Pod-Proxy: 1 required on every call (403 csrf-refused);
// GET /api/pod/c/<conversationId>/_info -> {instance, podUser?} of the conversation's bound sign-in, or 401 auth-required;
// ANY /api/pod/c/<conversationId>/<TARGET>/<pod-path> -> the mock pod with the bound sign-in's Bearer, response piped
// unbuffered; an unknown conversation answers 404 unknown-conversation; proxy states carry X-Gnimsys-Pod-Proxy-Error:
// <state> and a JSON {state, message, ...} body; only the forwarded request headers reach the pod.
// TARGETS mirrors the narrowed proxy configuration the deployment uses (each target's prefixes = the component's call
// sites only); a target not listed answers 404 unknown-target, a path outside its target's prefixes 403 path-not-allowed
// (as in the engine: the path must start with a prefix and be strictly longer than it).
// Conversations (all of the test user's): u1__dev1 (bound to dev1, pod user test.user), u1__nouser (bound to dev1, pod
// user unknown), u1__unbound (no pod sign-in: 401 auth-required, _info included), u1__stale (_info answers, but the
// sign-in is gone by the first call: 401 auth-required), u1__noconf (FUAI not configured: 424 not-configured).
// Test controls: GET/DELETE /__proxy/requests -> read / clear the log of every /api/pod/ call (_info included).
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";

const PORT = 8790;
const MOCK_POD = { host: "127.0.0.1", port: 8787 };
const WEB = path.resolve("dist", "debug-host"); // what agent-ui's image copies
const STATIC = "/ai-chat-debug/";
const POD_TOKEN = "Bearer fake-pod-token";
const TARGETS = {
  FUAI: ["/api/fusion-ai/orchestrator/agent/v2/", "/api/fusion-ai/orchestrator/conversations/v1/"],
  BOSS: ["/api/boss/data/objects/ora/commonFusionAI/agents/v1/"],
  FA: ["/fscmRestApi/applcoreApi/v1/", "/hcmRestApi/resources/", "/hcmRestApi/rest/"],
};
const FORWARDED = ["content-type", "accept", "accept-language", "if-match", "rest-framework-version", "effective-of"];
const CONVERSATIONS = {
  u1__dev1: { instance: "dev1", podUser: "test.user" },
  u1__nouser: { instance: "dev1" },
  u1__unbound: null,
  u1__stale: { instance: "dev1", podUser: "test.user", stale: true },
  u1__noconf: { instance: "noconf", podUser: "test.user", missing: ["FUAI token key"] },
};
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json",
};

const log = [];

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
const proxyState = (res, status, state, extra = {}) =>
  json(res, status, { state, message: `fake pod proxy: ${state}`, ...extra }, { "X-Gnimsys-Pod-Proxy-Error": state });

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname.slice(STATIC.length)) || "index.html";
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB + path.sep)) return json(res, 404, { detail: "not found" });
  try {
    if (!statSync(file).isFile()) return json(res, 404, { detail: "not found" });
  } catch {
    return json(res, 404, { detail: "not found" });
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

function proxy(req, res, url) {
  const m = /^\/api\/pod\/c\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  const [, conversation, target, podPath = ""] = m ?? [];
  log.push({ method: req.method, conversation, target, path: m ? podPath + url.search : url.pathname + url.search, headers: { ...req.headers } });
  if (req.headers["x-gnimsys-pod-proxy"] !== "1") return proxyState(res, 403, "csrf-refused");
  if (!m) return proxyState(res, 400, "bad-path");
  if (!Object.hasOwn(CONVERSATIONS, conversation)) return proxyState(res, 404, "unknown-conversation");
  const bound = CONVERSATIONS[conversation];
  if (target === "_info" && podPath === "") {
    if (bound === null) return proxyState(res, 401, "auth-required");
    return json(res, 200, { instance: bound.instance, ...(bound.podUser !== undefined && { podUser: bound.podUser }) });
  }
  const prefixes = TARGETS[target];
  if (!prefixes) return proxyState(res, 404, "unknown-target");
  if (!prefixes.some((p) => podPath.startsWith(p) && podPath.length > p.length)) return proxyState(res, 403, "path-not-allowed", { target, path: podPath });
  if (bound === null || bound.stale) return proxyState(res, 401, "auth-required");
  if (bound.missing && target === "FUAI") return proxyState(res, 424, "not-configured", { instance: bound.instance, target, missing: bound.missing });

  const headers = { authorization: POD_TOKEN };
  for (const [k, v] of Object.entries(req.headers)) if (FORWARDED.includes(k) || k.startsWith("x-ora-ai-api-v2-")) headers[k] = v;
  const upstream = http.request({ ...MOCK_POD, method: req.method, path: podPath + url.search, headers }, (up) => {
    const out = { ...up.headers };
    delete out["set-cookie"];
    res.writeHead(up.statusCode ?? 502, out);
    res.flushHeaders();
    up.pipe(res); // unbuffered: each SSE frame goes on as the mock pod writes it
  });
  upstream.on("error", () => { if (!res.headersSent) proxyState(res, 502, "pod-unreachable"); else res.end(); });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://fake-proxy");
  if (url.pathname === "/__proxy/requests") {
    if (req.method === "DELETE") { log.length = 0; return json(res, 204, {}); }
    return json(res, 200, log);
  }
  if (url.pathname === "/ai-chat-debug") { res.writeHead(301, { Location: STATIC }); return res.end(); }
  if (url.pathname.startsWith(STATIC)) return serveStatic(req, res, url.pathname);
  if (url.pathname.startsWith("/api/pod/")) return proxy(req, res, url);
  return json(res, 404, { detail: `fake pod proxy: no route for ${url.pathname}` });
});
server.listen(PORT, "0.0.0.0", () => console.log(`fake pod proxy + debug host on http://0.0.0.0:${PORT}${STATIC}`));
