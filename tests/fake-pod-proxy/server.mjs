// e2e of the debug host (tests/e2e-debug-host): a small stand-in for the engine's same-origin pod proxy (spec §17.1,
// engine contract 2026-10-24) in front of the mock pod, plus the static debug-host build, on ONE origin as the gateway
// serves them (the fusion-ai-agent vhost: /ai-chat-debug/ static, /api/pod/* engine).
//   node tests/fake-pod-proxy/server.mjs     (port 8790; serves ./web, i.e. run after `npm run build:debug-host`)
// Proxy behaviour mirrored from the engine contract: X-Gnimsys-Pod-Proxy: 1 required on every call (403 csrf-refused);
// GET /api/pod/instances -> {instances:[{name,label,connected,podUser?,podUsers?,missing?}]}; ANY
// /api/pod/<instance>/<TARGET>/<pod-path> -> the mock pod with a Bearer, response piped unbuffered; proxy states carry
// X-Gnimsys-Pod-Proxy-Error: <state> and a JSON {state, message, ...} body; only the forwarded request headers reach the pod.
// Instances: dev1 (signed in as test.user), nouser (signed in, pod user unknown), stale (listed as signed in, but its token
// is gone: 401 auth-required), off (not signed in), noconf (FUAI not configured: 424 not-configured).
// Test controls: GET/DELETE /__proxy/requests -> read / clear the log of proxied calls (instances listings not logged).
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";

const PORT = 8790;
const MOCK_POD = { host: "127.0.0.1", port: 8787 };
const WEB = path.resolve("web");
const STATIC = "/ai-chat-debug/";
const POD_TOKEN = "Bearer fake-pod-token";
const TARGETS = {
  FA: ["/fscmRestApi/", "/hcmRestApi/", "/crmRestApi/", "/applcoreApi/v1/", "/xmlpserver/"],
  FUAI: ["/api/fusion-ai/"],
  BOSS: ["/api/boss/"],
  SAASBATCH: ["/api/saas-batch/"],
  KM: ["/api/knowledge-management/", "/api/ci/"],
  SALESCOMMON: ["/api/sales-common/"],
};
const FORWARDED = ["content-type", "accept", "accept-language", "if-match", "rest-framework-version", "effective-of"];
const INSTANCES = [
  { name: "dev1", label: "Dev 1", connected: true, podUser: "test.user" },
  { name: "nouser", label: "No User", connected: true },
  { name: "stale", label: "Stale", connected: true, podUser: "test.user" },
  { name: "off", label: "Off", connected: false },
  { name: "noconf", label: "No Config", connected: true, podUser: "test.user", missing: ["FUAI token key"] },
];
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
  if (req.headers["x-gnimsys-pod-proxy"] !== "1") return proxyState(res, 403, "csrf-refused");
  if (url.pathname === "/api/pod/instances") return json(res, 200, { instances: INSTANCES });
  const m = /^\/api\/pod\/([^/]+)\/([^/]+)(\/.*)$/.exec(url.pathname);
  if (!m) return proxyState(res, 400, "bad-path");
  const [, name, target, podPath] = m;
  const instance = INSTANCES.find((i) => i.name === name);
  log.push({ method: req.method, instance: name, target, path: podPath + url.search, headers: { ...req.headers } });
  if (!instance) return proxyState(res, 403, "forbidden");
  const prefixes = TARGETS[target];
  if (!prefixes) return proxyState(res, 404, "unknown-target");
  if (!prefixes.some((p) => podPath.startsWith(p) && podPath.length > p.length)) return proxyState(res, 403, "path-not-allowed", { target, path: podPath });
  if (!instance.connected || name === "stale") return proxyState(res, 401, "auth-required", { instance: name });
  if (name === "noconf" && target === "FUAI") return proxyState(res, 424, "not-configured", { instance: name, target, missing: instance.missing });

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
