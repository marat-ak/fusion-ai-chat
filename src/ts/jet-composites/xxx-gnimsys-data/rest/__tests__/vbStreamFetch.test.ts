/** @jest-environment node */
// The VB stream provider against a fake VB RestHelper that follows rest.js fetch(): pre-fetch hook, request transforms,
// new Request(url, initConfig), request hook, network fetch, response hook, then the body of WHATEVER the response hook
// returned is read (responseBodyFormat for OK, else read ignoring errors), then the post-fetch (error) hook.
import { loadAmd } from "./amd";

type Hooks = {
  handlePreFetchHook(rest: unknown): unknown;
  handleRequestHook(request: Request): Request | undefined;
  handleResponseHook(response: Response): Response | undefined;
  handlePostFetchHook(result: unknown): unknown;
  handlePostFetchErrorHook(result: unknown): unknown;
};
type Init = { method: string; headers: Record<string, string>; body?: string; url: string; signal?: AbortSignal };
type StreamFetch = (endpointId: string, request: Omit<Init, "url"> & { url: string }) => Promise<Response>;
type Provider = {
  createVbStreamFetch(restHelper: unknown): StreamFetch;
  supportsVbStreamFetch(restHelper: unknown, endpointId: string): boolean;
};
const { createVbStreamFetch, supportsVbStreamFetch } = loadAmd("xxx-gnimsys-data/rest/vb-stream-fetch") as Provider;

const BASE = "https://pod.example.com";

function fakeVb(respond: (request: Request) => Response | Promise<Response>) {
  const log = { calls: [] as string[], inits: [] as Init[], requests: [] as Request[], read: [] as Array<{ status: number; body: unknown; nullBody: boolean }> };
  const helper = {
    get(id: string) {
      log.calls.push("get:" + id);
      let init: Init | undefined;
      let transform: ((c: { url: string; endpointDefinition: { url: string }; initConfig: object }) => { url: string; initConfig: object }) | undefined;
      let handler: Hooks | undefined;
      let format: string | undefined;
      const rest = {
        initConfiguration(c: Init) { init = c; log.inits.push(c); return rest; },
        requestTransformationFunctions(f: { body: typeof transform }) { transform = f.body; return rest; },
        hookHandler(h: Hooks) { handler = h; return rest; },
        responseBodyFormat(f: string) { format = f; return rest; },
        async fetch() {
          if (handler) await (handler.handlePreFetchHook(rest) || Promise.resolve());
          log.calls.push("pre");
          const { url: _ignored, ...initConfig } = init as Init;
          let configuration = { url: BASE, endpointDefinition: { url: BASE }, initConfig };
          if (transform) configuration = transform(configuration) as typeof configuration;
          let request = new Request(configuration.url, configuration.initConfig as RequestInit);
          if (handler) request = handler.handleRequestHook(request) || request;
          log.calls.push("request");
          log.requests.push(request);
          const rsp = await respond(request);
          const response = (handler && handler.handleResponseHook(rsp)) || rsp;
          log.calls.push("response");
          const ok = response.ok;
          const nullBody = response.body === null;
          const body = ok ? (format === "text" ? await response.text() : await response.json()) : await response.text().catch(() => null);
          log.read.push({ status: response.status, body, nullBody });
          const result = { response, body };
          if (handler) {
            if (ok) await handler.handlePostFetchHook({ ...result });
            else await handler.handlePostFetchErrorHook(result);
          }
          log.calls.push(ok ? "post" : "postError");
          return result;
        },
      };
      return rest;
    },
  };
  return { helper, log };
}

/** A response whose body the test feeds chunk by chunk; `cancelled` records a cancel of the stream. */
function feed(status = 200, headers: Record<string, string> = { "Content-Type": "text/event-stream" }) {
  const enc = new TextEncoder();
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(c) { ctl = c; },
    cancel() { state.cancelled = true; },
  });
  return {
    response: new Response(body, { status, headers }),
    push: (s: string) => ctl?.enqueue(enc.encode(s)),
    close: () => ctl?.close(),
    state,
  };
}
const dec = new TextDecoder();

test("keeps_the_native_response_unconsumed_and_streams_it_progressively", async () => {
  const f = feed();
  f.push("data: one\n\n");
  const { helper, log } = fakeVb(() => f.response);
  const res = await createVbStreamFetch(helper)("scFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: { Accept: "text/event-stream" }, body: "{}" });
  // Resolved while the stream is still open: VB read only the stand-in.
  expect(res).toBe(f.response);
  expect(res.bodyUsed).toBe(false);
  expect(log.read).toEqual([{ status: 200, body: "", nullBody: false }]);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  expect(dec.decode((await reader.read()).value)).toBe("data: one\n\n");
  f.push("data: two\n\n");
  expect(dec.decode((await reader.read()).value)).toBe("data: two\n\n");
  f.close();
  expect((await reader.read()).done).toBe(true);
  expect(log.calls).toEqual(["get:scFUAI", "pre", "request", "response", "post"]);
});

test("request_goes_through_vb_with_dashboard_url_rewrite_and_init", async () => {
  const ac = new AbortController();
  const { helper, log } = fakeVb(() => new Response("", { status: 200 }));
  const fetchStream = createVbStreamFetch(helper);
  await fetchStream("scFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}', signal: ac.signal });
  await fetchStream("scFUAI", { url: "https://other.example.com/y", method: "POST", headers: {} });
  expect(log.requests.map((r) => r.url)).toEqual([`${BASE}/api/fusion-ai/x/chat`, "https://other.example.com/y"]);
  expect(log.inits[0]).toEqual({ method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}', url: "/api/fusion-ai/x/chat", signal: ac.signal });
  expect(log.inits[1]).toEqual({ method: "POST", headers: {}, url: "https://other.example.com/y" });
  expect(await log.requests[0].text()).toBe('{"a":1}');
  expect(log.requests[0].headers.get("content-type")).toBe("application/json");
});

test("null_body_stand_in_for_204_205_304", async () => {
  for (const status of [204, 205, 304]) {
    const { helper, log } = fakeVb(() => new Response(null, { status }));
    const res = await createVbStreamFetch(helper)("scBOSS", { url: "/api/boss/x", method: "POST", headers: {} });
    expect(res.status).toBe(status);
    expect(log.read[0].nullBody).toBe(true);
  }
});

test("http_401_resolves_intact", async () => {
  const native = new Response('{"detail":"denied"}', { status: 401, statusText: "Unauthorized", headers: { "Content-Type": "application/json" } });
  const { helper, log } = fakeVb(() => native);
  const res = await createVbStreamFetch(helper)("scFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: {} });
  expect(res).toBe(native);
  expect([res.status, res.statusText, res.bodyUsed]).toEqual([401, "Unauthorized", false]);
  expect(await res.text()).toBe('{"detail":"denied"}');
  expect(log.read).toEqual([{ status: 401, body: "", nullBody: false }]);
  expect(log.calls).toEqual(["get:scFUAI", "pre", "request", "response", "postError"]);
});

test("abort_after_the_answer_cancels_the_kept_body", async () => {
  const f = feed();
  const ac = new AbortController();
  const { helper } = fakeVb(() => f.response);
  const res = await createVbStreamFetch(helper)("scFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: {}, signal: ac.signal });
  ac.abort();
  await Promise.resolve();
  expect(f.state.cancelled).toBe(true);
  expect((await (res.body as ReadableStream<Uint8Array>).getReader().read()).done).toBe(true);
});

test("abort_while_a_reader_holds_the_body_leaves_it_to_the_reader", async () => {
  const f = feed();
  const ac = new AbortController();
  const { helper } = fakeVb(() => f.response);
  const res = await createVbStreamFetch(helper)("scFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: {}, signal: ac.signal });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  ac.abort(); // the locked body is the reader's to cancel: no error is raised here
  await reader.cancel();
  expect(f.state.cancelled).toBe(true);
});

test("abort_before_the_answer_rejects_with_AbortError_and_cancels", async () => {
  const f = feed();
  const ac = new AbortController();
  let answer: ((r: Response) => void) | undefined;
  const { helper } = fakeVb(() => new Promise<Response>((r) => { answer = r; }));
  const pending = createVbStreamFetch(helper)("scFUAI", { url: "/api/fusion-ai/x/chat", method: "POST", headers: {}, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 0));
  ac.abort();
  answer?.(f.response);
  const e = await pending.catch((x: unknown) => x);
  expect((e as Error).name).toBe("AbortError");
  expect(f.state.cancelled).toBe(true);
});

test("already_aborted_does_not_call_vb", async () => {
  const ac = new AbortController();
  ac.abort();
  const { helper, log } = fakeVb(() => new Response(""));
  const e = await createVbStreamFetch(helper)("scFUAI", { url: "/api/fusion-ai/x", method: "POST", headers: {}, signal: ac.signal }).catch((x: unknown) => x);
  expect((e as Error).name).toBe("AbortError");
  expect(log.calls).toEqual([]);
});

test("network_failure_rejects_as_vb_does", async () => {
  const { helper } = fakeVb(() => { throw new TypeError("Failed to fetch"); });
  const e = await createVbStreamFetch(helper)("scFUAI", { url: "/api/fusion-ai/x", method: "POST", headers: {} }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(TypeError);
  expect((e as Error).message).toBe("Failed to fetch");
});

test("a_chain_that_never_calls_the_response_hook_is_an_explicit_error", async () => {
  const plain = {
    get: () => {
      const rest = {
        initConfiguration: () => rest, requestTransformationFunctions: () => rest, hookHandler: () => rest, responseBodyFormat: () => rest,
        fetch: async () => ({ response: new Response("x"), body: "x" }),
      };
      return rest;
    },
  };
  const e = await createVbStreamFetch(plain)("scFUAI", { url: "/api/fusion-ai/x", method: "POST", headers: {} }).catch((x: unknown) => x);
  expect((e as Error).message).toBe("VB rest helper did not hand the response to handleResponseHook (endpoint scFUAI)");
});

test("supports_only_chains_with_hook_handler_and_body_format", () => {
  const { helper } = fakeVb(() => new Response(""));
  expect(supportsVbStreamFetch(helper, "scFUAI")).toBe(true);
  const basic = { get: () => ({ initConfiguration() { return this; }, requestTransformationFunctions() { return this; }, fetch: async () => ({}) }) };
  expect(supportsVbStreamFetch(basic, "scFUAI")).toBe(false);
  expect(supportsVbStreamFetch({}, "scFUAI")).toBe(false);
  expect(supportsVbStreamFetch(null, "scFUAI")).toBe(false);
});
