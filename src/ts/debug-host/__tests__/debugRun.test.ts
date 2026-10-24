import { CHECK_VERSION, runConfig, runProblems, runUser, TRACE_ROLE } from "../debugRun";
import { validateConfig } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/config/validate";

const dev1 = { name: "dev1", label: "Dev 1", connected: true, podUser: "jane.doe" };

test("nothing_is_defaulted_every_input_is_named", () => {
  expect(runProblems({ instance: null, workflowCode: " ", appCode: "", version: null })).toEqual([
    "Instance: pick one", "Workflow code or app code: enter one", "Version: pick PUBLISHED or DRAFT",
  ]);
  expect(runProblems({ instance: dev1, workflowCode: "WF", appCode: "", version: "DRAFT" })).toEqual([]);
  expect(runProblems({ instance: dev1, workflowCode: "", appCode: "APP", version: "PUBLISHED" })).toEqual([]);
});

test("an_instance_without_a_pod_sign_in_cannot_run", () => {
  expect(runProblems({ instance: { name: "off", label: "Off", connected: false }, workflowCode: "WF", appCode: "", version: "DRAFT" }))
    .toEqual(["Instance: sign in to Off through the agent chat first, then Refresh"]);
});

test("the_config_turns_the_debug_features_on_and_files_off_and_validates", () => {
  const config = runConfig({ workflowCode: " WF_1 ", appCode: "", version: "DRAFT" });
  expect(config).toEqual({
    mode: "chat",
    agent: { workflowCode: "WF_1", version: "DRAFT" },
    auth: { kind: "fusionShell" },
    protocol: { checkVersion: CHECK_VERSION },
    ui: { modeSwitch: true, debug: { rawFrames: true }, trace: { roles: [TRACE_ROLE] } },
    files: { enabled: false },
  });
  const r = validateConfig(config);
  expect(r.ok && [r.config.agent.version, r.config.ui.modeSwitch, r.config.ui.debug.rawFrames]).toEqual(["DRAFT", true, true]);
});

test("an_app_code_is_carried_and_alone_asks_for_the_app_mode", () => {
  expect(runConfig({ workflowCode: "WF", appCode: "APP", version: "PUBLISHED" })).toMatchObject({
    mode: "chat", app: { applicationCode: "APP", applicationType: "PUBLISHED" },
  });
  const appOnly = runConfig({ workflowCode: "", appCode: "APP", version: "DRAFT" });
  expect(appOnly.mode).toBe("app");
  expect("agent" in appOnly).toBe(false);
  // Mode app is not built: the chat shows its invalid panel for it.
  expect(validateConfig(appOnly)).toEqual({ ok: false, kind: "invalid", problems: [{ path: "mode", message: '"app" is not built yet' }] });
});

test("the_user_is_the_pod_user_or_nobody", () => {
  expect(runUser(dev1)).toEqual({ userName: "jane.doe", roles: [TRACE_ROLE] });
  expect(runUser({ name: "x", label: "X", connected: true })).toEqual({ roles: [TRACE_ROLE] });
});
