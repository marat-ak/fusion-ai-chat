/** @jest-environment node */
import { bindingFromUrl, CHECK_VERSION, HCM_REST_BASE, MAX_FILE_MB, runConfig, runUser, startRun } from "../debugRun";
import { POD_PROXY_ENDPOINTS, POD_PROXY_ERROR_HEADER } from "../podProxyRestHelper";
import { validateConfig } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/config/validate";
import { inlineRefusal } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/widgets/datasource";

const O = "https://agents.example.com";
const POD = "/api/pod/c/jane.doe__0b9d5c1e-7f43-4a51-9a63-2b0c4e1d8f20/";
const q = (params: Record<string, string>): string => "?" + new URLSearchParams(params).toString();
const URL_OK = q({ pod: POD, workflow: "MOCK_WF", version: "DRAFT", gnimsysUi: "1" });

function fakeFetch(respond: (request: Request) => Response): { fetchImpl: (request: Request) => Promise<Response>; sent: Request[] } {
  const sent: Request[] = [];
  return { fetchImpl: async (request: Request) => { sent.push(request); return respond(request); }, sent };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("binds_workflow_and_version_from_url", async () => {
  expect(bindingFromUrl(URL_OK)).toEqual({ ok: true, binding: { pod: POD, workflowCode: "MOCK_WF", version: "DRAFT", gnimsysUi: 1 } });
  // The webc side panel's form, unencoded slashes included.
  expect(bindingFromUrl(`?pod=${POD}&workflow=WF_1&version=PUBLISHED&gnimsysUi=0`)).toEqual({ ok: true, binding: { pod: POD, workflowCode: "WF_1", version: "PUBLISHED", gnimsysUi: 0 } });

  const { fetchImpl, sent } = fakeFetch(() => json({ instance: "dev1", podUser: "test.user" }));
  const o = await startRun({ search: URL_OK, origin: O, fetchImpl });
  if (o.kind !== "run") throw new Error(`expected a run, got ${o.kind}`);
  expect([o.binding, o.instance, o.podUser]).toEqual([{ pod: POD, workflowCode: "MOCK_WF", version: "DRAFT", gnimsysUi: 1 }, "dev1", "test.user"]);
  expect(o.chat.config).toEqual(runConfig({ workflowCode: "MOCK_WF", version: "DRAFT", gnimsysUi: 1 }));
  expect(o.chat.user).toEqual({ userName: "test.user", roles: [] });
  // The attachments' conversation row carries PersonId "-1" (bridge design §13.2: the pod refuses a row without one).
  expect(o.chat.personId).toBe("-1");
  expect(o.chat.endpoint).toEqual(POD_PROXY_ENDPOINTS);
  expect([o.chat.restHelper.pod, o.chat.restHelper.label, o.chat.restHelper.baseUrl("FUAI")]).toEqual([POD, "dev1", `${O}${POD}FUAI`]);
  const r = validateConfig(o.chat.config);
  expect(r.ok && [r.config.agent.workflowCode, r.config.agent.version]).toEqual(["MOCK_WF", "DRAFT"]);
  // The page's one call of its own: the conversation's binding.
  expect(sent.map((s) => [s.method, s.url])).toEqual([["GET", `${O}${POD}_info`]]);
});

test("missing_param_shows_open_from_chat_panel", async () => {
  const cases: Array<[string, string[]]> = [
    ["", ["pod: missing", "workflow: missing", "version: missing", "gnimsysUi: missing"]],
    ["?", ["pod: missing", "workflow: missing", "version: missing", "gnimsysUi: missing"]],
    [q({ workflow: "WF", version: "DRAFT", gnimsysUi: "1" }), ["pod: missing"]],
    [q({ pod: POD, version: "DRAFT", gnimsysUi: "1" }), ["workflow: missing"]],
    [q({ pod: POD, workflow: "WF", gnimsysUi: "1" }), ["version: missing"]],
    // The page renders for the agent's chat (1) or as Oracle's own chat (0): the caller says which, nothing is assumed.
    [q({ pod: POD, workflow: "WF", version: "DRAFT" }), ["gnimsysUi: missing"]],
    [q({ pod: POD, workflow: "  ", version: "DRAFT", gnimsysUi: "1" }), ["workflow: empty"]],
  ];
  for (const [search, problems] of cases) {
    const { fetchImpl, sent } = fakeFetch(() => json({ instance: "dev1", podUser: "test.user" }));
    expect([search, await startRun({ search, origin: O, fetchImpl })]).toEqual([search, { kind: "open-from-chat", problems }]);
    // Zero requests: nothing is asked of the proxy without a complete binding.
    expect(sent).toEqual([]);
  }
});

test("invalid_pod_base_refused", async () => {
  for (const pod of ["/api/pod/dev1/", "/api/pod/c/x", "/api/pod/c/../", "/api/pod/c/%2e%2e/", "https://evil.example.com/api/pod/c/x/", "//evil.example.com/api/pod/c/x/", "/api/pod/c/a\\b/"]) {
    const { fetchImpl, sent } = fakeFetch(() => json({ instance: "dev1" }));
    const o = await startRun({ search: q({ pod, workflow: "WF", version: "DRAFT", gnimsysUi: "1" }), origin: O, fetchImpl });
    expect(o).toEqual({ kind: "open-from-chat", problems: [`pod: not the chat conversation's proxy base /api/pod/c/<conversation>/ (got ${JSON.stringify(pod)})`] });
    expect(sent).toEqual([]);
  }
});

test("version_is_draft_or_published_exactly", () => {
  for (const version of ["draft", "Published", "LATEST", ""]) {
    expect(bindingFromUrl(q({ pod: POD, workflow: "WF", version, gnimsysUi: "1" }))).toEqual({ ok: false, problems: [`version: must be DRAFT or PUBLISHED (got ${JSON.stringify(version)})`] });
  }
});

test("gnimsysUi_is_0_or_1_exactly", () => {
  for (const gnimsysUi of ["", "2", "true", "on", "01", " 1", "1.0"]) {
    expect(bindingFromUrl(q({ pod: POD, workflow: "WF", version: "DRAFT", gnimsysUi }))).toEqual({ ok: false, problems: [`gnimsysUi: must be 0 or 1 (got ${JSON.stringify(gnimsysUi)})`] });
  }
  expect(bindingFromUrl(`${URL_OK}&gnimsysUi=0`)).toEqual({ ok: false, problems: ["gnimsysUi: given 2 times"] });
});

test("gnimsysUi_1_sends_it_as_additional_context_and_0_sends_none", async () => {
  // 1: every run-start message carries parameters.additional_context {"gnimsysUi":1} (the agent emits gnimsys-ui blocks).
  const on = runConfig({ workflowCode: "WF_1", version: "DRAFT", gnimsysUi: 1 });
  expect(on.agent).toEqual({ workflowCode: "WF_1", version: "DRAFT", additionalContext: { gnimsysUi: 1 } });
  const r = validateConfig(on);
  expect(r.ok && r.config.agent.additionalContext).toEqual({ gnimsysUi: 1 });
  // 0: no additional context at all (the run looks like Oracle's own chat).
  const off = runConfig({ workflowCode: "WF_1", version: "PUBLISHED", gnimsysUi: 0 });
  expect(off.agent).toEqual({ workflowCode: "WF_1", version: "PUBLISHED", publishedVia: "debug" });
  const r0 = validateConfig(off);
  expect(r0.ok && "additionalContext" in r0.config.agent).toBe(false);

  const { fetchImpl } = fakeFetch(() => json({ instance: "dev1", podUser: "test.user" }));
  const o = await startRun({ search: q({ pod: POD, workflow: "MOCK_WF", version: "DRAFT", gnimsysUi: "0" }), origin: O, fetchImpl });
  if (o.kind !== "run") throw new Error(`expected a run, got ${o.kind}`);
  expect([o.binding.gnimsysUi, "additionalContext" in (o.chat.config.agent as object)]).toEqual([0, false]);
});

test("repeated_and_unknown_parameters_are_refused", () => {
  expect(bindingFromUrl(`${URL_OK}&workflow=OTHER&version=PUBLISHED`)).toEqual({ ok: false, problems: ["workflow: given 2 times", "version: given 2 times"] });
  expect(bindingFromUrl(`${URL_OK}&instance=dev1&app=APP&app=B`)).toEqual({ ok: false, problems: ["unknown parameters: instance, app"] });
  expect(bindingFromUrl(`${URL_OK}&instance=dev1`)).toEqual({ ok: false, problems: ["unknown parameter: instance"] });
});

test("the_user_is_the_pod_user_or_nobody", async () => {
  expect(runUser("jane.doe")).toEqual({ userName: "jane.doe", roles: [] });
  expect(runUser(undefined)).toEqual({ roles: [] });
  const o = await startRun({ search: URL_OK, origin: O, fetchImpl: fakeFetch(() => json({ instance: "dev1" })).fetchImpl });
  if (o.kind !== "run") throw new Error(`expected a run, got ${o.kind}`);
  // No pod user: the chat gets no userName (its needs-input panel), never another name.
  expect(["podUser" in o, o.chat.user]).toEqual([false, { roles: [] }]);
});

test("info_auth_required_and_failures_are_their_own_outcomes", async () => {
  const binding = { pod: POD, workflowCode: "MOCK_WF", version: "DRAFT", gnimsysUi: 1 };
  const authRequired = fakeFetch(() => json({ state: "auth-required" }, 401, { [POD_PROXY_ERROR_HEADER]: "auth-required" }));
  expect(await startRun({ search: URL_OK, origin: O, fetchImpl: authRequired.fetchImpl })).toEqual({ kind: "auth-required", binding });
  expect(authRequired.sent).toHaveLength(1);
  const gone = fakeFetch(() => json({ state: "unknown-conversation" }, 404, { [POD_PROXY_ERROR_HEADER]: "unknown-conversation" }));
  expect(await startRun({ search: URL_OK, origin: O, fetchImpl: gone.fetchImpl })).toEqual({
    kind: "unavailable", binding, message: "the debugger's pod binding is unavailable (HTTP 404 unknown-conversation)",
  });
});

test("the_config_turns_the_mode_switch_and_files_on_and_validates", () => {
  const config = runConfig({ workflowCode: "WF_1", version: "PUBLISHED", gnimsysUi: 0 });
  expect(config).toEqual({
    mode: "chat",
    // A PUBLISHED run goes through /debug (status PUBLISHED): the builder gets the node data as for a draft.
    agent: { workflowCode: "WF_1", version: "PUBLISHED", publishedVia: "debug" },
    auth: { kind: "fusionShell" },
    // Attachments on (their PersonId is the chat's person-id, see startRun); no trace config: the Run Inspector shows the run.
    protocol: { checkVersion: CHECK_VERSION, hcmRestBase: HCM_REST_BASE },
    ui: { modeSwitch: true },
    files: { enabled: true, maxSizeMB: MAX_FILE_MB },
    // Agent-written block datasources load as on a VB page; the pod proxy is the gate.
    datasources: { allowInline: true, allowPrefixes: ["/"] },
  });
  const r = validateConfig(config);
  expect(r.ok && [r.config.agent.version, r.config.agent.publishedVia, r.config.ui.modeSwitch, r.config.files.enabled, r.config.files.maxSizeMB, r.config.ui.trace])
    .toEqual(["PUBLISHED", "debug", true, true, 50, undefined]);
  // pageSize is the schema's own (not set by the host).
  expect(r.ok && r.config.datasources).toEqual({ allowInline: true, allowPrefixes: ["/"], pageSize: 25 });
  // 50 MB per file stays under the pod proxy's 64 MiB request bound, multipart overhead included.
  expect(MAX_FILE_MB * 1024 * 1024).toBeLessThan(64 * 1024 * 1024 - 1024 * 1024);
});

test("agent_written_fa_and_boss_datasources_are_allowed_in_the_debugger", () => {
  const r = validateConfig(runConfig({ workflowCode: "WF_1", version: "DRAFT", gnimsysUi: 1 }));
  if (!r.ok) throw new Error("config must validate");
  const ds = (target: "FA" | "BOSS", url: string) => ({ type: "rest" as const, target, method: "GET" as const, url });
  expect(inlineRefusal(ds("FA", "/fscmRestApi/resources/11.13.18.05/subinventories?q=Description LIKE '{{query}}%'"), r.config.datasources)).toBeNull();
  expect(inlineRefusal(ds("BOSS", "/api/boss/data/objects/ora/commonFusionAI/agents/v1/$en/workflows?$filter=name ~LIKE '%{{query}}%'"), r.config.datasources)).toBeNull();
});

test("a_draft_run_config_carries_no_published_via_and_validates", () => {
  // publishedVia is refused with a bound DRAFT: the draft runs through /debug anyway.
  const config = runConfig({ workflowCode: "WF_1", version: "DRAFT", gnimsysUi: 0 });
  expect(config.agent).toEqual({ workflowCode: "WF_1", version: "DRAFT" });
  const r = validateConfig(config);
  expect(r.ok && r.config.agent).toEqual({ workflowCode: "WF_1", version: "DRAFT" });
});
