import { traceGateOpen } from "../trace/gate";

const trace = { roles: ["AGENT_DEBUG"] };

test("gate_closed_without_trace_config", () => expect(traceGateOpen(undefined, ["AGENT_DEBUG"])).toBe(false));
test("gate_closed_without_roles_prop", () => expect(traceGateOpen(trace, undefined)).toBe(false));
test("gate_closed_on_mismatch_and_case", () => {
  expect(traceGateOpen(trace, ["OTHER"])).toBe(false);
  expect(traceGateOpen(trace, ["agent_debug"])).toBe(false);
  expect(traceGateOpen(trace, [])).toBe(false);
});
test("gate_open_on_intersection", () => expect(traceGateOpen(trace, ["OTHER", "AGENT_DEBUG"])).toBe(true));
