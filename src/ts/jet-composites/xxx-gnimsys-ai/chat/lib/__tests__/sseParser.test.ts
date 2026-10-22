import { createSseDataSplitter, parseFrame, frameToEvents } from "../transport/sseParser";

describe("sseParser", () => {
  test("splitter_reassembles_partial_lines", () => {
    const s = createSseDataSplitter();
    expect(s.push('data: {"a":')).toEqual([]);
    expect(s.push("1}\n\n")).toEqual(['{"a":1}']);
  });

  test("splitter_ignores_ping_and_event_lines", () => {
    const s = createSseDataSplitter();
    const out = s.push(": ping\r\nevent: message\r\nid: 5\r\ndata: [DONE]\r\ndata:{\"b\":2}\r\n\r\ndata: {\"c\":3}");
    expect(out).toEqual(['{"b":2}']);
    expect(s.flush()).toEqual(['{"c":3}']);
  });

  test("nonjson_line_becomes_error_event", () => {
    const r = parseFrame("{nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe("string");
  });

  test("delta_frame_maps_to_delta", () => {
    expect(frameToEvents({ message: { content: [{ text: "Hel" }] } })).toEqual([{ type: "delta", text: "Hel" }]);
  });

  test("final_stop_frame_maps_to_final", () => {
    expect(frameToEvents({ message: { output: "Done", finishReason: "stop" } })).toEqual([
      { type: "final", text: "Done", finishReason: "stop" },
    ]);
  });

  test("final_error_frame_maps_to_final_and_error_with_code", () => {
    expect(frameToEvents({ message: { output: "boom", finishReason: "error" }, errorNodeCode: "N1" })).toEqual([
      { type: "final", text: "boom", finishReason: "error" },
      { type: "error", message: "boom", code: "N1" },
    ]);
  });

  test("wait_frame_maps_to_wait_with_flags", () => {
    expect(
      frameToEvents({
        message: { finishReason: "wait" },
        waitingNodeDetails: { type: "HUMAN", callbackToken: "tok", initialMessage: "ok?", approvalEnabledFlag: true, requestChangeMessage: "chg", waitTimeInMinutes: 5 },
      }),
    ).toEqual([
      { type: "wait", kind: "HUMAN", token: "tok", message: "ok?", approval: true, feedback: false, requestChangeMessage: "chg", waitMinutes: 5 },
    ]);
  });

  test("unknown_finishReason_is_error", () => {
    expect(frameToEvents({ message: { output: "x", finishReason: "length" } })).toEqual([{ type: "error", message: "unknown finishReason length" }]);
    // null (not set) is no finishReason at all
    expect(frameToEvents({ message: { content: [{ text: "a" }], finishReason: null as unknown as string } })).toEqual([{ type: "delta", text: "a" }]);
    expect(frameToEvents({ message: { content: [{ text: "b" }], finishReason: "" } })).toEqual([{ type: "delta", text: "b" }]);
  });

  test("wait_without_token_is_error", () => {
    expect(frameToEvents({ message: { finishReason: "wait" }, waitingNodeDetails: { type: "HUMAN", initialMessage: "ok?" } as never }))
      .toEqual([{ type: "error", message: "wait without callbackToken" }]);
    expect(frameToEvents({ message: { finishReason: "wait" } })).toEqual([{ type: "error", message: "wait without callbackToken" }]);
  });

  test("followups_frame_maps_to_followups", () => {
    expect(frameToEvents({ message: { followUpQuestions: ["a", "b"] } })).toEqual([{ type: "followups", questions: ["a", "b"] }]);
  });

  test("progress_frame_not_executed_maps_to_progress", () => {
    expect(frameToEvents({ nodeProgressMessage: { type: "NODE_STARTED", progressMessage: "Working", nodeCode: "n1" } })).toEqual([
      { type: "progress", text: "Working", nodeCode: "n1" },
    ]);
    expect(frameToEvents({ nodeProgressMessage: { type: "NODE_EXECUTED", progressMessage: "x" } })).toEqual([]);
  });
});
