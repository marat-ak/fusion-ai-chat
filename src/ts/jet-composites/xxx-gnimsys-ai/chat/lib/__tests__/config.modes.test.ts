// Config keys of the debugger features (spec §5, §17): mode, agent.version, app, ui.modeSwitch, ui.debug.rawFrames.
import { validateConfig } from "../config/validate";
import { availableModes, MODE_LABELS } from "../config/modes";
import { withRun } from "../config/types";
import type { ChatConfig } from "../config/types";

const RUN = { workflowCode: "WF_1", version: "PUBLISHED" as const };

const min = { mode: "chat", agent: { workflowCode: "WF_1" }, auth: { kind: "fusionShell" }, protocol: { checkVersion: "2607100" } };
const ok = (input: object): ChatConfig => {
  const r = validateConfig(input);
  if (!r.ok) throw new Error("expected ok: " + JSON.stringify(r.problems));
  return r.config;
};

describe("mode", () => {
  test("required_without_default", () => {
    const { mode: _m, ...noMode } = min;
    expect(validateConfig(noMode)).toEqual({ ok: false, kind: "needs-input", problems: [{ path: "mode", message: "required" }] });
  });
  test("chat_is_accepted", () => expect(ok(min).mode).toBe("chat"));
  test("unknown_value_is_invalid", () => {
    for (const mode of ["CHAT", "", 1, null]) {
      expect(validateConfig({ ...min, mode })).toEqual({ ok: false, kind: "invalid", problems: [{ path: "mode", message: 'must be one of "chat", "app", "gnimsys"' }] });
    }
  });
  test("modes_not_built_yet_are_refused", () => {
    expect(validateConfig({ ...min, mode: "gnimsys" })).toEqual({ ok: false, kind: "invalid", problems: [{ path: "mode", message: '"gnimsys" is not built yet' }] });
    const app = validateConfig({ ...min, mode: "app", agent: undefined, app: { applicationCode: "APP", applicationType: "DRAFT" } });
    expect(app).toEqual({ ok: false, kind: "invalid", problems: [{ path: "mode", message: '"app" is not built yet' }] });
  });
});

describe("agent.version", () => {
  // Absent stays absent: PUBLISHED is supplied by the run resolution (design §5.1), never by the validator.
  test("absent_stays_unbound", () => expect("version" in ok(min).agent).toBe(false));
  test("PUBLISHED_is_kept_as_bound", () => expect(ok({ ...min, agent: { workflowCode: "WF_1", version: "PUBLISHED" } }).agent.version).toBe("PUBLISHED"));
  test("DRAFT_is_accepted", () => expect(ok({ ...min, agent: { workflowCode: "WF_1", version: "DRAFT" } }).agent.version).toBe("DRAFT"));
  test("other_values_are_invalid", () => {
    for (const version of ["draft", "LATEST", 1]) {
      expect(validateConfig({ ...min, agent: { workflowCode: "WF_1", version } }))
        .toEqual({ ok: false, kind: "invalid", problems: [{ path: "agent.version", message: 'must be "PUBLISHED" or "DRAFT"' }] });
    }
  });
});

describe("app", () => {
  test("carried_when_complete", () => {
    const c = ok({ ...min, app: { applicationCode: "APP_1", applicationType: "DRAFT", panel: "P1", appContext: "ctx" } });
    expect(c.app).toEqual({ applicationCode: "APP_1", applicationType: "DRAFT", panel: "P1", appContext: "ctx" });
  });
  test("absent_by_default", () => expect(ok(min).app).toBeUndefined());
  test("code_and_type_required_when_present", () => {
    expect(validateConfig({ ...min, app: {} })).toEqual({
      ok: false, kind: "needs-input",
      problems: [{ path: "app.applicationCode", message: "required" }, { path: "app.applicationType", message: "required" }],
    });
  });
  test("unknown_keys_and_bad_type_are_invalid", () => {
    const r = validateConfig({ ...min, app: { applicationCode: "A", applicationType: "LIVE", x: 1 } });
    expect(r).toMatchObject({ ok: false, kind: "invalid" });
    expect(!r.ok && r.problems).toEqual(expect.arrayContaining([
      { path: "app.x", message: "unknown key" },
      { path: "app.applicationType", message: 'must be "PUBLISHED" or "DRAFT"' },
    ]));
  });
});

describe("ui.modeSwitch and ui.debug", () => {
  test("off_by_default", () => {
    const c = ok(min);
    expect([c.ui.modeSwitch, c.ui.debug]).toEqual([false, { rawFrames: false }]);
  });
  test("on_when_set", () => {
    const c = ok({ ...min, ui: { modeSwitch: true, debug: { rawFrames: true } } });
    expect([c.ui.modeSwitch, c.ui.debug]).toEqual([true, { rawFrames: true }]);
  });
  test("wrong_types_and_unknown_debug_keys_are_invalid", () => {
    const r = validateConfig({ ...min, ui: { modeSwitch: "yes", debug: { rawFrames: 1, frames: true } } });
    expect(!r.ok && r.problems).toEqual([
      { path: "ui.modeSwitch", message: "must be a boolean" },
      { path: "ui.debug.frames", message: "unknown key" },
      { path: "ui.debug.rawFrames", message: "must be a boolean" },
    ]);
    expect(validateConfig({ ...min, ui: { debug: true } })).toEqual({ ok: false, kind: "invalid", problems: [{ path: "ui.debug", message: "must be an object" }] });
  });
});

describe("availableModes", () => {
  test("lists_only_implemented_and_configured_modes", () => {
    // chat is implemented and its workflow configured; app is configured but not built; gnimsys is not built.
    expect(availableModes(withRun(ok({ ...min, app: { applicationCode: "A", applicationType: "PUBLISHED" } }), RUN))).toEqual(["chat"]);
    expect(availableModes(withRun(ok(min), RUN))).toEqual(["chat"]);
  });
  test("labels", () => expect(MODE_LABELS).toEqual({ chat: "Chat", app: "App", gnimsys: "Gnimsys" }));
});
