// The debug host's rest helper (spec §17.1): VB's RestHelper interface over the engine's same-origin pod proxy
//   ANY /api/pod/<instance>/<TARGET>/<pod-path>?<query>
// get(endpointId) starts a chain with VB's initConfiguration / requestTransformationFunctions / hookHandler /
// responseBodyFormat / fetch(), run in VB's rest.js order (as the dev mock runs it): pre-fetch hook, request transforms,
// `new Request(url, initConfig)`, request hook, network fetch, response hook, then the body of WHATEVER the response hook
// returned is read (the body format for an OK status, else as found, ignoring read errors), then the post-fetch (error)
// hook; it resolves VB's {response, body} for every HTTP status. So the chat streams through it exactly as through VB's
// own RestHelper, with the data pack's VB stream provider (xxx-gnimsys-data/rest/vb-stream-fetch); the helper has no
// streaming method of its own.
// The proxy holds the user's pod tokens and injects the bearer; this helper sends no credentials of its own (the gateway
// session cookie rides along as a same-origin request). It refuses, before anything is sent, what the proxy would refuse
// or silently drop: a URL outside the target's path prefixes and a request header the proxy does not forward.
// An answer of the proxy itself (header X-Gnimsys-Pod-Proxy-Error: <state>) gets a readable `detail` before the response
// hook sees it, so the chat shows it in its existing states: 401 auth-required -> the re-login banner with "Sign in to
// <instance> in the agent chat first."; every other proxy state -> the failing call's error text. A pod's own answer (no
// such header) is passed on untouched, its body unread.
// The endpoint table and pod-path rule are the component's own (one source): imported from the pack's source module by a
// relative path, since a release build ships the pack's internals only inside its bundle (no module file under the
// `xxx-gnimsys-ai` path).
import { ENDPOINT_NAMES, ENDPOINT_PREFIXES, podPath } from "../jet-composites/xxx-gnimsys-ai/chat/lib/endpoints/EndpointFetch";
import type { EndpointName } from "../jet-composites/xxx-gnimsys-ai/chat/lib/endpoints/EndpointFetch";

/** The engine's pod proxy, on the page's own origin. */
export const POD_PROXY_PATH = "/api/pod";
/** The proxy's CSRF guard: every proxy call carries it (else 403 csrf-refused). */
export const POD_PROXY_HEADER = "X-Gnimsys-Pod-Proxy";
/** Marks an answer of the proxy itself (its value is the state), as opposed to a pod answer passed through. */
export const POD_PROXY_ERROR_HEADER = "X-Gnimsys-Pod-Proxy-Error";
/** Instance names in the proxy URL (the proxy's own rule). */
const INSTANCE_NAME = /^[A-Za-z0-9._-]+$/;
/** The request headers the proxy forwards to the pod; it drops every other one. */
const FORWARDED = ["content-type", "accept", "accept-language", "if-match", "rest-framework-version", "effective-of"];
const forwarded = (name: string): boolean => FORWARDED.includes(name.toLowerCase()) || name.toLowerCase().startsWith("x-ora-ai-api-v2-");

/** The chat's endpoint map over the proxy: every contract name is its own endpoint id, the proxy's TARGET. */
export const POD_PROXY_ENDPOINTS: Readonly<Record<EndpointName, EndpointName>> = {
  FA: "FA", FUAI: "FUAI", BOSS: "BOSS", SAASBATCH: "SAASBATCH", KM: "KM", SALESCOMMON: "SALESCOMMON",
};

/** VB's request init as its callers set it (`url` is read by their transform, not by the request). */
export interface ProxyRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  url: string;
  signal?: AbortSignal;
}

/** What a request transformation function receives: `url` is the endpoint's URL, as in VB. */
export interface ProxyConfiguration {
  url: string;
  endpointDefinition: { url: string };
  initConfig: { method: string; headers: Record<string, string>; body?: BodyInit; signal?: AbortSignal };
}

export interface ProxyTransforms {
  body?: (configuration: ProxyConfiguration) => ProxyConfiguration;
}

export interface ProxyFetchResult {
  response: Response;
  body: unknown;
}

/** VB's RestHookHandler: every method is called once a handler is set. */
export interface ProxyHookHandler {
  handlePreFetchHook(rest: PodProxyRest): unknown;
  handleRequestHook(request: Request): Request | undefined;
  handleResponseHook(response: Response): Response | undefined;
  handlePostFetchHook(result: ProxyFetchResult): unknown;
  handlePostFetchErrorHook(result: ProxyFetchResult): unknown;
}

export type ProxyBodyFormat = "text" | "json" | "blob" | "arrayBuffer";

export interface PodProxyRestHelperOptions {
  /** The instance the user picked (its proxy name; never defaulted). */
  instance: string;
  /** The instance's label as the proxy lists it (the name the user knows it by). */
  label: string;
  /** The page's origin (the proxy is same-origin). */
  origin: string;
  /** Unit tests only; the page uses the global fetch. */
  fetchImpl?: (request: Request) => Promise<Response>;
}

const isEndpointName = (id: string): id is EndpointName => (ENDPOINT_NAMES as readonly string[]).includes(id);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isJson = (contentType: string | null): boolean => /[/+]json\b/.test(contentType ?? "");

/** Reads the body like VB: the requested format, else JSON by content type, else text; an empty body is "". */
async function readBody(response: Response, format: ProxyBodyFormat | undefined): Promise<unknown> {
  if (format !== undefined) return response[format]();
  const text = await response.text();
  if (text === "" || !isJson(response.headers.get("content-type"))) return text;
  return JSON.parse(text);
}

/** A non-empty string field of a JSON object, when it has one. */
function str(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/**
 * The readable text of a proxy state (spec §17.1 engine contract): what happened to this call on this instance, and,
 * where the user can act, what to do. The proxy's own `message` follows when it says more.
 */
export function proxyStateText(state: string, call: { label: string; target: EndpointName; path: string }, body: Record<string, unknown>): string {
  const message = str(body, "message");
  const plus = (text: string): string => (message !== undefined ? `${text}: ${message}` : `${text}.`);
  const { label, target, path } = call;
  switch (state) {
    case "auth-required":
      return `Sign in to ${label} in the agent chat first.`;
    case "not-authenticated":
      return "Your agent session has ended: reload the page to sign in again.";
    case "ambiguous-sign-in":
      return plus(`You hold several sign-ins for ${label}: keep one in the agent chat`);
    case "token-refresh-failed":
      return plus(`The sign-in for ${label} could not be refreshed: sign in again in the agent chat`);
    case "forbidden":
      return plus(`You have no access to instance ${label}`);
    case "not-configured": {
      const missing = Array.isArray(body.missing) ? body.missing.filter((m): m is string => typeof m === "string") : [];
      return plus(`Instance ${label} is not configured for ${target} calls${missing.length > 0 ? ` (missing ${missing.join(", ")})` : ""}`);
    }
    case "pod-unreachable":
      return plus(`The pod of ${label} is unreachable`);
    case "pod-timeout":
      return plus(`The pod of ${label} did not answer in time`);
    case "pod-redirect":
      return plus(`The pod of ${label} answered ${target} ${path} with a redirect${typeof body.status === "number" ? ` (HTTP ${body.status})` : ""}`);
    default: // csrf-refused, bad-path, unknown-target, path-not-allowed, too-large, and any state added later
      return plus(`The pod proxy refused ${target} ${path} (${state})`);
  }
}

/** One request chain, like VB's `Rest` instance. */
export class PodProxyRest {
  private readonly helper: PodProxyRestHelper;
  private readonly endpointId: string;
  private init: ProxyRequestInit | undefined;
  private transforms: ProxyTransforms = {};
  private handler: ProxyHookHandler | undefined;
  private format: ProxyBodyFormat | undefined;

  constructor(helper: PodProxyRestHelper, endpointId: string) {
    this.helper = helper;
    this.endpointId = endpointId;
  }

  initConfiguration(init: ProxyRequestInit): PodProxyRest {
    this.init = init;
    return this;
  }

  requestTransformationFunctions(transforms: ProxyTransforms): PodProxyRest {
    if (transforms) this.transforms = transforms;
    return this;
  }

  hookHandler(handler: ProxyHookHandler): PodProxyRest {
    this.handler = handler;
    return this;
  }

  responseBodyFormat(format: ProxyBodyFormat): PodProxyRest {
    this.format = format;
    return this;
  }

  async fetch(): Promise<ProxyFetchResult> {
    const target = this.helper.targetOf(this.endpointId);
    if (this.init === undefined) throw new Error("pod proxy rest helper: fetch() before initConfiguration()");
    const h = this.handler;
    if (h) await (h.handlePreFetchHook(this) || Promise.resolve());
    const { method, headers, body, signal } = this.init;
    const base = this.helper.baseUrl(target);
    const initConfig = { method, headers: { ...headers }, ...(body !== undefined && { body }), ...(signal !== undefined && { signal }) };
    let configuration: ProxyConfiguration = { url: base, endpointDefinition: { url: base }, initConfig };
    if (this.transforms.body) configuration = this.transforms.body(configuration);
    const { request: built, path } = this.helper.request(target, configuration.url, configuration.initConfig);
    const request = (h && h.handleRequestHook(built)) || built;
    const native = await this.helper.network(request, target, path);
    const response = (h && h.handleResponseHook(native)) || native;
    const ok = response.ok;
    const read = method === "HEAD" ? Promise.resolve("")
      : ok ? readBody(response, this.format) // an OK response with an unreadable body fails the call, as in VB
        : readBody(response, undefined).catch(() => null); // VB reads an error body "ignoring errors"
    const result: ProxyFetchResult = { response, body: await read };
    if (h) {
      if (ok) await h.handlePostFetchHook({ ...result });
      else await h.handlePostFetchErrorHook(result);
    }
    return result;
  }
}

/** Pass an instance as the chat's `rest-helper`, with POD_PROXY_ENDPOINTS as its `endpoint`. */
export class PodProxyRestHelper {
  readonly instance: string;
  readonly label: string;
  private readonly origin: string;
  private readonly fetchImpl: (request: Request) => Promise<Response>;

  constructor(options: PodProxyRestHelperOptions) {
    const { instance, label, origin } = options;
    if (typeof instance !== "string" || !INSTANCE_NAME.test(instance) || instance === "." || instance === "..") {
      throw new Error(`pod proxy rest helper: instance must be a proxy instance name ([A-Za-z0-9._-]), got ${JSON.stringify(instance)}`);
    }
    if (typeof label !== "string" || label.trim() === "") throw new Error("pod proxy rest helper: instance label required");
    if (typeof origin !== "string" || !/^https?:\/\/[^/]+$/.test(origin)) throw new Error("pod proxy rest helper: origin required (scheme://host[:port])");
    this.instance = instance;
    this.label = label;
    this.origin = origin;
    this.fetchImpl = options.fetchImpl ?? ((request) => globalThis.fetch(request));
  }

  /** The proxy TARGET an endpoint id names (the ids are the contract names); any other id is refused. */
  targetOf(endpointId: string): EndpointName {
    if (!isEndpointName(endpointId)) throw new Error(`pod proxy rest helper: unknown endpoint ${endpointId} (${ENDPOINT_NAMES.join(", ")})`);
    return endpointId;
  }

  /** The proxy URL of a TARGET on this instance (no trailing slash): the chain's endpoint URL. */
  baseUrl(target: EndpointName): string {
    return `${this.origin}${POD_PROXY_PATH}/${this.instance}/${target}`;
  }

  get(endpointId: string): PodProxyRest {
    return new PodProxyRest(this, endpointId);
  }

  /**
   * The proxy request of one call: refused before anything is sent (as the endpoint layer and the proxy do) when the URL
   * is not this instance's proxy URL of `target` followed by a pod path under one of the target's prefixes, or a header
   * would not be forwarded. Carries the proxy's CSRF header; same-origin credentials only.
   */
  request(target: EndpointName, url: string, init: ProxyConfiguration["initConfig"]): { request: Request; path: string } {
    const path = this.podPathOf(target, url);
    const dropped = Object.keys(init.headers ?? {}).filter((h) => !forwarded(h));
    if (dropped.length > 0) {
      throw new Error(`pod proxy rest helper: ${target} ${path}: the pod proxy does not forward ${dropped.join(", ")} (it forwards ${FORWARDED.join(", ")}, x-ora-ai-api-v2-*)`);
    }
    const request = new Request(url, {
      method: init.method,
      headers: { ...init.headers, [POD_PROXY_HEADER]: "1" },
      credentials: "same-origin",
      ...(init.body !== undefined && { body: init.body }),
      ...(init.signal !== undefined && { signal: init.signal }),
    });
    return { request, path };
  }

  /** The network call; a proxy state is explained before anyone (the response hook included) sees the answer. */
  async network(request: Request, target: EndpointName, path: string): Promise<Response> {
    return this.explained(await this.fetchImpl(request), target, path);
  }

  /** The pod path of a proxy URL of `target`, when it is one and the path is under the target's prefixes; else throws. */
  private podPathOf(target: EndpointName, url: string): string {
    const refuse = (why: string): never => { throw new Error(`pod proxy rest helper: ${target} refuses ${url}: ${why}`); };
    const base = this.baseUrl(target) + "/";
    if (!url.startsWith(base)) refuse(`not a ${this.instance} ${target} proxy URL`);
    const path = podPath("/" + url.slice(base.length));
    const prefixes = ENDPOINT_PREFIXES[target];
    if (path === null || !prefixes.some((p) => path.startsWith(p) && path.length > p.length)) {
      refuse(`the path is not under ${prefixes.join(" or ")}`);
    }
    return path as string;
  }

  /** A proxy state (X-Gnimsys-Pod-Proxy-Error) gets a readable `detail` in a JSON body; every other answer is untouched. */
  private async explained(response: Response, target: EndpointName, path: string): Promise<Response> {
    const state = response.headers.get(POD_PROXY_ERROR_HEADER);
    if (state === null) return response;
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await response.text());
      if (isObj(parsed)) body = parsed;
    } catch {
      // the state header alone says what happened
    }
    const detail = proxyStateText(state, { label: this.label, target, path }, body);
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("Content-Length"); // the body is rewritten
    return new Response(JSON.stringify({ ...body, state, detail }), { status: response.status, statusText: response.statusText, headers });
  }
}

/** One instance of the user's, as the proxy lists it. */
export interface PodInstance {
  name: string;
  label: string;
  connected: boolean;
  /** The pod user of the instance's sign-in, when the proxy knows it. */
  podUser?: string;
  /** Every pod user the user is signed in as on this instance (several = calls answer ambiguous-sign-in). */
  podUsers?: string[];
  /** Configuration gaps of the instance (its calls answer not-configured where they matter). */
  missing?: string[];
}

/** A failed instance listing: the HTTP status (0 without an HTTP answer) and the readable reason. */
export class PodInstancesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PodInstancesError";
    this.status = status;
  }
}

const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

/** `GET /api/pod/instances` -> `{instances: [...]}`: the user's instances, their connection state, pod user and gaps. */
export async function listPodInstances(options: { origin: string; fetchImpl?: (request: Request) => Promise<Response> }): Promise<PodInstance[]> {
  const fetchImpl = options.fetchImpl ?? ((request) => globalThis.fetch(request));
  let response: Response;
  try {
    response = await fetchImpl(new Request(`${options.origin}${POD_PROXY_PATH}/instances`, {
      method: "GET", headers: { Accept: "application/json", [POD_PROXY_HEADER]: "1" }, credentials: "same-origin",
    }));
  } catch (e) {
    throw new PodInstancesError(0, `instances unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (response.status >= 400) {
    const state = response.headers.get(POD_PROXY_ERROR_HEADER);
    const message = isObj(json) ? str(json, "message") : undefined;
    const said = message ?? (text.trim() !== "" ? text.trim().slice(0, 300) : undefined);
    throw new PodInstancesError(response.status, `instances unavailable (HTTP ${response.status}${state !== null ? ` ${state}` : ""})${said !== undefined ? `: ${said}` : ""}`);
  }
  const bad = (): never => { throw new PodInstancesError(response.status, "instances unavailable: unexpected answer shape"); };
  if (json === undefined) throw new PodInstancesError(response.status, "instances unavailable: the answer is not JSON");
  if (!isObj(json) || !Array.isArray(json.instances)) return bad();
  return (json.instances as unknown[]).map((it): PodInstance => {
    if (!isObj(it)) return bad();
    const { name, label, connected, podUser, podUsers, missing } = it;
    if (typeof name !== "string" || !INSTANCE_NAME.test(name) || typeof label !== "string" || label === "" || typeof connected !== "boolean") return bad();
    if (podUser !== undefined && podUser !== null && typeof podUser !== "string") return bad();
    if (podUsers !== undefined && podUsers !== null && strList(podUsers) === null) return bad();
    if (missing !== undefined && missing !== null && strList(missing) === null) return bad();
    return {
      name, label, connected,
      ...(typeof podUser === "string" && podUser !== "" && { podUser }),
      ...(Array.isArray(podUsers) && podUsers.length > 0 && { podUsers: podUsers as string[] }),
      ...(Array.isArray(missing) && missing.length > 0 && { missing: missing as string[] }),
    };
  });
}
