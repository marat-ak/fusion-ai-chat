import { parseStoredChoice, runStorageKey, sessionRunStorage } from "../run/storage";

test("key_is_scoped_to_the_page_and_what_it_binds", () => {
  expect(runStorageKey("/main-start", {})).toBe("xxx-gnimsys-ai-chat:run:/main-start:agent=-,version=-");
  expect(runStorageKey("/main-start", { workflowCode: "WF_A" })).toBe("xxx-gnimsys-ai-chat:run:/main-start:agent=WF_A,version=-");
  expect(runStorageKey("/p", { version: "DRAFT" })).toBe("xxx-gnimsys-ai-chat:run:/p:agent=-,version=DRAFT");
});

test("round_trip_through_session_storage", () => {
  const key = runStorageKey("/p", {});
  const s = sessionRunStorage(key, () => window.sessionStorage);
  expect(s.read()).toEqual({ kind: "none" });
  s.write({ workflowCode: "WF_A", version: "DRAFT" });
  expect(window.sessionStorage.getItem(key)).toBe('{"workflowCode":"WF_A","version":"DRAFT"}');
  expect(s.read()).toEqual({ kind: "choice", choice: { workflowCode: "WF_A", version: "DRAFT" } });
  s.remove();
  expect(window.sessionStorage.getItem(key)).toBeNull();
});

test("anything_else_stored_is_unreadable", () => {
  for (const raw of ["{nope", "[]", "null", '"x"', '{"workflowCode":""}', '{"version":"LATEST"}', '{"workflowCode":"A","extra":1}', '{"workflowCode":5}']) {
    expect(parseStoredChoice(raw)).toBeNull();
  }
  expect(parseStoredChoice("{}")).toEqual({});
  const key = runStorageKey("/q", {});
  window.sessionStorage.setItem(key, "{nope");
  expect(sessionRunStorage(key, () => window.sessionStorage).read()).toEqual({ kind: "unreadable" });
});
