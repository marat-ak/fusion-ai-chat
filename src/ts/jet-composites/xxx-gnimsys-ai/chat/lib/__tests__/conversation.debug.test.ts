// Reducer parts of the debugger features: raw frames per reply (ui.debug.rawFrames) and the 401's own text (auth detail).
import { initialState, reduce, ChatState, ChatAction } from "../state/conversation";

const run = (s: ChatState, ...a: ChatAction[]) => a.reduce(reduce, s);
const ev = (event: any): ChatAction => ({ type: "event", event });

test("raw_frames_append_to_the_reply_in_progress_also_after_its_final", () => {
  const s = run(initialState("c"), { type: "user_send", text: "q" },
    ev({ type: "raw", payload: "a" }), ev({ type: "delta", text: "x" }), ev({ type: "raw", payload: "b" }),
    ev({ type: "final", text: "x", finishReason: "stop" }), ev({ type: "raw", payload: "c" }), ev({ type: "done" }));
  expect(s.turns).toHaveLength(2);
  expect(s.turns[1]).toMatchObject({ role: "assistant", text: "x", streaming: false, raw: ["a", "b", "c"] });
  expect(s.turns[1].error).toBeUndefined();
  expect(s.status).toBe("idle");
});

test("each_reply_keeps_its_own_raw_frames", () => {
  const s = run(initialState("c"),
    { type: "user_send", text: "1" }, ev({ type: "raw", payload: "r1" }), ev({ type: "final", text: "a", finishReason: "stop" }), ev({ type: "done" }),
    { type: "user_send", text: "2" }, ev({ type: "raw", payload: "r2" }), ev({ type: "final", text: "b", finishReason: "stop" }), ev({ type: "done" }));
  expect(s.turns.map((t) => t.raw)).toEqual([undefined, ["r1"], undefined, ["r2"]]);
});

test("raw_frame_without_a_reply_creates_the_streaming_turn", () => {
  const s = run(initialState("c"), ev({ type: "raw", payload: "x" }));
  expect(s.turns).toEqual([{ id: "t1", role: "assistant", text: "", streaming: true, raw: ["x"] }]);
});

test("auth_detail_is_kept_across_conversations_and_replaced_by_the_next_auth_state", () => {
  let s = run(initialState("c"), { type: "auth", state: "relogin", status: 401, detail: "Sign in to dev1 in the agent chat first." });
  expect([s.authState, s.authDetail]).toEqual(["relogin", "Sign in to dev1 in the agent chat first."]);
  s = run(s, { type: "new_conversation", id: "c2" });
  expect(s.authDetail).toBe("Sign in to dev1 in the agent chat first.");
  s = run(s, { type: "auth", state: "relogin" });
  expect(s.authDetail).toBeUndefined();
});
