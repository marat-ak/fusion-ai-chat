// Reducer parts of the debugger features: run capture events (request/raw) belong to the host's run observer and leave the
// conversation untouched; the 401's own text (auth detail).
import { initialState, reduce, ChatState, ChatAction } from "../state/conversation";

const run = (s: ChatState, ...a: ChatAction[]) => a.reduce(reduce, s);
const ev = (event: any): ChatAction => ({ type: "event", event });

test("capture_events_leave_the_conversation_untouched", () => {
  const base = run(initialState("c"), { type: "user_send", text: "q" });
  const s = run(base,
    ev({ type: "request", endpoint: "debug", path: "/api/fusion-ai/orchestrator/agent/v2/WF/debug", body: { message: "q" }, at: 1 }),
    ev({ type: "raw", payload: "a", at: 2 }));
  expect(s).toBe(base);
  // Without a reply in progress no turn is created for them either.
  const empty = initialState("c");
  expect(run(empty, ev({ type: "raw", payload: "x", at: 3 }))).toBe(empty);
});

test("a_reply_with_capture_events_ends_as_without_them", () => {
  const s = run(initialState("c"), { type: "user_send", text: "q" },
    ev({ type: "raw", payload: "a", at: 1 }), ev({ type: "delta", text: "x" }), ev({ type: "raw", payload: "b", at: 2 }),
    ev({ type: "final", text: "x", finishReason: "stop" }), ev({ type: "raw", payload: "c", at: 3 }), ev({ type: "done" }));
  expect(s.turns).toHaveLength(2);
  expect(s.turns[1]).toEqual({ id: "t2", role: "assistant", text: "x", streaming: false });
  expect(s.status).toBe("idle");
});

test("auth_detail_is_kept_across_conversations_and_replaced_by_the_next_auth_state", () => {
  let s = run(initialState("c"), { type: "auth", state: "relogin", status: 401, detail: "Sign in to dev1 in the agent chat first." });
  expect([s.authState, s.authDetail]).toEqual(["relogin", "Sign in to dev1 in the agent chat first."]);
  s = run(s, { type: "new_conversation", id: "c2" });
  expect(s.authDetail).toBe("Sign in to dev1 in the agent chat first.");
  s = run(s, { type: "auth", state: "relogin" });
  expect(s.authDetail).toBeUndefined();
});
