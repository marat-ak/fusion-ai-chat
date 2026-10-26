/** @jest-environment node */
import { durationText, previousWithContext, requestedBreakpoints, runView, turnInput, variablesOf } from "../run/frames";
import { diff } from "../run/diff";
import { finalFrame, goldenTurn, node, turnOf } from "./helpers.run";

describe("golden turns (real /debug streams, sanitized)", () => {
  test("turn_1_reads_as_17_steps_in_completion_order_with_pairs_and_singles", () => {
    const run = runView(goldenTurn(1));
    expect(run.problems).toEqual([]);
    expect(run.occurrences.map((o) => `${o.step}:${o.nodeCode}:${o.kind}`)).toEqual([
      "1:START:single", "2:SET_FIELDS_01:single", "3:CODE_01:single", "4:CODE_02:single", "5:CONDITION_01:single",
      "6:CODE_04:single", "7:BO_FUNCTION_06:pair", "8:BO_FUNCTION_07:pair", "9:CODE_05:single", "10:CODE_06:single",
      "11:CODE_07:single", "12:SWITCH_01:pair", "13:BO_FUNCTION_08:pair", "14:CODE_09:single", "15:SET_FIELDS_02:single",
      "16:CONDITION_02:single", "17:LLM_07:pair",
    ]);
    // 22 node frames (12 single + 5 pairs): the old trace panel counted frames; steps count runs of a node.
    expect(run.metrics).toEqual({ steps: 17, nodeTimeMs: 5796, llmCalls: 1, functionCalls: 3, tokensIn: 410, tokensOut: 285, cutValues: 2 });
    expect([run.final?.finishReason, run.jobId, run.traceIds]).toEqual(["stop", "job-wizard-1", ["0123456789abcdef0123456789abcdef"]]);
    // The streamed LLM text is the final output (the LLM node's output).
    expect(run.text).toBe(run.final?.output);
    expect(run.occurrences[16].output).toBe(run.final?.output);
  });

  test("durations_are_exact_for_pairs_upper_bounds_for_singles_none_for_the_first", () => {
    const run = runView(goldenTurn(1));
    const [first, second] = run.occurrences;
    expect([first.durationKind, first.durationMs]).toEqual(["none", undefined]);
    expect(second.durationKind).toBe("upper-bound");
    expect(durationText(second)).toMatch(/^≤ \d+ ms$/);
    const bo = run.occurrences.find((o) => o.nodeCode === "BO_FUNCTION_06");
    expect(bo?.durationKind).toBe("exact");
    expect(bo?.durationMs).toBe((bo?.end?.timeStamp as number) - (bo?.start?.timeStamp as number));
  });

  test("cut_values_and_branches_are_read_from_outputs", () => {
    const run = runView(goldenTurn(1));
    expect(run.occurrences.filter((o) => o.cut).map((o) => o.nodeCode)).toEqual(["BO_FUNCTION_08", "CODE_09"]);
    expect(run.occurrences.find((o) => o.nodeCode === "CONDITION_01")?.output).toBe("false");
    expect(run.occurrences.find((o) => o.nodeCode === "SWITCH_01")?.output).toBe("CASE_02");
  });

  test("variables_diff_shows_what_a_node_set", () => {
    const run = runView(goldenTurn(1));
    const save = run.occurrences.find((o) => o.nodeCode === "SET_FIELDS_02");
    if (save === undefined) throw new Error("no SET_FIELDS_02");
    const prev = previousWithContext(run, save);
    expect(prev?.nodeCode).toBe("CODE_09");
    const changes = diff(variablesOf(prev as typeof save), variablesOf(save));
    // The node stored the wizard state (a JSON string, decoded): its fields appear.
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.path.startsWith("$.wizardState"))).toBe(true);
    expect(changes.every((c) => c.path.startsWith("$.wizardState") || c.path.startsWith("$.followupOptions") || c.path.startsWith("$.llmGUI"))).toBe(true);
  });

  test("turn_2_carries_the_state_of_turn_1_and_reads_as_24_steps", () => {
    const run = runView(goldenTurn(2, { message: "Move 5 units", workflowCode: "WIZARD_WF", conversationId: "c-1" }));
    expect(run.metrics.steps).toBe(24);
    expect(run.metrics.cutValues).toBe(3);
    expect([run.metrics.llmCalls, run.metrics.functionCalls]).toEqual([2, 8]);
    expect(run.occurrences[0].context).toContain("wizardState");
  });
});

describe("frame model edge cases", () => {
  test("an_end_without_start_is_single_and_a_start_without_end_is_open_without_a_step", () => {
    const run = runView(turnOf([
      node("NODE_START", "A", { timeStamp: 10, nodeInput: "{\"q\":1}" }),
      node("NODE_END", "B", { timeStamp: 20, nodeOutput: "x" }),
    ]));
    expect(run.occurrences.map((o) => [o.step, o.nodeCode, o.kind])).toEqual([[1, "B", "single"], [null, "A", "open"]]);
    expect(run.occurrences[1].input).toBe("{\"q\":1}");
  });

  test("child_frames_read_as_plain_types_and_pair_by_parent_and_loop_index", () => {
    const run = runView(turnOf([
      node("NODE_START", "LOOP_1", { timeStamp: 1 }),
      node("CHILD_NODE_START", "X", { timeStamp: 2, parentNodeCode: "LOOP_1", loopIndex: 0 }),
      node("CHILD_NODE_START", "X", { timeStamp: 3, parentNodeCode: "LOOP_1", loopIndex: 1 }),
      node("CHILD_NODE_END", "X", { timeStamp: 5, parentNodeCode: "LOOP_1", loopIndex: 0 }),
      node("CHILD_NODE_END", "X", { timeStamp: 7, parentNodeCode: "LOOP_1", loopIndex: 1 }),
      node("NODE_END", "LOOP_1", { timeStamp: 9 }),
    ]));
    expect(run.occurrences.map((o) => [o.step, o.nodeCode, o.loopIndex, o.child, o.durationMs])).toEqual([
      [1, "X", 0, true, 3], [2, "X", 1, true, 4], [3, "LOOP_1", undefined, false, 8],
    ]);
  });

  test("bad_frames_are_listed_not_fatal_and_a_wait_keeps_no_credential", () => {
    const run = runView(turnOf([
      "{nope", "[1]", JSON.stringify({ surprise: true }),
      JSON.stringify({ message: { finishReason: "wait", output: "" }, waitingNodeDetails: { type: "HUMAN", code: "ASK", initialMessage: "Approve?", callbackToken: "SECRET" }, jobId: "j" }),
    ]));
    expect(run.problems.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(run.wait).toEqual({ type: "HUMAN", code: "ASK", message: "Approve?" });
    expect(JSON.stringify(run.wait)).not.toContain("SECRET");
  });

  test("an_error_end_names_the_error_node_when_the_frame_does", () => {
    const run = runView(turnOf([node("NODE_EXECUTED", "A"), finalFrame("error", "ErrorRecord[x]", { errorNodeCode: "A" })]));
    expect([run.final?.finishReason, run.errorNodeCode]).toEqual(["error", "A"]);
  });

  test("paused_reads_the_paused_node", () => {
    const run = runView(turnOf([JSON.stringify({ message: { finishReason: "paused", output: "o", pausedNode: " B " } })]));
    expect(run.final?.pausedNode).toBe("B");
  });

  test("turn_input_and_requested_breakpoints_come_from_the_request", () => {
    expect(turnInput(turnOf([], { message: "hello" }))).toBe("hello");
    expect(turnInput(turnOf([], { message: "", resumeInput: { userResponse: "APPROVE_ACTION" } }))).toBe("Approve");
    expect(requestedBreakpoints(turnOf([], { debugParams: { isDebug: true, breakPoints: ["A", "B"] } }))).toEqual(["A", "B"]);
    expect(requestedBreakpoints(turnOf([], { message: "x" }))).toEqual([]);
  });
});
