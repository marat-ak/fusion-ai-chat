// Dev host page and e2e only (never packaged): a stand-in for VB's RestHelper (`vb/helpers/rest`), modelled on the
// dashboard's web/js/dev-rest-helper.js. get(endpointId) starts a chain with VB's initConfiguration /
// requestTransformationFunctions / fetch(); fetch() resolves VB's {response, body} for every HTTP status, the body
// already read. The request is a plain fetch to the base URL configured for the service connection, authorized with
// DEV_MOCK_AUTHORIZATION (the mock pod accepts any bearer). On a pod the page passes VB's own RestHelper instead.
// Beyond VB's interface the mock has streamFetch(), the chat's optional streaming capability.

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

/** VB's request init as DashboardRestHelper sets it (`url` is read by its transform, not by the request). */
export interface MockRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  url: string;
}

/** What a request transformation function receives: `url` is the endpoint's URL, as in VB. */
export interface MockConfiguration {
  url: string;
  endpointDefinition: { url: string };
  initConfig: { method: string; headers: Record<string, string>; body?: BodyInit };
}

export interface MockTransforms {
  body?: (configuration: MockConfiguration) => MockConfiguration;
}

export interface MockFetchResult {
  response: Response;
  body: unknown;
}

export interface MockRestHelperOptions {
  /** Service connection id -> its absolute base URL. Any other id is unknown: its fetch() rejects. */
  serviceConnections: Record<string, string>;
  /** Unit tests only; the page uses the global fetch. */
  fetchImpl?: typeof fetch;
}

const isJson = (contentType: string | null): boolean => /[/+]json\b/.test(contentType ?? "");

/** Reads the body like VB: JSON by content type, else text; an empty body is "". */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "" || !isJson(response.headers.get("content-type"))) return text;
  if (response.ok) return JSON.parse(text); // an OK response with broken JSON fails the call, as in VB
  try {
    return JSON.parse(text);
  } catch {
    return null; // VB reads an error body "ignoring errors"
  }
}

/** One request chain, like VB's `Rest` instance. */
export class MockRest {
  private readonly endpointId: string;
  private readonly base: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private init: MockRequestInit | undefined;
  private transforms: MockTransforms = {};

  constructor(endpointId: string, base: string | undefined, fetchImpl: typeof fetch) {
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

  async fetch(): Promise<MockFetchResult> {
    if (this.base === undefined) throw new Error(`mock rest helper: unknown service connection ${this.endpointId}`);
    if (this.init === undefined) throw new Error("mock rest helper: fetch() before initConfiguration()");
    const { method, headers, body } = this.init;
    const initConfig = { method, headers: { ...headers, Authorization: DEV_MOCK_AUTHORIZATION }, ...(body !== undefined && { body }) };
    let configuration: MockConfiguration = { url: this.base, endpointDefinition: { url: this.base }, initConfig };
    if (this.transforms.body) configuration = this.transforms.body(configuration);
    const response = await this.fetchImpl(configuration.url, configuration.initConfig);
    return { response, body: await readBody(response) };
  }
}

/** The VB RestHelper stand-in: pass an instance as the chat's `rest-helper`. */
export class MockRestHelper {
  private readonly connections: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MockRestHelperOptions) {
    this.connections = { ...options.serviceConnections };
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  private base(endpointId: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(this.connections, endpointId) ? this.connections[endpointId] : undefined;
  }

  get(endpointId: string): MockRest {
    return new MockRest(endpointId, this.base(endpointId), this.fetchImpl);
  }

  /**
   * The chat's optional streaming capability (StreamingRestHelper in chat/lib/endpoints/EndpointFetch.ts): the native
   * Response, unconsumed, for every status. `url` resolves against the service connection exactly as DashboardRestHelper's
   * transform does (absolute replaces, relative is appended). VB's RestHelper has no such method.
   */
  async streamFetch(endpointId: string, request: MockStreamRequest): Promise<Response> {
    const base = this.base(endpointId);
    if (base === undefined) throw new Error(`mock rest helper: unknown service connection ${endpointId}`);
    const { url, method, headers, body, signal } = request;
    const target = /^https?:\/\//.test(url) ? url : base.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
    return this.fetchImpl(target, {
      method,
      headers: { ...headers, Authorization: DEV_MOCK_AUTHORIZATION },
      ...(body !== undefined && { body }),
      ...(signal !== undefined && { signal }),
    });
  }
}

export interface MockStreamRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
