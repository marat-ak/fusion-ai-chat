/** @jest-environment node */
import { copyText, CUT_MARK, decode, isCut, search, tree, valueAt } from "../run/decode";
import { diff } from "../run/diff";
import { buildExport, exportFileName, mask, maskPayload, MASK, MASKED_KEYS } from "../run/exporter";
import { RunStore } from "../run/runStore";
import { readPanelMessage } from "../run/panelMessages";
import { goldenTurn, turnOf } from "./helpers.run";

describe("decode (JSON inside JSON strings, Oracle's cut)", () => {
  test("strings_holding_json_are_decoded_to_three_levels_and_marked", () => {
    const inner = JSON.stringify({ response: JSON.stringify({ items: [1, 2] }), responseStatus: 200 });
    const d = decode(JSON.stringify({ output: inner, plain: "text {not json", n: 1 }));
    expect(d.value).toEqual({ output: { response: { items: [1, 2] }, responseStatus: 200 }, plain: "text {not json", n: 1 });
    expect([...d.decodedPaths].sort()).toEqual(["$", "$.output", "$.output.response"]);
    expect(valueAt(d, "$.output.response.items[1]")).toBe(2);
  });

  test("a_cut_value_stays_text_and_is_marked_cut", () => {
    const cut = "{\"items\":[" + "x".repeat(10000 - 10) + CUT_MARK;
    expect(cut.length).toBe(10005);
    expect(isCut(cut)).toBe(true);
    const d = decode({ nodeOutput: cut });
    expect([...d.cutPaths]).toEqual(["$.nodeOutput"]);
    const t = tree(d);
    expect(t.children?.[0]).toMatchObject({ label: "nodeOutput", kind: "cut" });
  });

  test("tree_rows_carry_paths_kinds_and_sizes_and_search_finds_keys_and_values", () => {
    const d = decode({ $variables: { wizardState: JSON.stringify({ step: "ORGS", rows: [{ code: "M1" }] }) }, "odd key": null });
    const t = tree(d);
    expect(t).toMatchObject({ path: "$", kind: "object", text: "{2}" });
    const ws = t.children?.[0].children?.[0];
    expect(ws).toMatchObject({ path: "$.$variables.wizardState", kind: "object", decoded: true });
    expect(t.children?.[1]).toMatchObject({ path: '$["odd key"]', kind: "null" });
    expect(search(t, "orgs")).toEqual(["$.$variables.wizardState.step"]);
    expect(search(t, "rows")).toEqual(["$.$variables.wizardState.rows"]);
    expect(valueAt(d, '$["odd key"]')).toBeNull();
    expect(copyText({ a: 1 })).toBe("{\n  \"a\": 1\n}");
    expect(copyText("x")).toBe("x");
  });

  test("diff_lists_added_removed_and_changed_leaves", () => {
    expect(diff({ a: 1, b: { c: 2 }, gone: true }, { a: 1, b: { c: 3 }, d: [1] })).toEqual([
      { path: "$.b.c", kind: "changed", before: 2, after: 3 },
      { path: "$.d", kind: "added", after: [1] },
      { path: "$.gone", kind: "removed", before: true },
    ]);
    expect(diff([1, 2], [1])).toEqual([{ path: "$[1]", kind: "removed", before: 2 }]);
    expect(diff("", { x: 1 })).toEqual([{ path: "$", kind: "changed", before: "", after: { x: 1 } }]);
  });
});

describe("export (client-only, credentials masked)", () => {
  test("masks_credential_keys_in_bodies_and_inside_json_strings_and_counts_them", () => {
    const count = { n: 0 };
    const v = mask({ resumeInput: { messageInstanceId: "CB-1" }, x: JSON.stringify({ callbackToken: "CB-2", keep: "k" }), access_token: 5 }, count);
    expect(v).toEqual({ resumeInput: { messageInstanceId: MASK }, x: JSON.stringify({ callbackToken: MASK, keep: "k" }), access_token: 5 });
    expect(count.n).toBe(2);
    expect(MASKED_KEYS).toEqual(expect.arrayContaining(["callbackToken", "messageInstanceId", "Authorization", "client_secret"]));
    // A payload without anything to mask stays byte for byte; non-JSON text stays.
    const raw = '{"a" : 1}';
    expect(maskPayload(raw, count)).toBe(raw);
    expect(maskPayload("{nope", count)).toBe("{nope");
    const wait = JSON.stringify({ waitingNodeDetails: { callbackToken: "SECRET" } });
    expect(maskPayload(wait, count)).toBe(JSON.stringify({ waitingNodeDetails: { callbackToken: MASK } }));
  });

  test("the_export_has_every_turn_request_frame_outcome_and_id", () => {
    const t1 = goldenTurn(1);
    const t2 = { ...turnOf([JSON.stringify({ message: { finishReason: "wait", output: "?" }, waitingNodeDetails: { callbackToken: "SECRET" }, jobId: "j-2" })],
      { message: "", conversationId: "c-1", jobId: "j-2", resumeInput: { messageInstanceId: "SECRET-2", userResponse: "APPROVE_ACTION" } }, 2), definitionVersion: { version: "7" } };
    const t3 = { ...turnOf([], { message: "x", conversationId: "c-2" }, 3), error: { message: "HTTP 500", status: 500 } };
    const binding = { pod: "/api/pod/c/u1__x/", instance: "dev1", podUser: "test.user", workflowCode: "WIZARD_WF", version: "DRAFT" };
    const x = buildExport([t1, t2, t3], binding, ["CODE_04"], Date.UTC(2026, 9, 26, 12, 0, 0));
    expect([x.kind, x.formatVersion, x.exportedAt, x.binding, x.breakpoints]).toEqual(["gnimsys-ai-chat-debug-export", 1, "2026-10-26T12:00:00.000Z", binding, ["CODE_04"]]);
    expect(x.conversations.map((c) => [c.conversationId, c.turns.map((t) => t.seq)])).toEqual([["c-1", [1, 2]], ["c-2", [3]]]);
    const [a, b] = x.conversations[0].turns;
    expect(a.frames).toHaveLength(49);
    expect(a.frames[0]).toEqual({ at: new Date(1000).toISOString(), payload: t1.frames[0].payload });
    expect([a.outcome?.finishReason, a.jobId, a.traceIds, a.steps, a.endpoint]).toEqual(["stop", "job-wizard-1", ["0123456789abcdef0123456789abcdef"], 17, "debug"]);
    expect(b.request).toMatchObject({ resumeInput: { messageInstanceId: MASK } });
    expect(b.definitionVersion).toEqual({ version: "7" });
    expect(x.conversations[1].turns[0].error).toEqual({ message: "HTTP 500", status: 500 });
    expect(JSON.stringify(x)).not.toContain("SECRET");
    expect(x.masked).toBe(2);
    expect(exportFileName(binding, Date.UTC(2026, 9, 26, 12, 0, 0))).toBe("debug-WIZARD_WF-DRAFT-2026-10-26T12-00-00-000Z.json");
  });
});

describe("run store (the chat's run observer)", () => {
  test("records_turns_frames_and_ends_and_serves_breakpoints", () => {
    const store = new RunStore();
    let changes = 0;
    store.subscribe(() => changes++);
    const ended: number[] = [];
    store.onTurnEnd = (t) => ended.push(t.seq);
    store.setBreakpoints(["A", "B_2"]);
    expect(store.breakPoints()).toEqual(["A", "B_2"]);
    const sink = store.turn({ conversationId: "c", endpoint: "debug", path: "/p", body: { message: "m" }, at: 5 });
    sink.frame("x", 6);
    sink.end({ at: 7, error: { message: "boom" } });
    sink.frame("late", 8);
    sink.end({ at: 9 });
    expect(store.turns).toEqual([{ seq: 1, conversationId: "c", endpoint: "debug", path: "/p", request: { message: "m" }, sentAt: 5, frames: [{ payload: "x", at: 6 }], endedAt: 7, error: { message: "boom" } }]);
    expect(ended).toEqual([1]);
    expect(changes).toBe(4);
    store.removeBreakpoint("A");
    expect(store.breakpoints).toEqual(["B_2"]);
    expect(() => store.setBreakpoints(["bad code"])).toThrow("not node codes: bad code");
    expect(() => store.setBreakpoints(["A", "A"])).toThrow("given twice: A");
    expect(store.breakpoints).toEqual(["B_2"]);
  });

  test("clear_forgets_turns_and_drops_late_frames_of_a_cleared_turn", () => {
    const store = new RunStore();
    const sink = store.turn({ conversationId: "c", endpoint: "debug", path: "/p", body: {}, at: 1 });
    store.clear();
    sink.frame("x", 2);
    sink.end({ at: 3 });
    expect(store.turns).toEqual([]);
    const next = store.turn({ conversationId: "c2", endpoint: "debug", path: "/p", body: {}, at: 4 });
    next.end({ at: 5 });
    expect(store.turns.map((t) => t.seq)).toEqual([2]);
  });
});

describe("panel messages (the agent's side_panel_message)", () => {
  const parent = { name: "parent" };
  const self = { origin: "https://agents.example.com", parent, window: { name: "self" } };
  const msg = (message: unknown, extra: Record<string, unknown> = {}) => ({
    origin: self.origin, source: parent, data: { gnimsys: "side-panel-message", id: "ai-chat-debug", message, ...extra },
  });

  test("accepts_export_reset_and_breakpoints", () => {
    expect(readPanelMessage(msg({ type: "export" }), self)).toEqual({ kind: "ok", id: "ai-chat-debug", message: { type: "export" } });
    expect(readPanelMessage(msg({ type: "reset", export: "true" }), self)).toMatchObject({ kind: "ok", message: { type: "reset", export: true } });
    expect(readPanelMessage(msg({ type: "reset", export: "false" }), self)).toMatchObject({ kind: "ok", message: { type: "reset", export: false } });
    expect(readPanelMessage(msg({ type: "breakpoints", nodes: "CODE_04,LLM_07" }), self)).toMatchObject({ kind: "ok", message: { type: "breakpoints", nodes: ["CODE_04", "LLM_07"] } });
    expect(readPanelMessage(msg({ type: "breakpoints", nodes: "" }), self)).toMatchObject({ kind: "ok", message: { type: "breakpoints", nodes: [] } });
  });

  test("ignores_what_is_not_ours", () => {
    expect(readPanelMessage({ ...msg({ type: "export" }), origin: "https://evil.example.com" }, self)).toEqual({ kind: "ignored" });
    expect(readPanelMessage({ ...msg({ type: "export" }), source: { other: true } }, self)).toEqual({ kind: "ignored" });
    expect(readPanelMessage({ origin: self.origin, source: parent, data: { type: "export" } }, self)).toEqual({ kind: "ignored" });
    // A page that is not framed has no parent to accept messages from.
    const top = { ...self, parent: self.window };
    expect(readPanelMessage({ ...msg({ type: "export" }), source: self.window }, top)).toEqual({ kind: "ignored" });
  });

  test("refuses_our_messages_with_a_bad_shape", () => {
    const reason = (m: unknown, extra: Record<string, unknown> = {}) => {
      const r = readPanelMessage(msg(m, extra), self);
      return r.kind === "refused" ? r.reason : r.kind;
    };
    expect(reason({ type: "export" }, { id: "" })).toBe("the panel message has no id");
    expect(reason("export")).toBe("the panel message has no message.type");
    expect(reason({ type: "export", x: "1" })).toBe('unknown field x in "export"');
    expect(reason({ type: "reset" })).toBe('"reset" needs export');
    expect(reason({ type: "reset", export: true })).toBe('export must be a string in "reset"');
    expect(reason({ type: "reset", export: "yes" })).toBe('"reset" export must be "true" or "false"');
    expect(reason({ type: "breakpoints", nodes: "A B" })).toBe('"breakpoints" nodes must be "" or node codes separated by commas');
    expect(reason({ type: "open" })).toBe('unknown panel message type "open"');
  });
});
