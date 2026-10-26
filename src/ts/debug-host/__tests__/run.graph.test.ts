/** @jest-environment node */
import { DefinitionError, definitionUrl, drawable, parseDefinition } from "../run/definition";
import { CARD, graphGeometry } from "../run/graphLayout";
import { runOnGraph } from "../run/graphRun";
import { breakpointVerdict, nextOf, parseBreakpointNodes } from "../run/breakpoints";
import { runView } from "../run/frames";
import { finalFrame, goldenTurn, goldenWorkflow, node, payloadsOf, fixture, turnOf } from "./helpers.run";

const golden = () => parseDefinition(goldenWorkflow());

describe("definition (the BOSS workflows row)", () => {
  test("golden_workflow_parses_with_studio_positions_nested_loop_and_error_edges", () => {
    const def = golden();
    expect([def.workflowCode, def.status, def.version, def.orientation]).toEqual(["WIZARD_WF", "DRAFT", "7", "vertical"]);
    expect(def.nodes).toHaveLength(72);
    expect(def.layout).toEqual({ ok: true });
    const loop = def.byCode.get("LOOP_01");
    expect([loop?.type, loop?.width, loop?.height, loop?.bodyEntryId]).toEqual(["LOOP", 790, 641, "start_40"]);
    expect(def.nodes.filter((n) => n.parentId === loop?.id).map((n) => n.code)).toEqual(["START_2", "BO_FUNCTION_22", "CODE_13", "CODE_14", "END"]);
    // 29 top-level error paths + one inside the loop body.
    expect(def.edges.filter((e) => e.kind === "error")).toHaveLength(30);
    const cond = def.byCode.get("CONDITION_01");
    expect(def.edges.filter((e) => e.from === cond?.id).map((e) => [e.label, def.byId.get(e.to)?.code])).toEqual([["true", "LLM_01"], ["false", "CODE_04"]]);
  });

  test("an_end_without_position_is_not_drawn_nor_its_edges", () => {
    const def = golden();
    const { nodes, edges } = drawable(def);
    // The loop body's END has no Studio position (Studio does not draw it): 71 drawn.
    expect(nodes).toHaveLength(71);
    expect(nodes.some((n) => n.code === "END")).toBe(false);
    expect(edges.every((e) => nodes.some((n) => n.id === e.to))).toBe(true);
  });

  test("a_specification_object_is_accepted_like_a_string", () => {
    const row = goldenWorkflow();
    const def = parseDefinition({ ...row, specification: JSON.parse(row.specification as string) });
    expect(def.nodes).toHaveLength(72);
  });

  test("nodes_without_studio_positions_mean_no_layout", () => {
    const spec = JSON.parse(goldenWorkflow().specification as string);
    delete spec.dataPipeline.pipelineNodes[3].diagram;
    const def = parseDefinition({ ...goldenWorkflow(), specification: spec });
    expect(def.layout).toEqual({ ok: false, missing: [spec.dataPipeline.pipelineNodes[3].code] });
    expect(() => graphGeometry(def)).toThrow("no Studio positions");
  });

  test("bad_rows_are_refused_with_a_reason", () => {
    expect(() => parseDefinition(null)).toThrow(DefinitionError);
    expect(() => parseDefinition({ workflowCode: "W", status: "DRAFT" })).toThrow("the workflow row has no specification");
    expect(() => parseDefinition({ workflowCode: "W", status: "DRAFT", specification: "{no" })).toThrow("the specification is not JSON");
    expect(() => parseDefinition({ workflowCode: "W", status: "DRAFT", specification: { dataPipeline: {} } })).toThrow("no dataPipeline.pipelineNodes");
    const dup = { workflowCode: "W", status: "DRAFT", specification: { dataPipeline: { pipelineNodes: [{ id: "1", code: "A", type: "CODE" }, { id: "2", code: "A", type: "CODE" }] } } };
    expect(() => parseDefinition(dup)).toThrow("node code A appears twice");
  });

  test("the_query_is_the_clis_filter_quoted", () => {
    expect(decodeURIComponent(definitionUrl("A'B", "DRAFT"))).toBe(
      "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$fields=workflowCode,status,version,specification&$filter=workflowCode='A''B' and status='DRAFT'",
    );
  });
});

describe("geometry (Studio x/y, no own layout)", () => {
  test("cards_sit_at_studio_positions_and_a_loop_keeps_its_box", () => {
    const def = golden();
    const geo = graphGeometry(def);
    const start = def.byCode.get("START");
    expect(geo.nodes.find((n) => n.id === start?.id)).toEqual({ id: "start", x: start?.x, y: start?.y, width: CARD.width, height: CARD.height, container: false });
    const loop = geo.nodes.find((n) => n.id === def.byCode.get("LOOP_01")?.id);
    expect([loop?.width, loop?.height, loop?.container]).toEqual([790, 641, true]);
    // Every edge has an orthogonal route (even number of coordinates, at least two points).
    for (const e of geo.edges) expect(e.points.length % 2 === 0 && e.points.length >= 4).toBe(true);
  });
});

describe("the run on the graph", () => {
  test("golden_turn_marks_its_17_nodes_with_steps_and_the_taken_edges", () => {
    const def = golden();
    const run = runView(goldenTurn(1));
    const g = runOnGraph(def, run, [], null);
    expect(g.unknownCodes).toEqual([]);
    const done = [...g.views.values()].filter((v) => v.steps.length > 0);
    expect(done).toHaveLength(17);
    expect(g.views.get(def.byCode.get("CODE_09")?.id as string)?.state).toBe("cut");
    expect(g.views.get(def.byCode.get("LLM_07")?.id as string)).toMatchObject({ state: "done", steps: [17] });
    expect(g.views.get(def.byCode.get("LLM_01")?.id as string)?.state).toBe("not-run");
    // The false branch of CONDITION_01 was taken, not the true one.
    const cond = def.byCode.get("CONDITION_01")?.id as string;
    expect(g.taken.has(`${cond}>false`)).toBe(true);
    expect(g.taken.has(`${cond}>true`)).toBe(false);
    expect(g.taken.size).toBe(16);
  });

  test("codes_the_definition_lacks_are_reported", () => {
    const def = golden();
    const run = runView(turnOf([node("NODE_EXECUTED", "START"), node("NODE_EXECUTED", "RENAMED_NODE")]));
    expect(runOnGraph(def, run, ["CODE_01"], null).unknownCodes).toEqual(["RENAMED_NODE"]);
    expect(runOnGraph(def, run, ["CODE_01"], null).views.get(def.byCode.get("CODE_01")?.id as string)?.breakpoint).toBe(true);
  });
});

describe("breakpoint verdict (fai_workflow_run's rule)", () => {
  /** Turn 1 cut before `code`, as the mock pod (and Oracle) stops: frames before its first frame, output = last output. */
  function stoppedBefore(code: string) {
    const frames = payloadsOf(fixture("debug-wizard-turn1.sse")).map((p) => JSON.parse(p));
    const at = frames.findIndex((f) => f.nodeProgressMessage?.nodeCode === code);
    const kept = frames.slice(0, at).filter((f) => f.nodeProgressMessage !== undefined);
    const last = [...kept].reverse().find((f) => f.nodeProgressMessage.type !== "NODE_START");
    return turnOf([...kept.map((f) => JSON.stringify(f)), finalFrame("stop", last.nodeProgressMessage.nodeOutput)],
      { message: "start", debugParams: { isDebug: true, breakPoints: [code] } });
  }

  test("a_stop_before_a_direct_successor_is_verified", () => {
    const v = breakpointVerdict(runView(stoppedBefore("CODE_04")), golden());
    expect(v).toEqual({ requested: ["CODE_04"], notExecuted: ["CODE_04"], lastExecuted: "CONDITION_01", stop: { verified: true, before: ["CODE_04"], paused: false } });
  });

  test("without_the_graph_the_stop_is_unverified", () => {
    const v = breakpointVerdict(runView(stoppedBefore("CODE_04")), null);
    expect(v?.stop).toMatchObject({ verified: false });
    expect(v?.stop?.verified === false && v.stop.reason).toContain("without the workflow graph");
  });

  test("a_normal_finish_that_never_reached_the_node_is_unverified", () => {
    // LLM_01 is on the true branch; turn 1 went false and finished with the LLM's reply.
    const t = goldenTurn(1, { message: "start", debugParams: { isDebug: true, breakPoints: ["LLM_01"] } });
    const v = breakpointVerdict(runView(t), golden());
    expect(v?.notExecuted).toEqual(["LLM_01"]);
    expect(v?.stop).toMatchObject({ verified: false });
  });

  test("no_breakpoints_no_verdict_and_executed_breakpoints_no_stop", () => {
    expect(breakpointVerdict(runView(goldenTurn(1)), golden())).toBeNull();
    const t = goldenTurn(1, { message: "start", debugParams: { isDebug: true, breakPoints: ["CODE_01"] } });
    expect(breakpointVerdict(runView(t), golden())).toEqual({ requested: ["CODE_01"], notExecuted: [], lastExecuted: "LLM_07" });
  });

  test("next_of_includes_a_successor_loops_body_entry", () => {
    const def = golden();
    const sw = def.byCode.get("SWITCH_01")?.code as string;
    expect(nextOf(def, sw, ["START_2", "LOOP_01", "CODE_01"]).sort()).toEqual(["LOOP_01", "START_2"]);
  });

  test("breakpoint_nodes_field_parses_or_refuses", () => {
    expect(parseBreakpointNodes("")).toEqual([]);
    expect(parseBreakpointNodes("A,B_2")).toEqual(["A", "B_2"]);
    expect(() => parseBreakpointNodes("A,,B")).toThrow("node codes separated by commas");
    expect(() => parseBreakpointNodes("A B")).toThrow();
    expect(() => parseBreakpointNodes("A,A")).toThrow("nodes names A twice");
  });
});
