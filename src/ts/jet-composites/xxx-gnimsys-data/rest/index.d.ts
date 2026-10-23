// Typings of the endpoint layer: dashboard-rest-helper.js, moved from the dashboard pack as is (AMD JavaScript).
// They describe what the JavaScript does today; see __tests__/dashboardRestHelper.characterisation.test.ts.

/** A VB RestHelper (`vb/helpers/rest`) as DashboardRestHelper drives it, or a dev/e2e mock with the same interface. */
export interface VbRestHelper {
  get(endpointId: string): VbRest;
}

/** One VB request chain (`Rest.get(endpointId)`). */
export interface VbRest {
  initConfiguration(init: VbRequestInit): VbRest;
  requestTransformationFunctions(fns: { body?: (configuration: VbRequestConfiguration) => VbRequestConfiguration }): VbRest;
  /** Resolves for every HTTP status; the body is already read. */
  fetch(): Promise<VbFetchResult>;
}

/** The request init DashboardRestHelper hands to `initConfiguration` (url relative to the endpoint, or absolute). */
export interface VbRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  url: string;
}

/** What VB passes to a request transformation function: `url` is the endpoint's full URL. */
export interface VbRequestConfiguration {
  url: string;
  endpointDefinition: { url: string };
  [key: string]: unknown;
}

/** VB's fetch result: the native response and its body, already read (parsed JSON or text). */
export interface VbFetchResult {
  response: Response;
  body: unknown;
  [key: string]: unknown;
}

/** createEndpoint input: `target` is a key of the endpoint map; `url` may hold `{{key}}` templates filled from the call options. */
export interface EndpointConfig {
  target: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * Call options. On GET/DELETE only offset, limit, q, fields, totalResults, orderBy (and fetchSize -> limit,
 * startIndex -> offset) become query parameters; every key also fills the url's `{{key}}` templates.
 * `rawBody` (POST/PUT/PATCH) is sent as given, without a Content-Type.
 */
export interface EndpointRequestOptions {
  offset?: number;
  limit?: number;
  q?: string;
  fields?: string;
  totalResults?: boolean;
  orderBy?: string;
  fetchSize?: number;
  startIndex?: number;
  rawBody?: BodyInit;
  [templateKey: string]: unknown;
}

/** One configured endpoint. Every call rejects with EndpointRequestError on HTTP >= 400 or an `o:errorCode` body. */
export interface Endpoint {
  fetch(options?: EndpointRequestOptions): Promise<VbFetchResult>;
  /** POST; `data` is sent as JSON (Content-Type application/json unless a header sets it). */
  create(data: unknown, options?: EndpointRequestOptions): Promise<VbFetchResult>;
  /** PUT */
  update(data: unknown, options?: EndpointRequestOptions): Promise<VbFetchResult>;
  patch(data: unknown, options?: EndpointRequestOptions): Promise<VbFetchResult>;
  delete(options?: EndpointRequestOptions): Promise<VbFetchResult>;
}

/** The rejection of an Endpoint call that got an HTTP answer. */
export interface EndpointRequestError extends Error {
  status: number;
  body: unknown;
  response: Response | null;
}

export declare class DashboardRestHelper {
  /** `endpoints`: endpoint name (target) -> VB endpoint id (service connection). */
  constructor(restHelper: VbRestHelper, endpoints?: Record<string, string>);
  /** Throws when `target` or `url` is missing or `target` is not in the endpoint map. */
  createEndpoint(config: EndpointConfig): Endpoint;
  getMetadata(): { hasRestHelper: boolean; endpoints: string[]; endpointMapping: Record<string, string> };
}
