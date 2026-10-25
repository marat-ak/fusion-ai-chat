/** @jest-environment node */
// agent.version DRAFT and agent.publishedVia "debug" (Studio's `/debug` test path, request shaped like the vendored aistudio
// CLI's debug runner) and the transport's raw frames (ui.debug.rawFrames).
import * as fs from "fs";
import * as path from "path";
import { AiStudioTransport } from "../transport/AiStudioTransport";
import type { ChatEvent } from "../transport/events";
import type { EndpointFetch, EndpointName, StreamInit } from "../endpoints/EndpointFetch";
import { frameToEvents } from "../transport/sseParser";
import { signedHeaders, H_CHECK } from "../transport/signer";
import { streamResponse } from "./helpers.auth";
import { fakeEndpoints } from "./helpers.endpoints";

const WF = "WF_1";
const V = "2607100";
const TS = 1791547256;
const URL_DEBUG = `/api/fusion-ai/orchestrator/agent/v2/${WF}/debug`;
const DEBUG_PARAMS = { isDebug: true, breakPoints: [] };

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

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

test("draft_posts_the_cli_debug_shape_to_debug_signed_over_the_message", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  const t = new AiStudioTransport({
    endpoints, workflowCode: WF, version: "DRAFT", checkVersion: V, additionalContext: { invoiceId: "42" }, responseLanguage: "fr", now: () => TS,
  });
  await collect(t.send({ conversationId: "c-1", text: "hi" }));
  expect(calls.map((c) => [c.target, c.url, c.init.method])).toEqual([["FUAI", URL_DEBUG, "POST"]]);
  const h = calls[0].init.headers;
  expect([h["Content-Type"], h["Accept"]]).toEqual(["application/json", "text/event-stream"]);
  expect(h[H_CHECK]).toBe((await signedHeaders("hi", V, TS))[H_CHECK]);
  const body = JSON.parse(calls[0].init.body as string);
  expect(body).toEqual({
    message: "hi",
    workflowCode: WF,
    conversationId: "c-1",
    invocationMode: "ADMIN",
    parameters: { additional_context: JSON.stringify({ invoiceId: "42" }) },
    responseLanguage: "fr",
    debugParams: DEBUG_PARAMS,
  });
  // No `status`: the CLI sends status only for the PUBLISHED copy; without it the draft runs.
  expect("status" in body).toBe(false);
});

test("draft_resume_is_the_cli_resume_shape_without_run_input", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "DRAFT", checkVersion: V, additionalContext: { a: 1 }, now: () => TS });
  await collect(t.send({ conversationId: "c-1", text: "ignored", resume: { jobId: "job-1", token: "cb-1", action: "RFI_ACTION", content: "less" } }));
  await collect(t.send({ conversationId: "c-1", text: "", resume: { jobId: "job-1", token: "cb-1", action: "APPROVE_ACTION", statusCheckOnly: true } }));
  expect(calls.map((c) => c.url)).toEqual([URL_DEBUG, URL_DEBUG]);
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    message: "",
    workflowCode: WF,
    conversationId: "c-1",
    invocationMode: "ADMIN",
    debugParams: DEBUG_PARAMS,
    jobId: "job-1",
    resumeInput: { messageInstanceId: "cb-1", userResponse: "RFI_ACTION", content: "less" },
  });
  expect(JSON.parse(calls[1].init.body as string)).toEqual({
    message: "",
    workflowCode: WF,
    conversationId: "c-1",
    invocationMode: "ADMIN",
    debugParams: DEBUG_PARAMS,
    jobId: "job-1",
    resumeInput: { messageInstanceId: "cb-1", userResponse: "APPROVE_ACTION" },
    statusCheckOnly: true,
  });
  const expected = (await signedHeaders("", V, TS))[H_CHECK];
  for (const c of calls) expect(c.init.headers[H_CHECK]).toBe(expected);
});

test("published_body_carries_no_debug_fields", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  await collect(new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V }).send({ conversationId: "c-1", text: "hi" }));
  // publishedVia "chat" is the same request as no publishedVia (the documented behaviour).
  await collect(new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", publishedVia: "chat", checkVersion: V }).send({ conversationId: "c-1", text: "hi" }));
  expect(calls.map((c) => c.url)).toEqual([`/api/fusion-ai/orchestrator/agent/v2/${WF}/chat`, `/api/fusion-ai/orchestrator/agent/v2/${WF}/chat`]);
  for (const c of calls) expect(JSON.parse(c.init.body as string)).toEqual({ message: "hi", workflowCode: WF, conversationId: "c-1" });
});

// agent.publishedVia "debug": a PUBLISHED run through Studio's test path, as the vendored aistudio CLI sends it (cT with
// status PUBLISHED; resume = Wle, the same base + jobId + resumeInput).
test("published_via_debug_posts_the_cli_published_shape_to_debug_signed_over_the_message", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  const t = new AiStudioTransport({
    endpoints, workflowCode: WF, version: "PUBLISHED", publishedVia: "debug", checkVersion: V, additionalContext: { invoiceId: "42" }, responseLanguage: "fr", now: () => TS,
  });
  await collect(t.send({ conversationId: "c-1", text: "hi" }));
  expect(calls.map((c) => [c.target, c.url, c.init.method])).toEqual([["FUAI", URL_DEBUG, "POST"]]);
  const h = calls[0].init.headers;
  expect([h["Content-Type"], h["Accept"]]).toEqual(["application/json", "text/event-stream"]);
  expect(h[H_CHECK]).toBe((await signedHeaders("hi", V, TS))[H_CHECK]);
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    message: "hi",
    workflowCode: WF,
    conversationId: "c-1",
    invocationMode: "ADMIN",
    status: "PUBLISHED",
    parameters: { additional_context: JSON.stringify({ invoiceId: "42" }) },
    responseLanguage: "fr",
    debugParams: DEBUG_PARAMS,
  });
});

test("published_via_debug_resume_is_the_cli_resume_shape_with_status_published", async () => {
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", publishedVia: "debug", checkVersion: V, additionalContext: { a: 1 }, now: () => TS });
  await collect(t.send({ conversationId: "c-1", text: "ignored", resume: { jobId: "job-1", token: "cb-1", action: "RFI_ACTION", content: "less" } }));
  await collect(t.send({ conversationId: "c-1", text: "", resume: { jobId: "job-1", token: "cb-1", action: "APPROVE_ACTION", statusCheckOnly: true } }));
  expect(calls.map((c) => c.url)).toEqual([URL_DEBUG, URL_DEBUG]);
  expect(JSON.parse(calls[0].init.body as string)).toEqual({
    message: "",
    workflowCode: WF,
    conversationId: "c-1",
    invocationMode: "ADMIN",
    status: "PUBLISHED",
    debugParams: DEBUG_PARAMS,
    jobId: "job-1",
    resumeInput: { messageInstanceId: "cb-1", userResponse: "RFI_ACTION", content: "less" },
  });
  expect(JSON.parse(calls[1].init.body as string)).toEqual({
    message: "",
    workflowCode: WF,
    conversationId: "c-1",
    invocationMode: "ADMIN",
    status: "PUBLISHED",
    debugParams: DEBUG_PARAMS,
    jobId: "job-1",
    resumeInput: { messageInstanceId: "cb-1", userResponse: "APPROVE_ACTION" },
    statusCheckOnly: true,
  });
  const expected = (await signedHeaders("", V, TS))[H_CHECK];
  for (const c of calls) expect(c.init.headers[H_CHECK]).toBe(expected);
});

test("a_draft_run_ignores_published_via", async () => {
  // A config may carry publishedVia with an unbound version; when the user then chooses DRAFT, the draft runs as always.
  const { endpoints, calls } = fakeStream(() => streamResponse([]));
  await collect(new AiStudioTransport({ endpoints, workflowCode: WF, version: "DRAFT", publishedVia: "debug", checkVersion: V }).send({ conversationId: "c-1", text: "hi" }));
  await collect(new AiStudioTransport({ endpoints, workflowCode: WF, version: "DRAFT", publishedVia: "chat", checkVersion: V }).send({ conversationId: "c-1", text: "hi" }));
  expect(calls.map((c) => c.url)).toEqual([URL_DEBUG, URL_DEBUG]);
  for (const c of calls) {
    expect(JSON.parse(c.init.body as string)).toEqual({ message: "hi", workflowCode: WF, conversationId: "c-1", invocationMode: "ADMIN", debugParams: DEBUG_PARAMS });
  }
});

test("published_via_debug_streams_frames_and_raw_frames_as_the_draft", async () => {
  const text = fixture("chat-hello.sse");
  const payloads = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6));
  const { endpoints } = fakeStream(() => streamResponse([text]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", publishedVia: "debug", checkVersion: V, rawFrames: true });
  const events = await collect(t.send({ conversationId: "c-1", text: "hello" }));
  expect(events.filter((e) => e.type === "raw")).toEqual(payloads.map((payload) => ({ type: "raw", payload })));
  expect(events.filter((e) => e.type === "delta" || e.type === "final" || e.type === "done")).toEqual([
    { type: "delta", text: "Hel" },
    { type: "delta", text: "lo!" },
    { type: "final", text: "Hello! How can I help?", finishReason: "stop" },
    { type: "done" },
  ]);
});

test("draft_streams_the_same_frames_as_chat", async () => {
  const { endpoints } = fakeStream(() => streamResponse([fixture("chat-hello.sse")]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "DRAFT", checkVersion: V });
  const events = await collect(t.send({ conversationId: "c-1", text: "hello" }));
  expect(events.filter((e) => e.type === "delta" || e.type === "final" || e.type === "done")).toEqual([
    { type: "delta", text: "Hel" },
    { type: "delta", text: "lo!" },
    { type: "final", text: "Hello! How can I help?", finishReason: "stop" },
    { type: "done" },
  ]);
});

test("raw_frames_yield_every_data_payload_verbatim_before_its_events", async () => {
  const text = fixture("chat-hello.sse");
  const payloads = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6));
  // Cut mid-frame so a payload spans two chunks; a non-JSON frame is listed too (and still reported as a bad frame).
  const withBad = "data: {nope\n\n" + text;
  const at = withBad.indexOf('"Hel"') + 2;
  const { endpoints } = fakeStream(() => streamResponse([withBad.slice(0, at), withBad.slice(at)]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "DRAFT", checkVersion: V, rawFrames: true });
  const events = await collect(t.send({ conversationId: "c-1", text: "hello" }));
  expect(events.filter((e) => e.type === "raw")).toEqual(["{nope", ...payloads].map((payload) => ({ type: "raw", payload })));
  // Each raw frame comes right before the events parsed from it.
  const iFinalRaw = events.findIndex((e) => e.type === "raw" && e.payload.includes('"finishReason"'));
  expect(events[iFinalRaw + 1]).toEqual({ type: "final", text: "Hello! How can I help?", finishReason: "stop" });
  expect(events[1]).toMatchObject({ type: "error" });
  expect(events.at(-1)).toEqual({ type: "done" });
});

test("raw_frames_off_yields_no_raw_events", async () => {
  const { endpoints } = fakeStream(() => streamResponse([fixture("chat-hello.sse")]));
  const t = new AiStudioTransport({ endpoints, workflowCode: WF, version: "PUBLISHED", checkVersion: V });
  expect((await collect(t.send({ conversationId: "c-1", text: "hello" }))).some((e) => e.type === "raw")).toBe(false);
});

test("string_content_is_a_delta", () => {
  expect(frameToEvents({ message: { content: "Hel" } })).toEqual([{ type: "delta", text: "Hel" }]);
  expect(frameToEvents({ message: { content: [{ text: "lo" }] } })).toEqual([{ type: "delta", text: "lo" }]);
});
