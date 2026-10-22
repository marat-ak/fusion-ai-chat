import { validateConfig, parseConfigProp } from "../config/validate";

const min = {
  agent: { workflowCode: "WF_1", pod: "https://pod.example.com" },
  auth: { kind: "fusionShell" },
  protocol: { checkVersion: "2607100" },
};

test("minimal valid config is ok", () => {
  expect(validateConfig(min).ok).toBe(true);
});

test("missing workflowCode is needs-input", () => {
  const r = validateConfig({ ...min, agent: { pod: "https://pod.example.com" } });
  expect(r).toMatchObject({ ok: false, kind: "needs-input", problems: [{ path: "agent.workflowCode" }] });
});

test("unknown top-level key is invalid", () => {
  const r = validateConfig({ ...min, foo: 1 });
  expect(r).toMatchObject({ ok: false, kind: "invalid" });
  expect((r as any).problems.map((p: any) => p.path)).toContain("foo");
});

test("auth.kind vb is invalid in v1.0", () => {
  const r = validateConfig({ ...min, auth: { kind: "vb" } });
  expect(r).toMatchObject({ ok: false, kind: "invalid" });
  expect((r as any).problems.map((p: any) => p.path)).toContain("auth.kind");
});

test("files.enabled without protocol.hcmRestBase is needs-input", () => {
  const r = validateConfig({ ...min, files: { enabled: true } });
  expect(r).toMatchObject({ ok: false, kind: "needs-input", problems: [{ path: "protocol.hcmRestBase" }] });
});

test("optional defaults are applied", () => {
  const r = validateConfig(min);
  if (!r.ok) throw new Error("expected ok");
  const cfg = r.config;
  expect(cfg.files.maxFiles).toBe(5);
  expect(cfg.files.maxSizeMB).toBe(50);
  expect(cfg.files.enabled).toBe(false);
  expect(cfg.files.accept).toContain("image/*");
  expect(cfg.ui.starterQuestions).toBe("fromWorkflow");
  expect(cfg.ui.conversations).toBe(true);
  expect(cfg.ui.viewer).toBe(false);
  expect(cfg.datasources).toEqual({ allowInline: false, allowPrefixes: [] });
  expect(cfg.submit.envelope).toBe("gnimsysSubmit");
  expect(cfg.history.kind).toBe("oracle");
});

test("parseConfigProp parses JSON string and returns {} for undefined", () => {
  expect(parseConfigProp('{"a":1}')).toEqual({ a: 1 });
  expect(parseConfigProp(undefined)).toEqual({});
  expect(parseConfigProp({ b: 2 })).toEqual({ b: 2 });
  const bad = parseConfigProp("{nope");
  expect(validateConfig(bad)).toMatchObject({ ok: false, kind: "invalid", problems: [{ path: "" }] });
});

test("wrong type and mixed problems are invalid and list everything", () => {
  const r = validateConfig({ ...min, agent: { pod: 5 }, ui: { viewer: "yes", zzz: 1 } });
  expect(r).toMatchObject({ ok: false, kind: "invalid" });
  const paths = (r as any).problems.map((p: any) => p.path);
  expect(paths).toEqual(expect.arrayContaining(["agent.workflowCode", "agent.pod", "ui.viewer", "ui.zzz"]));
});

describe("ui.trace", () => {
  const withTrace = (trace: unknown) => validateConfig({ ...min, ui: { trace } });
  test("absent means no trace in the config", () => {
    const r = validateConfig(min);
    expect(r.ok && r.config.ui.trace).toBeUndefined();
  });
  test("valid roles are accepted", () => {
    const r = withTrace({ roles: ["AGENT_DEBUG", "X"] });
    expect(r.ok && r.config.ui.trace).toEqual({ roles: ["AGENT_DEBUG", "X"] });
  });
  test("missing roles is needs-input", () => {
    expect(withTrace({})).toMatchObject({ ok: false, kind: "needs-input", problems: [{ path: "ui.trace.roles" }] });
  });
  test("bad shapes are invalid", () => {
    for (const t of [{ roles: [] }, { roles: "A" }, { roles: [1] }, { roles: [""] }, "yes", [], { roles: ["A"], extra: 1 }]) {
      expect(withTrace(t)).toMatchObject({ ok: false, kind: "invalid" });
    }
  });
});
