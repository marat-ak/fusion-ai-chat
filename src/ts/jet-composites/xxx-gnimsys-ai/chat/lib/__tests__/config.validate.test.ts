import { validateConfig, parseConfigProp } from "../config/validate";

const min = {
  mode: "chat",
  agent: { workflowCode: "WF_1" },
  auth: { kind: "fusionShell" },
  protocol: { checkVersion: "2607100" },
};

test("minimal valid config is ok", () => {
  expect(validateConfig(min).ok).toBe(true);
});

test("agent binding nothing is valid: the run is resolved by role (design §5.1), never defaulted here", () => {
  const r = validateConfig({ ...min, agent: {} });
  expect(r.ok && r.config.agent).toEqual({});
});

test("an empty workflowCode or version is not bound (a VB page parameter missing from the URL)", () => {
  const r = validateConfig({ ...min, agent: { workflowCode: "", version: "" } });
  expect(r.ok && r.config.agent).toEqual({});
});

test("a missing agent section is needs-input (the page says what it binds, possibly {})", () => {
  const { agent: _a, ...noAgent } = min;
  expect(validateConfig(noAgent)).toEqual({ ok: false, kind: "needs-input", problems: [{ path: "agent", message: "required" }] });
});

test("agent.pod is an unknown key (the pod lives in the endpoints' service connections)", () => {
  const r = validateConfig({ ...min, agent: { workflowCode: "WF_1", pod: "evbp-dev1" } });
  expect(r).toEqual({ ok: false, kind: "invalid", problems: [{ path: "agent.pod", message: "unknown key" }] });
});

test("a valid config has no pod", () => {
  const r = validateConfig(min);
  expect(r.ok && Object.keys(r.config.agent)).toEqual(["workflowCode"]);
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
  const r = validateConfig({ ...min, agent: { workflowCode: 5 }, ui: { viewer: "yes", zzz: 1 } });
  expect(r).toMatchObject({ ok: false, kind: "invalid" });
  expect((r as any).problems).toEqual(expect.arrayContaining([
    { path: "agent.workflowCode", message: "must be a string" },
    { path: "ui.viewer", message: "must be a boolean" },
    { path: "ui.zzz", message: "unknown key" },
  ]));
});

describe("protocol.hcmRestBase", () => {
  const withBase = (hcmRestBase: string) =>
    validateConfig({ ...min, protocol: { checkVersion: "2607100", hcmRestBase }, files: { enabled: true } });
  test("an /hcmRestApi/ pod path is accepted", () => {
    const r = withBase("/hcmRestApi/rest/latest/en/11.13.18.05:9");
    expect(r.ok && r.config.protocol.hcmRestBase).toBe("/hcmRestApi/rest/latest/en/11.13.18.05:9");
  });
  test("any other base is invalid at config time", () => {
    for (const base of ["/fscmRestApi/resources/11.13.18.05", "https://pod.example.com/hcmRestApi/resources", "hcmRestApi/x", "/hcmRestApi", "/api/boss/x"]) {
      expect(withBase(base)).toEqual({ ok: false, kind: "invalid", problems: [{ path: "protocol.hcmRestBase", message: 'must start with "/hcmRestApi/"' }] });
    }
  });
  test("checked even when files are off", () => {
    const r = validateConfig({ ...min, protocol: { checkVersion: "2607100", hcmRestBase: "/fscmRestApi/x" } });
    expect(r).toMatchObject({ ok: false, kind: "invalid", problems: [{ path: "protocol.hcmRestBase" }] });
  });
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

describe("ui.greeting", () => {
  test("absent means the component's own greeting", () => {
    const r = validateConfig(min);
    expect(r.ok && r.config.ui.greeting).toBeUndefined();
  });
  test("a string is kept", () => {
    const r = validateConfig({ ...min, ui: { greeting: "Hi! Ask me about invoices." } });
    expect(r.ok && r.config.ui.greeting).toBe("Hi! Ask me about invoices.");
  });
  test("a non-string is invalid", () => {
    const r = validateConfig({ ...min, ui: { greeting: 1 } });
    expect(r).toMatchObject({ ok: false, kind: "invalid", problems: [{ path: "ui.greeting", message: "must be a string" }] });
  });
});

describe("ui.runSettings", () => {
  const withRs = (runSettings: unknown) => validateConfig({ ...min, ui: { runSettings } });
  test("absent means nobody may choose (no default role names)", () => {
    const r = validateConfig(min);
    expect(r.ok && r.config.ui.runSettings).toBeUndefined();
  });
  test("both role lists are kept; an empty list = nobody", () => {
    const r = withRs({ allAgentsRoles: ["PICK"], draftRoles: [] });
    expect(r.ok && r.config.ui.runSettings).toEqual({ allAgentsRoles: ["PICK"], draftRoles: [] });
  });
  test("both lists are required inside", () => {
    expect(withRs({})).toEqual({
      ok: false, kind: "needs-input",
      problems: [{ path: "ui.runSettings.allAgentsRoles", message: "required" }, { path: "ui.runSettings.draftRoles", message: "required" }],
    });
  });
  test("bad shapes are invalid", () => {
    for (const rs of [[], "PICK", { allAgentsRoles: "PICK", draftRoles: [] }, { allAgentsRoles: [""], draftRoles: [] }, { allAgentsRoles: [], draftRoles: [1] }, { allAgentsRoles: [], draftRoles: [], x: 1 }]) {
      expect(withRs(rs)).toMatchObject({ ok: false, kind: "invalid" });
    }
  });
});
