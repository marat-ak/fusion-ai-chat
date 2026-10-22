import { checkInputs } from "../config/checkInputs";

const cfg = { agent: { workflowCode: "WF", pod: "p" }, auth: { kind: "fusionShell" }, protocol: { checkVersion: "2607100" } };
const paths = (r: ReturnType<typeof checkInputs>) => (r.ok ? [] : r.problems.map((p) => p.path));

test("ok_with_userName_and_no_roles", () => expect(checkInputs(cfg, { userName: "u" }, undefined).ok).toBe(true));
test("needs_input_when_user_missing", () => {
  const r = checkInputs(cfg, undefined, undefined);
  expect(r.ok === false && r.kind).toBe("needs-input");
  expect(paths(r)).toEqual(["user.userName"]);
});
test("needs_input_when_userName_empty_or_not_string", () => {
  expect(paths(checkInputs(cfg, { userName: "" }, undefined))).toEqual(["user.userName"]);
  expect(paths(checkInputs(cfg, { userName: 5 as unknown as string }, undefined))).toEqual(["user.userName"]);
});
test("invalid_when_roles_not_string_array", () => {
  const r = checkInputs(cfg, { userName: "u", roles: "x" as unknown as string[] }, undefined);
  expect(r.ok === false && r.kind).toBe("invalid");
  expect(paths(r)).toEqual(["user.roles"]);
  expect(paths(checkInputs(cfg, { userName: "u", roles: [1] as unknown as string[] }, undefined))).toEqual(["user.roles"]);
});
test("person_id_still_required_with_files", () => {
  expect(paths(checkInputs({ ...cfg, files: { enabled: true } }, { userName: "u" }, undefined))).toContain("person-id");
});
