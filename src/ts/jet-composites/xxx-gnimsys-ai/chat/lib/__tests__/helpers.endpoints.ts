// Test helpers (not a test file): the chat's services over the REAL endpoint layer (DashboardRestHelper from
// xxx-gnimsys-data, loaded from source) and a fake VB RestHelper that records each request and answers VB's
// {response, body}. Assertions read the recorded VB requests: target (via the endpoint id), method, url, headers, body.
import { loadAmd } from "../../../../xxx-gnimsys-data/rest/__tests__/amd";
import type { DashboardRestHelper } from "xxx-gnimsys-data/rest/index";
import { EndpointFetch } from "../endpoints/EndpointFetch";
import type { EndpointName, StreamFetch } from "../endpoints/EndpointFetch";

export const TEST_ENDPOINTS: Record<EndpointName, string> = {
  FA: "scFA", FUAI: "scFUAI", BOSS: "scBOSS", SAASBATCH: "scSAASBATCH", KM: "scKM", SALESCOMMON: "scSALESCOMMON",
};
const BASE = "https://pod.example.com";

export type VbCall = { target: EndpointName; method: string; url: string; headers: Record<string, string>; body?: unknown };
export type VbAnswer = { response: Response; body: unknown } | Error;

/** VB's fetch result: a response with status/statusText/headers and the already-read body. */
export function vb(body: unknown, status = 200, headers: Record<string, string> = {}): VbAnswer {
  const response = { status, statusText: status < 400 ? "OK" : "Error", ok: status >= 200 && status < 300, headers: new Headers(headers) };
  return { response: response as unknown as Response, body };
}

const targetOf = (id: string): EndpointName => {
  const hit = (Object.keys(TEST_ENDPOINTS) as EndpointName[]).find((k) => TEST_ENDPOINTS[k] === id);
  if (!hit) throw new Error("unknown endpoint id " + id);
  return hit;
};

type Drh = new (rh: unknown, endpoints: Record<string, string>) => DashboardRestHelper;
const DashboardRestHelperClass = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as Drh;

/** A fake VB RestHelper answering in order; an Error answer makes VB's fetch reject (no HTTP answer). */
export function fakeVbHelper(answers: VbAnswer[]): { helper: { get(id: string): unknown }; calls: VbCall[] } {
  const calls: VbCall[] = [];
  const queue = [...answers];
  const helper = {
    get(id: string) {
      let init: { method: string; headers: Record<string, string>; body?: unknown; url: string } | undefined;
      let transform: ((c: { url: string; endpointDefinition: { url: string } }) => { url: string }) | undefined;
      const chain = {
        initConfiguration(c: typeof init) { init = c; return chain; },
        requestTransformationFunctions(f: { body: typeof transform }) { transform = f.body; return chain; },
        fetch() {
          const configuration = { url: BASE, endpointDefinition: { url: BASE } };
          const url = transform ? transform(configuration).url : BASE;
          const i = init as NonNullable<typeof init>;
          calls.push({ target: targetOf(id), method: i.method, url: url.slice(BASE.length), headers: i.headers, ...(i.body !== undefined && { body: i.body }) });
          const a = queue.shift();
          if (a === undefined) return Promise.reject(new Error("fake VB helper: no answer queued"));
          return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
        },
      };
      return chain;
    },
  };
  return { helper, calls };
}

/** An EndpointFetch over the real DashboardRestHelper and a fake VB helper (map: every contract name). */
export function fakeEndpoints(answers: VbAnswer[], opts: { stream?: StreamFetch; endpoints?: Partial<Record<EndpointName, string>> } = {}): { endpoints: EndpointFetch; calls: VbCall[] } {
  const { helper, calls } = fakeVbHelper(answers);
  const drh = new DashboardRestHelperClass(helper, opts.endpoints ?? TEST_ENDPOINTS);
  return { endpoints: new EndpointFetch({ helper: drh, ...(opts.stream !== undefined && { stream: opts.stream }) }), calls };
}
