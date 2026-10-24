/** @jest-environment node */
import * as fs from "fs";
import * as path from "path";
import { AiStudioTransport } from "../transport/AiStudioTransport";
import type { ChatEvent } from "../transport/events";
import { EndpointError } from "../endpoints/EndpointFetch";
import type { EndpointFetch, EndpointName, StreamInit } from "../endpoints/EndpointFetch";
import { signedHeaders, H_CHECK, H_VERSION, H_TIMESTAMP } from "../transport/signer";
import { fakeResponse, streamResponse } from "./helpers.auth";
import { fakeEndpoints } from "./helpers.endpoints";

const O = "https://pod.example.com";
const WF = "WF_1";
const V = "2607100";
const TS = 1791547256;
const URL_CHAT = `/api/fusion-ai/orchestrator/agent/v2/${WF}/chat`;

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
/** Cuts text at the given offsets. */
const cut = (text: string, at: number[]): string[] => [0, ...at].map((a, i) => text.slice(a, i < at.length ? at[i] : undefined));

/** The chat call goes through the endpoint layer's streaming capability; the fake records it and answers `respond()`. */
function fakeStream(respond: () => Response): { endpoints: EndpointFetch; calls: Array<{ target: EndpointName; url: string; init: StreamInit }> } {
  const calls: Array<{ target: EndpointName; url: string; init: StreamInit }> = [];
  const { endpoints } = fakeEndpoints([], { stream: async (target, url, init) => { calls.push({ target, url, init }); return respond(); } });
  return { endpoints, calls };
}

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

test("sends_signed_post_with_body", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V, additionalContext: { invoiceId: "42" }, responseLanguage: "fr", now: () => TS });
  await collect(t.send({ conversationId: "c-1", text: "hi" }));
  expect(calls).toHaveLength(1);
  const { target, url, init } = calls[0];
  expect(target).toBe("FUAI");
  expect(url).toBe(URL_CHAT);
  expect(init.method).toBe("POST");
  const h = init.headers as Record<string, string>;
  expect(h["Content-Type"]).toBe("application/json");
  expect(h["Accept"]).toBe("text/event-stream");
  for (const n of [H_CHECK, H_VERSION, H_TIMESTAMP]) expect(typeof h[n]).toBe("string");
  expect(h[H_VERSION]).toBe(V);
  expect(h[H_TIMESTAMP]).toBe(String(TS));
  expect(h[H_CHECK]).toBe((await signedHeaders("hi", V, TS))[H_CHECK]);
  expect(JSON.parse(init.body as string)).toEqual({
    message: "hi",
    workflowCode: WF,
    conversationId: "c-1",
    parameters: { additional_context: JSON.stringify({ invoiceId: "42" }) },
    responseLanguage: "fr",
  });
});

test("streams_delta_final_followups_done", async () => {
  const text = fixture("chat-hello.sse");
  const chunks = cut(text, [text.indexOf('"Hel"') + 2, text.indexOf('"output"') + 4]); // both cuts land mid-JSON
  expect(chunks).toHaveLength(3);
  const { endpoints } = fakeStream(() => streamResponse(chunks));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  expect(await collect(t.send({ conversationId: "c-1", text: "hello" }))).toEqual([
    { type: "delta", text: "Hel" },
    { type: "delta", text: "lo!" },
    { type: "job", jobId: "job-1" },
    { type: "final", text: "Hello! How can I help?", finishReason: "stop" },
    { type: "followups", questions: ["Show invoices", "Create order"] },
    { type: "done" },
  ]);
});

test("wait_fixture_yields_wait_event", async () => {
  const text = fixture("chat-wait.sse");
  const { endpoints } = fakeStream(() => streamResponse(cut(text, [text.indexOf("callbackToken") + 5])));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  expect(await collect(t.send({ conversationId: "c-1", text: "approve me" }))).toEqual([
    { type: "job", jobId: "job-1" },
    { type: "wait", kind: "HUMAN", token: "cb-1", message: "Approve the transfer?", approval: true, feedback: true, requestChangeMessage: "What should change?" },
    { type: "done" },
  ]);
});

test("http_403_yields_error_event_with_code", async () => {
  const body = '{"detail":"FAI-40300 not published"}';
  const { endpoints } = fakeStream(() => fakeResponse(body, { status: 403 }));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  const events = await collect(t.send({ conversationId: "c-1", text: "hi" }));
  expect(events).toEqual([{ type: "error", status: 403, code: "FAI-40300", message: "FAI-40300 not published" }, { type: "done" }]);
});

test("nonsse_2xx_yields_error_then_done", async () => {
  const { endpoints } = fakeStream(() => fakeResponse("<html>login</html>", { contentType: "text/html; charset=utf-8" }));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  expect(await collect(t.send({ conversationId: "c-1", text: "hi" }))).toEqual([
    { type: "error", status: 200, message: "non-SSE response (text/html; charset=utf-8)" },
    { type: "done" },
  ]);
});

test("redirected_2xx_yields_error_then_done", async () => {
  // Even an SSE answer is not trusted after a redirect (a login hop, a proxy): the request did not reach /chat as sent.
  const { endpoints } = fakeStream(() => Object.assign(streamResponse([fixture("chat-hello.sse")]), { redirected: true, url: O + "/login" }));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  expect(await collect(t.send({ conversationId: "c-1", text: "hi" }))).toEqual([
    { type: "error", status: 200, message: "redirected to " + O + "/login" },
    { type: "done" },
  ]);
});

test("resume_sends_resumeInput_and_signs_empty_message", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V, additionalContext: { a: 1 }, responseLanguage: "fr", now: () => TS });
  await collect(t.send({ conversationId: "c-1", text: "ignored", resume: { jobId: "job-1", token: "cb-1", action: "RFI_ACTION", content: "smaller amount" } }));
  await collect(t.send({ conversationId: "c-1", text: "", resume: { jobId: "job-1", token: "cb-1", action: "APPROVE_ACTION", statusCheckOnly: true } }));
  expect(calls.map((c) => c.url)).toEqual([URL_CHAT, URL_CHAT]);
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    message: "",
    workflowCode: WF,
    conversationId: "c-1",
    jobId: "job-1",
    resumeInput: { messageInstanceId: "cb-1", userResponse: "RFI_ACTION", content: "smaller amount" },
  });
  expect(JSON.parse(calls[1].init.body as string)).toEqual({
    message: "",
    workflowCode: WF,
    conversationId: "c-1",
    jobId: "job-1",
    resumeInput: { messageInstanceId: "cb-1", userResponse: "APPROVE_ACTION" },
    statusCheckOnly: true,
  });
  const expected = (await signedHeaders("", V, TS))[H_CHECK];
  for (const c of calls) expect((c.init.headers as Record<string, string>)[H_CHECK]).toBe(expected);
});

test("nonjson_payload_yields_error_but_stream_continues", async () => {
  const text = "data: {nope\n\n" + fixture("chat-error.sse");
  const { endpoints } = fakeStream(() => streamResponse(cut(text, [8, text.indexOf("ErrorRecord")])));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  const events = await collect(t.send({ conversationId: "c-1", text: "fail" }));
  expect(events).toHaveLength(4);
  expect(events[0]).toMatchObject({ type: "error" });
  expect((events[0] as { message: string }).message).toMatch(/^bad frame: /);
  expect(events.slice(1)).toEqual([
    { type: "final", text: "ErrorRecord[boom]", finishReason: "error" },
    { type: "error", message: "ErrorRecord[boom]", code: "N1" },
    { type: "done" },
  ]);
});

test("abort_mid_stream_yields_done_without_error", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse(['data: {"message":{"content":[{"text":"Hel"}]}}\n\n'], { open: true }));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  const ac = new AbortController();
  const out: ChatEvent[] = [];
  for await (const e of t.send({ conversationId: "c-1", text: "hi" }, ac.signal)) {
    out.push(e);
    if (e.type === "delta") ac.abort();
  }
  expect(calls[0].init.signal).toBe(ac.signal);
  expect(out).toEqual([{ type: "delta", text: "Hel" }, { type: "done" }]);
});

test("workflow_code_is_encoded_into_the_FUAI_path", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  await collect(new AiStudioTransport({ endpoints, workflowCode: "A/B C", version: "PUBLISHED", checkVersion: V }).send({ conversationId: "c-1", text: "hi" }));
  expect(calls.map((c) => [c.target, c.url])).toEqual([["FUAI", "/api/fusion-ai/orchestrator/agent/v2/A%2FB%20C/chat"]]);
});

test("http_401_throws_EndpointError_for_relogin", async () => {
  const { endpoints } = fakeStream(() => fakeResponse("denied", { status: 401 }));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  const e = await collect(t.send({ conversationId: "c-1", text: "hi" })).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(EndpointError);
  expect([(e as EndpointError).kind, (e as EndpointError).status, (e as EndpointError).target]).toEqual(["http", 401, "FUAI"]);
});

test("network_failure_throws_EndpointError", async () => {
  const { endpoints } = fakeStream(() => { throw new TypeError("Failed to fetch"); });
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  const e = await collect(t.send({ conversationId: "c-1", text: "hi" })).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(EndpointError);
  expect((e as EndpointError).kind).toBe("network");
});

test("no_streaming_capability_is_an_explicit_error_and_sends_nothing", async () => {
  const { endpoints, calls } = fakeEndpoints([]);
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  expect(await collect(t.send({ conversationId: "c-1", text: "hi" }))).toEqual([
    { type: "error", message: "chat streaming not available through this endpoint" },
    { type: "done" },
  ]);
  expect(calls).toEqual([]);
});
