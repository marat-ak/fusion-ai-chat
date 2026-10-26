import { checkInputs } from "../config/checkInputs";

const cfg = { mode: "chat", agent: { workflowCode: "WF" }, auth: { kind: "fusionShell" }, protocol: { checkVersion: "2607100" } };
const filesCfg = { ...cfg, protocol: { checkVersion: "2607100", hcmRestBase: "/hcmRestApi/x" }, files: { enabled: true } };
const RH = { get: () => ({}) };
const EP = { FUAI: "scFUAI", BOSS: "scBOSS" };
const paths = (r: ReturnType<typeof checkInputs>) => (r.ok ? [] : r.problems.map((p) => p.path));

test("ok_with_userName_and_no_roles", () => expect(checkInputs(cfg, { userName: "u" }, undefined, RH, EP).ok).toBe(true));
test("needs_input_when_user_missing", () => {
  const r = checkInputs(cfg, undefined, undefined, RH, EP);
  expect(r.ok === false && r.kind).toBe("needs-input");
  expect(paths(r)).toEqual(["user.userName"]);
});
test("needs_input_when_userName_empty_or_not_string", () => {
  expect(paths(checkInputs(cfg, { userName: "" }, undefined, RH, EP))).toEqual(["user.userName"]);
  expect(paths(checkInputs(cfg, { userName: 5 as unknown as string }, undefined, RH, EP))).toEqual(["user.userName"]);
});
test("invalid_when_roles_not_string_array", () => {
  const r = checkInputs(cfg, { userName: "u", roles: "x" as unknown as string[] }, undefined, RH, EP);
  expect(r.ok === false && r.kind).toBe("invalid");
  expect(paths(r)).toEqual(["user.roles"]);
  expect(paths(checkInputs(cfg, { userName: "u", roles: [1] as unknown as string[] }, undefined, RH, EP))).toEqual(["user.roles"]);
});
test("person_id_is_optional_with_files_but_never_empty", () => {
  // Without person-id the conversation row goes without PersonId (Studio's own clients send none on /debug).
  expect(checkInputs(filesCfg, { userName: "u" }, undefined, RH, { ...EP, FA: "scFA" }).ok).toBe(true);
  expect(checkInputs(filesCfg, { userName: "u" }, "300", RH, { ...EP, FA: "scFA" }).ok).toBe(true);
  const r = checkInputs(filesCfg, { userName: "u" }, "", RH, { ...EP, FA: "scFA" });
  expect(r).toEqual({ ok: false, kind: "invalid", problems: [{ path: "person-id", message: "must be a non-empty string when given" }] });
  // Files still need the FA endpoint.
  expect(paths(checkInputs(filesCfg, { userName: "u" }, undefined, RH, EP))).toEqual(["endpoint.FA"]);
});
test("run_observer_must_have_both_methods", () => {
  const observer = { breakPoints: () => [], turn: () => ({ frame: () => undefined, end: () => undefined }) };
  expect(checkInputs(cfg, { userName: "u" }, undefined, RH, EP, observer).ok).toBe(true);
  expect(checkInputs(cfg, { userName: "u" }, undefined, RH, EP, null).ok).toBe(true);
  const r = checkInputs(cfg, { userName: "u" }, undefined, RH, EP, { turn: () => undefined });
  expect(r).toEqual({ ok: false, kind: "invalid", problems: [{ path: "run-observer", message: "must be an object with breakPoints() and turn() (debug hosts)" }] });
});

describe("rest-helper and endpoint map", () => {
  test("needs_input_lists_missing_rest_helper_and_endpoint_names", () => {
    const r = checkInputs(cfg, { userName: "u" }, undefined, undefined, undefined);
    expect(r).toEqual({
      ok: false, kind: "needs-input", problems: [
        { path: "rest-helper", message: "required" },
        { path: "endpoint.FUAI", message: "required" },
        { path: "endpoint.BOSS", message: "required" },
      ],
    });
  });
  test("missing_names_are_listed_one_by_one", () => {
    expect(checkInputs(cfg, { userName: "u" }, undefined, RH, { FUAI: "scFUAI" })).toEqual({
      ok: false, kind: "needs-input", problems: [{ path: "endpoint.BOSS", message: "required" }],
    });
  });
  test("files_need_the_FA_endpoint", () => {
    expect(checkInputs(filesCfg, { userName: "u" }, "300", RH, EP)).toEqual({
      ok: false, kind: "needs-input", problems: [{ path: "endpoint.FA", message: "required when files.enabled" }],
    });
    expect(checkInputs(filesCfg, { userName: "u" }, "300", RH, { ...EP, FA: "scFA" }).ok).toBe(true);
  });
  test("extra_contract_names_are_accepted", () => {
    const all = { FA: "a", FUAI: "b", BOSS: "c", SAASBATCH: "d", KM: "e", SALESCOMMON: "f" };
    expect(checkInputs(cfg, { userName: "u" }, undefined, RH, all).ok).toBe(true);
  });
  test("a_rest_helper_without_get_is_invalid", () => {
    for (const rh of [{}, "x", 5, { get: "no" }]) {
      const r = checkInputs(cfg, { userName: "u" }, undefined, rh, EP);
      expect(r).toEqual({ ok: false, kind: "invalid", problems: [{ path: "rest-helper", message: "must be a VB RestHelper (get(endpointId))" }] });
    }
  });
  test("an_endpoint_map_that_is_not_an_object_is_invalid", () => {
    for (const ep of ["FUAI", ["FUAI"], 5]) {
      const r = checkInputs(cfg, { userName: "u" }, undefined, RH, ep);
      expect(r).toEqual({ ok: false, kind: "invalid", problems: [{ path: "endpoint", message: "must be an object: endpoint name -> VB endpoint id" }] });
    }
  });
  test("unknown_names_and_bad_ids_are_invalid", () => {
    const r = checkInputs(cfg, { userName: "u" }, undefined, RH, { ...EP, fuai: "x", FA: "", KM: 3 });
    expect(r.ok === false && r.kind).toBe("invalid");
    expect(r.ok === false && r.problems).toEqual([
      { path: "endpoint.fuai", message: "unknown endpoint name (FA, FUAI, BOSS, SAASBATCH, KM, SALESCOMMON)" },
      { path: "endpoint.FA", message: "must be a non-empty string" },
      { path: "endpoint.KM", message: "must be a non-empty string" },
    ]);
  });
  test("config_problems_come_first", () => {
    const r = checkInputs({ ...cfg, protocol: {} }, { userName: "u" }, undefined, undefined, EP);
    expect(paths(r)).toEqual(["protocol.checkVersion", "rest-helper"]);
  });
});
