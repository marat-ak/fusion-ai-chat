import type { DashboardRestHelper, Endpoint, VbFetchResult } from "xxx-gnimsys-data/rest/index";

/** The contract endpoint names (spec §4a). The page maps each to a VB service connection endpoint id. */
export type EndpointName = "FA" | "FUAI" | "BOSS" | "SAASBATCH" | "KM" | "SALESCOMMON";
export const ENDPOINT_NAMES: readonly EndpointName[] = ["FA", "FUAI", "BOSS", "SAASBATCH", "KM", "SALESCOMMON"];

/** The pod paths each endpoint may be called with (spec §4a; FA also serves BIP, `/xmlpserver/`). */
export const ENDPOINT_PREFIXES: Record<EndpointName, string[]> = {
  FA: ["/fscmRestApi/", "/hcmRestApi/", "/crmRestApi/", "/applcoreApi/v1/", "/xmlpserver/"],
  FUAI: ["/api/fusion-ai/"],
  BOSS: ["/api/boss/"],
  SAASBATCH: ["/api/saas-batch/"],
  KM: ["/api/knowledge-management/", "/api/ci/"],
  SALESCOMMON: ["/api/sales-common/"],
};

export type EndpointMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface EndpointInit { method?: EndpointMethod; headers?: Record<string, string>; body?: string | FormData }
/** A request through an endpoint: status, the body VB has read (parsed JSON or text), the response headers. */
export interface EndpointResponse { status: number; body: unknown; headers: Headers }

/** The optional streaming capability: an unconsumed `Response` for one request (`url` is a pod path, as for request()). */
export interface StreamInit { method: EndpointMethod; headers: Record<string, string>; body?: string; signal?: AbortSignal }
export type StreamFetch = (target: EndpointName, url: string, init: StreamInit) => Promise<Response>;

/**
 * The rest helper's streaming capability, when it has one: `streamFetch(endpointId, {url, method, headers, body?, signal?})`
 * resolves the native Response, unconsumed, for every HTTP status; the helper resolves `url` against the endpoint and owns
 * its auth. VB's RestHelper has no such method (see the endpoint-slice report, Task 4); the dev/e2e mock has it.
 */
export interface StreamingRestHelper {
  streamFetch(endpointId: string, request: { url: string } & StreamInit): Promise<Response>;
}

/**
 * refused: the URL is not a pod path under one of the target's prefixes, or the target is not in the endpoint map (nothing
 * was sent); http: an HTTP status >= 400 or an `o:errorCode` body; network: no HTTP answer; stream-unavailable: the rest
 * helper cannot stream (nothing was sent).
 */
export type EndpointErrorKind = "refused" | "http" | "network" | "stream-unavailable";

export class EndpointError extends Error {
  readonly kind: EndpointErrorKind;
  readonly target: EndpointName;
  readonly url: string;
  /** HTTP status; 0 without an HTTP answer. */
  readonly status: number;
  /** The error body as the endpoint read it (parsed JSON or text). */
  readonly body: unknown;
  readonly statusText?: string;
  constructor(kind: EndpointErrorKind, target: EndpointName, url: string, message: string, status = 0, body?: unknown, statusText?: string) {
    super(message);
    this.name = "EndpointError";
    this.kind = kind;
    this.target = target;
    this.url = url;
    this.status = status;
    this.body = body;
    if (statusText !== undefined) this.statusText = statusText;
  }
}

/** An error body as text (JSON bodies serialized, so errorText() can read their detail/title/message). */
export function endpointBodyText(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
}

/** A response body that must be a JSON object; null when it is not (text, an array, nothing). */
export function objectBody(res: EndpointResponse): Record<string, unknown> | null {
  const b = res.body;
  return typeof b === "object" && b !== null && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

/** The streaming capability of a page-provided rest helper, bound to the endpoint map; undefined when it has none. */
export function streamFetchOf(restHelper: unknown, endpoints: Record<string, string>): StreamFetch | undefined {
  const fn = (restHelper as Partial<StreamingRestHelper> | null | undefined)?.streamFetch;
  if (typeof fn !== "function") return undefined;
  return (target, url, init) => fn.call(restHelper, endpoints[target] as string, { url, ...init });
}

/** The pod path of a URL when it is pod-relative and normalises to itself (no "..", ".", backslash or "//" tricks). */
function podPath(url: string): string | null {
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return null;
  const raw = url.split(/[?#]/)[0];
  let normalised: string;
  try {
    normalised = new URL(url, "https://pod.invalid").pathname;
  } catch {
    return null;
  }
  return normalised === raw ? raw : null;
}

/** HTTP status / body of a DashboardRestHelper rejection (an Error carrying them), else null (no HTTP answer). */
function httpOf(e: unknown): { status: number; body: unknown; statusText?: string } | null {
  const x = e as { status?: unknown; body?: unknown; response?: { statusText?: unknown } | null } | null;
  if (typeof x?.status !== "number") return null;
  const st = x.response?.statusText;
  return { status: x.status, body: x.body, ...(typeof st === "string" && { statusText: st }) };
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The Endpoint call of a method. Bodies go as `rawBody` (sent as given: JSON text with the caller's Content-Type, or
 * FormData with the browser's multipart boundary); GET/DELETE get no options, so no query keys are appended. */
function send(ep: Endpoint, method: EndpointMethod, body: string | FormData | undefined): Promise<VbFetchResult> {
  switch (method) {
    case "GET": return ep.fetch({});
    case "DELETE": return ep.delete({});
    case "POST": return ep.create(undefined, { rawBody: body });
    case "PUT": return ep.update(undefined, { rawBody: body });
    case "PATCH": return ep.patch(undefined, { rawBody: body });
  }
}

/**
 * Every pod call of the chat: through the page's endpoints (DashboardRestHelper over the VB RestHelper and the endpoint
 * map), which own the request and its token. A URL is a pod path checked against its target's prefixes before anything
 * is sent; failures are EndpointErrors.
 */
export class EndpointFetch {
  private readonly helper: DashboardRestHelper;
  private readonly streamFetch: StreamFetch | undefined;

  constructor(deps: { helper: DashboardRestHelper; stream?: StreamFetch }) {
    this.helper = deps.helper;
    this.streamFetch = deps.stream;
  }

  /** Whether stream() can work (the rest helper has the streaming capability). */
  get canStream(): boolean {
    return this.streamFetch !== undefined;
  }

  private check(target: EndpointName, url: string): void {
    const refuse = (why: string): never => { throw new EndpointError("refused", target, url, `endpoint ${target} refuses ${url}: ${why}`); };
    const prefixes = ENDPOINT_PREFIXES[target];
    const path = podPath(url);
    if (path === null || !prefixes.some((p) => path.startsWith(p) && path.length > p.length)) {
      refuse(`the path is not under ${prefixes.join(" or ")}`);
    }
    if (!this.helper.getMetadata().endpoints.includes(target)) refuse(`${target} is not in the endpoint map`);
  }

  async request(target: EndpointName, url: string, init: EndpointInit = {}): Promise<EndpointResponse> {
    this.check(target, url);
    const method = init.method ?? "GET";
    const where = `${target} ${method} ${url}`;
    let result: VbFetchResult;
    try {
      const ep: Endpoint = this.helper.createEndpoint({ target, url, headers: { ...(init.headers ?? {}) } });
      result = await send(ep, method, init.body);
    } catch (e) {
      const http = httpOf(e);
      if (http) throw new EndpointError("http", target, url, `${where}: HTTP ${http.status}`, http.status, http.body, http.statusText);
      throw new EndpointError("network", target, url, `${where}: ${messageOf(e)}`);
    }
    if (!result?.response) throw new EndpointError("network", target, url, `${where}: the rest helper returned no response`);
    return { status: result.response.status, body: result.body, headers: result.response.headers };
  }

  /** The unconsumed streaming Response of one request; HTTP >= 400 is an EndpointError carrying the error body as text. */
  async stream(target: EndpointName, url: string, init: StreamInit): Promise<Response> {
    this.check(target, url);
    const where = `${target} ${init.method} ${url}`;
    if (this.streamFetch === undefined) {
      throw new EndpointError("stream-unavailable", target, url, `streaming not available through endpoint ${target}`);
    }
    let res: Response;
    try {
      res = await this.streamFetch(target, url, init);
    } catch (e) {
      throw new EndpointError("network", target, url, `${where}: ${messageOf(e)}`);
    }
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new EndpointError("http", target, url, `${where}: HTTP ${res.status}`, res.status, text, res.statusText);
    }
    return res;
  }
}
