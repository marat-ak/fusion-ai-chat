// Typings of vb-stream-fetch.js (AMD): the VB stream provider of the endpoint layer.

/** One streamed request: `url` resolves against the endpoint as in DashboardRestHelper. */
export interface VbStreamRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Resolves the native Response, unconsumed, for every HTTP status; rejects when there is no HTTP answer or on abort. */
export type VbStreamFetch = (endpointId: string, request: VbStreamRequest) => Promise<Response>;

/** Builds the provider over a VB RestHelper (`vb/helpers/rest`) or a helper with the same chain. */
export declare function createVbStreamFetch(restHelper: unknown): VbStreamFetch;

/** Whether the helper's request chains have hookHandler and responseBodyFormat (probes `restHelper.get(endpointId)`). */
export declare function supportsVbStreamFetch(restHelper: unknown, endpointId: string): boolean;
