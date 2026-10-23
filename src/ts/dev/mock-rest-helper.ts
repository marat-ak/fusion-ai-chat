// Dev host page and e2e only (never packaged): a stand-in for VB's RestHelper (`vb/helpers/rest`), modelled on the
// dashboard's web/js/dev-rest-helper.js and on VB's rest.js fetch(). get(endpointId) starts a chain with VB's
// initConfiguration / requestTransformationFunctions / hookHandler / responseBodyFormat / fetch(); fetch() runs, in VB's
// order, the pre-fetch hook, the request transforms, `new Request(url, initConfig)`, the request hook, the network fetch,
// the response hook, then reads the body of WHATEVER the response hook returned (the body format for an OK status, else
// as found, ignoring read errors) and runs the post-fetch (error) hook; it resolves VB's {response, body} for every HTTP
// status. The request goes to the base URL configured for the service connection, authorized with
// DEV_MOCK_AUTHORIZATION (the mock pod accepts any bearer). On a pod the page passes VB's own RestHelper instead; the
// chat streams through either with the data pack's VB stream provider (xxx-gnimsys-data/rest/vb-stream-fetch).

/** The mock's only credential: the mock pod accepts any bearer. */
export const DEV_MOCK_AUTHORIZATION = "Bearer dev-mock";

/** The host page's endpoint map: the six contract names -> the mock's service connection ids. */
export const MOCK_ENDPOINTS = {
  FA: "mockFA",
  FUAI: "mockFUAI",
  BOSS: "mockBOSS",
  SAASBATCH: "mockSAASBATCH",
  KM: "mockKM",
  SALESCOMMON: "mockSALESCOMMON",
} as const;

/** VB's request init as its callers set it (`url` is read by their transform, not by the request). */
export interface MockRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  url: string;
  signal?: AbortSignal;
}

/** What a request transformation function receives: `url` is the endpoint's URL, as in VB. */
export interface MockConfiguration {
  url: string;
  endpointDefinition: { url: string };
  initConfig: { method: string; headers: Record<string, string>; body?: BodyInit; signal?: AbortSignal };
}

export interface MockTransforms {
  body?: (configuration: MockConfiguration) => MockConfiguration;
}

/** VB's RestHookHandler: every method is called once a handler is set. */
export interface MockHookHandler {
  handlePreFetchHook(rest: MockRest): unknown;
  handleRequestHook(request: Request): Request | undefined;
  handleResponseHook(response: Response): Response | undefined;
  handlePostFetchHook(result: MockFetchResult): unknown;
  handlePostFetchErrorHook(result: MockFetchResult): unknown;
}

export type MockBodyFormat = "text" | "json" | "blob" | "arrayBuffer";

export interface MockFetchResult {
  response: Response;
  body: unknown;
}

export interface MockRestHelperOptions {
  /** Service connection id -> its absolute base URL. Any other id is unknown: its fetch() rejects. */
  serviceConnections: Record<string, string>;
  /** The network fetch (unit tests, or a dev page that reshapes answers); the global fetch by default. */
  fetchImpl?: (request: Request) => Promise<Response>;
}

const isJson = (contentType: string | null): boolean => /[/+]json\b/.test(contentType ?? "");

/** Reads the body like VB: the requested format, else JSON by content type, else text; an empty body is "". */
async function readBody(response: Response, format: MockBodyFormat | undefined): Promise<unknown> {
  if (format !== undefined) return response[format]();
  const text = await response.text();
  if (text === "" || !isJson(response.headers.get("content-type"))) return text;
  return JSON.parse(text);
}

/** One request chain, like VB's `Rest` instance. */
export class MockRest {
  private readonly endpointId: string;
  private readonly base: string | undefined;
  private readonly fetchImpl: (request: Request) => Promise<Response>;
  private init: MockRequestInit | undefined;
  private transforms: MockTransforms = {};
  private handler: MockHookHandler | undefined;
  private format: MockBodyFormat | undefined;

  constructor(endpointId: string, base: string | undefined, fetchImpl: (request: Request) => Promise<Response>) {
    this.endpointId = endpointId;
    this.base = base;
    this.fetchImpl = fetchImpl;
  }

  initConfiguration(init: MockRequestInit): MockRest {
    this.init = init;
    return this;
  }

  requestTransformationFunctions(transforms: MockTransforms): MockRest {
    if (transforms) this.transforms = transforms;
    return this;
  }

  hookHandler(handler: MockHookHandler): MockRest {
    this.handler = handler;
    return this;
  }

  responseBodyFormat(format: MockBodyFormat): MockRest {
    this.format = format;
    return this;
  }

  async fetch(): Promise<MockFetchResult> {
    if (this.base === undefined) throw new Error(`mock rest helper: unknown service connection ${this.endpointId}`);
    if (this.init === undefined) throw new Error("mock rest helper: fetch() before initConfiguration()");
    const h = this.handler;
    if (h) await (h.handlePreFetchHook(this) || Promise.resolve());
    const { method, headers, body, signal } = this.init;
    const initConfig = {
      method,
      headers: { ...headers, Authorization: DEV_MOCK_AUTHORIZATION },
      ...(body !== undefined && { body }),
      ...(signal !== undefined && { signal }),
    };
    let configuration: MockConfiguration = { url: this.base, endpointDefinition: { url: this.base }, initConfig };
    if (this.transforms.body) configuration = this.transforms.body(configuration);
    let request = new Request(configuration.url, configuration.initConfig);
    if (h) request = h.handleRequestHook(request) || request;
    const native = await this.fetchImpl(request);
    const response = (h && h.handleResponseHook(native)) || native;
    const ok = response.ok;
    const read = method === "HEAD" ? Promise.resolve("")
      : ok ? readBody(response, this.format) // an OK response with an unreadable body fails the call, as in VB
        : readBody(response, undefined).catch(() => null); // VB reads an error body "ignoring errors"
    const result: MockFetchResult = { response, body: await read };
    if (h) {
      if (ok) await h.handlePostFetchHook({ ...result });
      else await h.handlePostFetchErrorHook(result);
    }
    return result;
  }
}

/** The VB RestHelper stand-in: pass an instance as the chat's `rest-helper`. */
export class MockRestHelper {
  private readonly connections: Record<string, string>;
  private readonly fetchImpl: (request: Request) => Promise<Response>;

  constructor(options: MockRestHelperOptions) {
    this.connections = { ...options.serviceConnections };
    this.fetchImpl = options.fetchImpl ?? ((request) => globalThis.fetch(request));
  }

  get(endpointId: string): MockRest {
    const known = Object.prototype.hasOwnProperty.call(this.connections, endpointId);
    return new MockRest(endpointId, known ? this.connections[endpointId] : undefined, this.fetchImpl);
  }
}
