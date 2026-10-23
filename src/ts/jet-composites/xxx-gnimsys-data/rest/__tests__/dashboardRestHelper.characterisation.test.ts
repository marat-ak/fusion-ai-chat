// Characterisation of the dashboard's DashboardRestHelper as moved into xxx-gnimsys-data (behaviour recorded, not
// redesigned). A fake VB RestHelper records get(name), initConfiguration(cfg) and requestTransformationFunctions(fns),
// runs the `body` transform the way VB does (configuration.url = the endpoint's URL) and resolves VB's {response, body}.
import { loadAmd } from "./amd";

type Cfg = { method: string; headers: Record<string, string>; body?: unknown; url: string };
type Configuration = { url: string; endpointDefinition: { url: string } };
type Fns = { body: (c: Configuration) => Configuration };
type VbResult = { response: { status: number; statusText?: string }; body: unknown };

const BASE = "https://pod.example.com/base/";
const ok = (body: unknown = {}): VbResult => ({ response: { status: 200, statusText: "OK" }, body });

function fakeVb(results: Array<VbResult | Promise<VbResult>>) {
  const log = { gets: [] as string[], configs: [] as Cfg[], fns: [] as Fns[], urls: [] as string[] };
  const queue = [...results];
  const helper = {
    get(name: string) {
      log.gets.push(name);
      let fns: Fns | undefined;
      const chain = {
        initConfiguration(c: Cfg) { log.configs.push(c); return chain; },
        requestTransformationFunctions(f: Fns) { fns = f; log.fns.push(f); return chain; },
        fetch(): Promise<VbResult> {
          const configuration: Configuration = { url: BASE, endpointDefinition: { url: BASE } };
          const out = (fns as Fns).body(configuration);
          if (out !== configuration) throw new Error("transform must return the same configuration object");
          log.urls.push(out.url);
          return Promise.resolve(queue.shift() as VbResult);
        },
      };
      return chain;
    },
  };
  return { helper, log };
}

type Endpoint = {
  fetch(o?: object): Promise<unknown>; create(d: unknown, o?: object): Promise<unknown>; update(d: unknown, o?: object): Promise<unknown>;
  patch(d: unknown, o?: object): Promise<unknown>; delete(o?: object): Promise<unknown>; config: { headers?: Record<string, string> };
};
type Drh = new (rh: unknown, endpoints: Record<string, string>) => { createEndpoint(c: object): Endpoint };
type RestError = Error & { status: number; body: unknown; response: unknown };
const DashboardRestHelper = loadAmd("xxx-gnimsys-data/rest/dashboard-rest-helper") as Drh;

test("resolves_target_to_service_connection_name", async () => {
  const { helper, log } = fakeVb([ok()]);
  const drh = new DashboardRestHelper(helper, { FA: "site_FA:Base/custom", BOSS: "site_BOSS:Base/custom" });
  await drh.createEndpoint({ target: "BOSS", url: "/api/boss/x" }).fetch();
  expect(log.gets).toEqual(["site_BOSS:Base/custom"]);
  expect(log.configs[0]).toEqual({ method: "GET", headers: {}, url: "/api/boss/x" });
});

test("rewrites_url_relative_to_endpoint_base", async () => {
  const { helper, log } = fakeVb([ok(), ok(), ok()]);
  const drh = new DashboardRestHelper(helper, { FA: "fa" });
  await drh.createEndpoint({ target: "FA", url: "/fscmRestApi/resources/x?onlyData=true" }).fetch();
  await drh.createEndpoint({ target: "FA", url: "hcmRestApi/y" }).fetch();
  // An absolute URL replaces the endpoint's URL entirely.
  await drh.createEndpoint({ target: "FA", url: "https://other.example.com/z" }).fetch();
  expect(log.urls).toEqual([
    "https://pod.example.com/base/fscmRestApi/resources/x?onlyData=true",
    "https://pod.example.com/base/hcmRestApi/y",
    "https://other.example.com/z",
  ]);
});

test("get_appends_only_known_query_keys", async () => {
  const { helper, log } = fakeVb([ok(), ok(), ok()]);
  const ep = new DashboardRestHelper(helper, { FA: "fa" }).createEndpoint({ target: "FA", url: "/r?onlyData=true" });
  await ep.fetch({ offset: 5, limit: 10, q: "a=1", fields: "f", totalResults: true, orderBy: "o", fetchSize: 3, startIndex: 7, foo: "bar", data: { x: 1 }, nil: null });
  expect(log.configs[0].url).toBe("/r?onlyData=true&offset=5&limit=10&q=a%3D1&fields=f&totalResults=true&orderBy=o&limit=3&offset=7");
  await ep.delete({ limit: 2, other: 1 });
  expect(log.configs[1]).toEqual({ method: "DELETE", headers: {}, url: "/r?onlyData=true&limit=2" });
  // POST never appends query keys.
  await ep.create({ a: 1 }, { limit: 2 });
  expect(log.configs[2].url).toBe("/r?onlyData=true");
});

test("http_400_rejects", async () => {
  const result: VbResult = { response: { status: 400, statusText: "Bad Request" }, body: { detail: "bad filter" } };
  const { helper } = fakeVb([result]);
  const e = (await new DashboardRestHelper(helper, { BOSS: "boss" }).createEndpoint({ target: "BOSS", url: "/api/boss/x" }).fetch()
    .catch((x: unknown) => x)) as RestError;
  expect(e).toBeInstanceOf(Error);
  expect(e.status).toBe(400);
  expect(e.body).toEqual({ detail: "bad filter" });
  expect(e.response).toBe(result.response);
  // Recorded as is: the message is the status text; the body's detail is not used (see the slice report).
  expect(e.message).toBe("Bad Request");
});

test("oerrorcode_body_rejects", async () => {
  const { helper } = fakeVb([{ response: { status: 200, statusText: "OK" }, body: { "o:errorCode": "FND-1", title: "nope" } }]);
  const e = (await new DashboardRestHelper(helper, { FA: "fa" }).createEndpoint({ target: "FA", url: "/x" }).fetch()
    .catch((x: unknown) => x)) as RestError;
  expect(e).toBeInstanceOf(Error);
  expect(e.status).toBe(200);
  expect(e.body).toEqual({ "o:errorCode": "FND-1", title: "nope" });
});

test("success_resolves_vb_result_unchanged", async () => {
  const result = ok({ items: [1] });
  const { helper } = fakeVb([result]);
  const r = await new DashboardRestHelper(helper, { FA: "fa" }).createEndpoint({ target: "FA", url: "/x" }).fetch();
  expect(r).toBe(result);
});

test("missing_target_throws", () => {
  const { helper } = fakeVb([]);
  const drh = new DashboardRestHelper(helper, { FA: "fa" });
  expect(() => drh.createEndpoint({ target: "BOSS", url: "/x" })).toThrow("Unknown endpoint target: BOSS. Available targets: FA");
  expect(() => drh.createEndpoint({ url: "/x" })).toThrow("Endpoint config must include target property");
  expect(() => drh.createEndpoint({ target: "FA" })).toThrow("Endpoint config must include url property");
});

test("json_data_and_raw_body", async () => {
  const { helper, log } = fakeVb([ok(), ok(), ok(), ok()]);
  const ep = new DashboardRestHelper(helper, { FA: "fa" }).createEndpoint({ target: "FA", url: "/x", headers: { "If-Match": "e1" } });
  await ep.create({ a: 1 });
  await ep.patch({ b: 2 });
  await ep.update(undefined, { rawBody: "<xml/>" });
  await ep.create(undefined, { rawBody: "raw" });
  expect(log.configs[0]).toEqual({ method: "POST", headers: { "If-Match": "e1", "Content-Type": "application/json" }, body: '{"a":1}', url: "/x" });
  expect(log.configs[1]).toEqual({ method: "PATCH", headers: { "If-Match": "e1", "Content-Type": "application/json" }, body: '{"b":2}', url: "/x" });
  // A raw body is sent as given and gets no Content-Type.
  expect(log.configs[2]).toEqual({ method: "PUT", headers: { "If-Match": "e1" }, body: "<xml/>", url: "/x" });
  expect(log.configs[3]).toEqual({ method: "POST", headers: { "If-Match": "e1" }, body: "raw", url: "/x" });
});

test("parallel_calls_do_not_share_config", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const slow = gate.then(() => ok({ n: 1 }));
  const { helper, log } = fakeVb([slow, ok({ n: 2 })]);
  const ep = new DashboardRestHelper(helper, { FA: "fa" }).createEndpoint({ target: "FA", url: "/x", headers: { H: "1" } });
  const a = ep.create({ a: 1 });
  const b = ep.fetch({ limit: 5 });
  release?.();
  const [ra, rb] = (await Promise.all([a, b])) as Array<{ body: { n: number } }>;
  expect([ra.body.n, rb.body.n]).toEqual([1, 2]);
  // Each call builds its own request config and headers; the endpoint's own config is never touched.
  expect(log.configs[0]).not.toBe(log.configs[1]);
  expect(log.configs[0].headers).not.toBe(log.configs[1].headers);
  expect(log.configs[0]).toEqual({ method: "POST", headers: { H: "1", "Content-Type": "application/json" }, body: '{"a":1}', url: "/x" });
  expect(log.configs[1]).toEqual({ method: "GET", headers: { H: "1" }, url: "/x?limit=5" });
  expect(ep.config.headers).toEqual({ H: "1" });
  expect(log.urls).toEqual(["https://pod.example.com/base/x", "https://pod.example.com/base/x?limit=5"]);
  // One VB request chain (and transform) per call.
  expect(log.fns[0]).not.toBe(log.fns[1]);
});
