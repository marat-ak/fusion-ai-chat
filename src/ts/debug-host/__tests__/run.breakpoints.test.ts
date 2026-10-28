/** @jest-environment node */
// The user's breakpoints (bridge design §13, user-set from the inspector): the one set in the run store, the node picker's
// options, and keeping the set in the browser tab's sessionStorage.
import { breakpointKey, readBreakpoints, writeBreakpoints } from "../run/breakpointStorage";
import { editedSet, nodeOptions, parseDefinition } from "../run/definition";
import { RunStore } from "../run/runStore";
import { goldenWorkflow } from "./helpers.run";

/** A Storage over a Map; `fail` makes every call throw (blocked storage). */
function memoryStorage(fail = false): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  const guard = (): void => { if (fail) throw new Error("SecurityError"); };
  return {
    map,
    get length() { return map.size; },
    clear: () => { guard(); map.clear(); },
    getItem: (k: string) => { guard(); return map.get(k) ?? null; },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { guard(); map.delete(k); },
    setItem: (k: string, v: string) => { guard(); map.set(k, v); },
  };
}

test("add_remove_and_an_agent_set_share_one_set_last_writer_wins", () => {
  const store = new RunStore();
  store.addBreakpoint("CODE_04");
  store.addBreakpoint("LLM_01");
  store.addBreakpoint("CODE_04"); // already set: nothing changes
  expect(store.breakPoints()).toEqual(["CODE_04", "LLM_01"]);
  expect(() => store.addBreakpoint("not a code")).toThrow("not a node code: not a code");
  // The agent's message replaces the whole set.
  store.setBreakpoints(["BO_FUNCTION_06"]);
  expect(store.breakPoints()).toEqual(["BO_FUNCTION_06"]);
  store.removeBreakpoint("BO_FUNCTION_06");
  expect(store.breakPoints()).toEqual([]);
});

test("the_picker_offers_every_coded_node_nested_ones_included", () => {
  const options = nodeOptions(parseDefinition(goldenWorkflow()));
  // 72 nodes, all with a code (Studio's ADD placeholders, which have none, would be left out).
  expect(options).toHaveLength(72);
  expect(options[0]).toEqual({ code: "START", label: "START — Start (START)" });
  expect(options.find((o) => o.code === "BO_FUNCTION_22")?.label).toBe("BO_FUNCTION_22 — Bo Function 22 (BO_FUNCTION) · in LOOP_01");
});

test("kept_in_session_storage_per_workflow_and_version_and_rechecked_on_restore", () => {
  const s = memoryStorage();
  const key = breakpointKey("WIZARD_WF", "DRAFT");
  expect(key).toBe("xxx-gnimsys-ai-debug:breakpoints:WIZARD_WF:DRAFT");
  expect(readBreakpoints(s, key)).toBeNull();
  expect(writeBreakpoints(s, key, ["CODE_04", "LLM_01"])).toBe(true);
  expect(readBreakpoints(s, key)).toEqual({ codes: ["CODE_04", "LLM_01"], dropped: null });
  // An empty set removes the key.
  writeBreakpoints(s, key, []);
  expect(s.map.has(key)).toBe(false);
  // A damaged value: the good codes are kept, the rest named; never a silent substitute.
  s.setItem(key, JSON.stringify(["CODE_04", "bad code", "CODE_04", 7]));
  expect(readBreakpoints(s, key)).toEqual({ codes: ["CODE_04"], dropped: 'not node codes or repeated: "bad code", "CODE_04", 7' });
  s.setItem(key, "{nope");
  expect(readBreakpoints(s, key)).toEqual({ codes: [], dropped: "the stored value is not JSON" });
  s.setItem(key, JSON.stringify({ a: 1 }));
  expect(readBreakpoints(s, key)).toEqual({ codes: [], dropped: "the stored value is not a list" });
});

test("without_usable_storage_the_breakpoints_live_in_memory_only", () => {
  const blocked = memoryStorage(true);
  const key = breakpointKey("W", "DRAFT");
  expect(readBreakpoints(blocked, key)).toBeNull();
  expect(writeBreakpoints(blocked, key, ["A"])).toBe(false);
  expect(readBreakpoints(null, key)).toBeNull();
  expect(writeBreakpoints(null, key, ["A"])).toBe(false);
  expect(() => writeBreakpoints(memoryStorage(), key, ["bad code"])).toThrow("not node codes");
});

test("the_node_select_edit_keeps_the_order_of_the_set_and_appends_new_codes", () => {
  expect(editedSet(["A", "B", "C"], new Set(["C", "A", "D"]))).toEqual(["A", "C", "D"]);
  expect(editedSet([], ["X"])).toEqual(["X"]);
  expect(editedSet(["A"], [])).toEqual([]);
});
