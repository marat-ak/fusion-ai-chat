import { initialState, reduce, newConversationId, ChatState, ChatAction } from "../state/conversation";

const run = (s: ChatState, ...a: ChatAction[]) => a.reduce(reduce, s);
const ev = (event: any): ChatAction => ({ type: "event", event });

describe("conversation reducer", () => {
  test("user_send_adds_two_turns_and_sending", () => {
    const att = [{ trackerId: "t", fileName: "a.pdf", size: 1, mimeType: "application/pdf" }];
    const s = run({ ...initialState("c1"), followups: ["x"] }, { type: "user_send", text: "hi", attachments: att });
    expect(s.turns).toHaveLength(2);
    expect(s.turns[0]).toMatchObject({ id: "t1", role: "user", text: "hi", attachments: att });
    expect(s.turns[1]).toMatchObject({ id: "t2", role: "assistant", text: "", streaming: true });
    expect(s.status).toBe("sending");
    expect(s.followups).toEqual([]);
    expect(s.nextTurnId).toBe(3);
  });

  test("trace_appends_to_streaming_turn", () => {
    const e1 = { nodeType: "NODE_START", nodeCode: "A", traceId: "t" };
    const e2 = { nodeType: "NODE_END", nodeCode: "A" };
    let s = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "trace", ...e1 }), ev({ type: "trace", ...e2 }));
    expect(s.turns[1].trace).toEqual([e1, e2]);
    expect(s.turns[1].streaming).toBe(true);
    s = run(s, ev({ type: "delta", text: "x" }), ev({ type: "final", text: "x", finishReason: "stop" }));
    expect(s.turns[1].trace).toEqual([e1, e2]);
  });

  test("trace_creates_streaming_turn_when_none", () => {
    const s = run(initialState("c"), ev({ type: "trace", nodeType: "NODE_START", nodeCode: "A" }));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ role: "assistant", streaming: true, trace: [{ nodeType: "NODE_START", nodeCode: "A" }] });
  });

  test("history_loaded_turns_have_no_trace", () => {
    const s = run(initialState("c"), { type: "history_loaded", messages: [{ role: "assistant", text: "hi" }] as any });
    expect(s.turns[0].trace).toBeUndefined();
  });

  test("deltas_accumulate_then_final_replaces", () => {
    let s = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "delta", text: "Hel" }), ev({ type: "delta", text: "lo!" }));
    expect(s.turns[1].text).toBe("Hello!");
    expect(s.status).toBe("streaming");
    s = run(s, ev({ type: "progress", text: "working" }));
    expect(s.progressText).toBe("working");
    s = run(s, ev({ type: "final", text: "Final answer", finishReason: "stop" }));
    expect(s.turns[1].text).toBe("Final answer");
    expect(s.turns[1].streaming).toBe(false);
    expect(s.progressText).toBeUndefined();
    s = run(s, ev({ type: "done" }));
    expect(s.status).toBe("idle");
  });

  test("error_event_ends_turn_with_message", () => {
    let s = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "error", message: "boom", status: 500 }), ev({ type: "done" }));
    expect(s.turns[1].error).toEqual({ message: "boom", status: 500, code: undefined });
    expect(s.turns[1].text).toBe("boom");
    expect(s.turns[1].streaming).toBe(false);
    expect(s.status).toBe("error");
    s = run(initialState("c"), ev({ type: "error", message: "late" }));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ role: "assistant", text: "late" });
    expect(s.turns[0].error?.message).toBe("late");
  });

  test("error_after_error_final_attaches_to_same_turn", () => {
    const s = run(initialState("c"), { type: "user_send", text: "fail" },
      ev({ type: "final", text: "ErrorRecord[boom]", finishReason: "error" }),
      ev({ type: "error", message: "ErrorRecord[boom]", code: "N1" }),
      ev({ type: "done" }));
    expect(s.turns).toHaveLength(2);
    expect(s.turns[1]).toMatchObject({ role: "assistant", text: "ErrorRecord[boom]", streaming: false });
    expect(s.turns[1].error?.code).toBe("N1");
    expect(s.status).toBe("error");
  });

  test("wait_event_sets_waiting_and_wait_info", () => {
    const s = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "job", jobId: "j1" }),
      ev({ type: "wait", kind: "HUMAN", token: "tk", message: "Approve?", approval: true, feedback: false }),
      ev({ type: "done" }));
    expect(s.status).toBe("waiting");
    expect(s.turns[1].text).toBe("Approve?");
    expect(s.turns[1].error).toBeUndefined();
    expect(s.wait).toMatchObject({ kind: "HUMAN", token: "tk", jobId: "j1", approval: true, feedback: false });
  });

  test("wait_without_jobId_is_error", () => {
    const s = run(initialState("c"), { type: "user_send", text: "q" },
      ev({ type: "wait", kind: "HUMAN", token: "tk", message: "Approve?", approval: true, feedback: false }),
      ev({ type: "done" }));
    expect(s.wait).toBeUndefined();
    expect(s.status).toBe("error");
    expect(s.turns[1]).toMatchObject({ role: "assistant", streaming: false, error: { message: "wait without jobId" } });
  });

  test("jobId_cleared_per_turn", () => {
    const a = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "job", jobId: "j1" }),
      ev({ type: "final", text: "a", finishReason: "stop" }), ev({ type: "done" }));
    expect(a.jobId).toBe("j1");
    const b = run(a, { type: "user_send", text: "q2" });
    expect("jobId" in b).toBe(false);
    // A wait in the new turn never reuses the job of the previous turn.
    expect(run(b, ev({ type: "wait", kind: "HUMAN", token: "tk", message: "m", approval: true, feedback: false })).wait).toBeUndefined();
    const w = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "job", jobId: "j2" }),
      ev({ type: "wait", kind: "WAIT", token: "tk", message: "Waiting", approval: false, feedback: false, waitMinutes: 1 }), ev({ type: "done" }));
    expect(w.wait?.jobId).toBe("j2");
    expect("jobId" in run(w, { type: "resume_sent", action: "APPROVE_ACTION" })).toBe(false);
    expect("jobId" in run(w, { type: "resume_sent", action: "RFI_ACTION", statusCheckOnly: true })).toBe(false);
  });

  test("done_with_empty_streaming_turn_is_explicit_error", () => {
    const s = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "progress", text: "working" }), ev({ type: "done" }));
    expect(s.turns[1]).toMatchObject({ role: "assistant", text: "", streaming: false, error: { message: "No reply received" } });
    expect(s.status).toBe("error");
    expect(s.progressText).toBeUndefined();
  });

  test("done_with_partial_streaming_turn_is_explicit_error", () => {
    const s = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "delta", text: "Hel" }), ev({ type: "done" }));
    expect(s.turns[1]).toMatchObject({ role: "assistant", text: "Hel", streaming: false, error: { message: "Reply ended before it finished" } });
    expect(s.status).toBe("error");
  });

  test("final_empty_output_keeps_streamed_text", () => {
    const s = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "delta", text: "Hello" }),
      ev({ type: "final", text: "", finishReason: "stop" }), ev({ type: "done" }));
    expect(s.turns[1]).toMatchObject({ text: "Hello", streaming: false });
    expect(s.turns[1].error).toBeUndefined();
    expect(s.status).toBe("idle");
  });

  test("resume_sent_clears_wait_and_adds_user_turn", () => {
    const base = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "job", jobId: "j1" }),
      ev({ type: "wait", kind: "HUMAN", token: "tk", message: "Approve?", approval: true, feedback: true }),
      ev({ type: "followups", questions: ["a"] }));
    expect(base.jobId).toBe("j1");
    expect(base.followups).toEqual(["a"]);
    const a = run(base, { type: "resume_sent", action: "APPROVE_ACTION" });
    expect(a.wait).toBeUndefined();
    expect(a.status).toBe("sending");
    expect(a.followups).toEqual([]);
    expect(a.turns[a.turns.length - 2]).toMatchObject({ role: "user", text: "Approved" });
    expect(run(base, { type: "resume_sent", action: "REJECT_ACTION" }).turns.slice(-2)[0].text).toBe("Rejected");
    expect(run(base, { type: "resume_sent", action: "RFI_ACTION", content: "change x" }).turns.slice(-2)[0].text).toBe("change x");
  });

  test("resume_sent_with_files_shows_them_on_the_reply_turn", () => {
    // A free-text reply may be files alone: the user turn has an empty text and the files.
    const base = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "job", jobId: "j1" }),
      ev({ type: "wait", kind: "HUMAN", token: "tk", message: "Attach the invoice", approval: false, feedback: false }));
    const att = [{ trackerId: "t", fileName: "invoice.pdf", size: 1, mimeType: "application/pdf" }];
    const r = run(base, { type: "resume_sent", action: "RFI_ACTION", content: "", attachments: att });
    expect(r.wait).toBeUndefined();
    expect(r.turns.slice(-2)).toMatchObject([{ role: "user", text: "", attachments: att }, { role: "assistant", text: "", streaming: true }]);
    expect("attachments" in run(base, { type: "resume_sent", action: "RFI_ACTION", content: "x" }).turns.slice(-2)[0]).toBe(false);
  });

  test("resume_sent_status_check_adds_no_user_turn", () => {
    const base = run(initialState("c"), { type: "user_send", text: "q" }, ev({ type: "job", jobId: "j1" }),
      ev({ type: "wait", kind: "WAIT", token: "tk", message: "Waiting", approval: false, feedback: false, waitMinutes: 1 }),
      ev({ type: "done" }));
    const r = run(base, { type: "resume_sent", action: "RFI_ACTION", statusCheckOnly: true });
    expect(r.wait).toBeUndefined();
    expect(r.status).toBe("sending");
    expect(r.turns).toHaveLength(3);
    expect(r.turns[2]).toMatchObject({ id: "t3", role: "assistant", text: "", streaming: true });
    expect(r.nextTurnId).toBe(4);
  });

  test("history_failed_marks_unavailable_with_status", () => {
    const s = run(initialState("c"), { type: "history_failed", status: 500 });
    expect(s.historyStatus).toBe("unavailable");
    expect(s.historyError).toEqual({ status: 500 });
    expect(run(initialState("c"), { type: "history_failed", status: 500, text: "boom" }).historyError).toEqual({ status: 500, text: "boom" });
  });

  test("open_conversation_resets_and_loads", () => {
    const dirty = run(initialState("c"), { type: "auth", state: "relogin" }, { type: "user_send", text: "q" });
    const o = run(dirty, { type: "open_conversation", id: "c2" });
    expect(o).toEqual({ ...initialState("c2"), historyStatus: "loading", authState: "relogin" });
    const l = run(o, { type: "history_loaded", messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }] });
    expect(l.historyStatus).toBe("loaded");
    expect(l.turns.map(t => [t.role, t.text, t.streaming])).toEqual([["user", "a", false], ["assistant", "b", false]]);
    const n = run(l, { type: "new_conversation", id: "c3" });
    expect(n).toEqual({ ...initialState("c3"), authState: "relogin" });
    const d = run(l, ev({ type: "delta", text: "x" }));
    expect(d.turns).toHaveLength(3);
    expect(d.turns[2]).toMatchObject({ role: "assistant", text: "x", streaming: true });
  });

  test("auth_unavailable_carries_reason_across_conversations", () => {
    const s = run(initialState("c"), { type: "auth", state: "unavailable", reason: "xsrf-unavailable" });
    expect(s.authState).toBe("unavailable");
    expect(s.authReason).toBe("xsrf-unavailable");
    expect(run(s, { type: "new_conversation", id: "c2" })).toEqual({ ...initialState("c2"), authState: "unavailable", authReason: "xsrf-unavailable" });
    expect(run(s, { type: "open_conversation", id: "c3" })).toMatchObject({ authState: "unavailable", authReason: "xsrf-unavailable" });
    const r = run(s, { type: "auth", state: "relogin" });
    expect(r.authState).toBe("relogin");
    expect("authReason" in r).toBe(false);
  });

  test("reduce_does_not_mutate_input", () => {
    const s0 = run(initialState("c"), { type: "user_send", text: "q" });
    const snap = JSON.stringify(s0);
    const turnsRef = s0.turns, t1 = s0.turns[1];
    reduce(s0, ev({ type: "delta", text: "zzz" }));
    reduce(s0, ev({ type: "final", text: "f", finishReason: "stop" }));
    reduce(s0, ev({ type: "error", message: "e" }));
    expect(JSON.stringify(s0)).toBe(snap);
    expect(s0.turns).toBe(turnsRef);
    expect(s0.turns[1]).toBe(t1);
  });

  test("newConversationId_uses_randomUUID_and_throws_without_it", () => {
    const g = globalThis as any;
    const orig = Object.getOwnPropertyDescriptor(g, "crypto");
    Object.defineProperty(g, "crypto", { value: { randomUUID: () => "uuid-1" }, configurable: true });
    expect(newConversationId()).toBe("uuid-1");
    Object.defineProperty(g, "crypto", { value: {}, configurable: true });
    expect(() => newConversationId()).toThrow();
    if (orig) Object.defineProperty(g, "crypto", orig); else delete g.crypto;
  });
});
