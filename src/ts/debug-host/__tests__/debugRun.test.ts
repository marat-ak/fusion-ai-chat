/** @jest-environment node */
import { bindingFromUrl, CHECK_VERSION, runConfig, runUser, startRun, TRACE_ROLE } from "../debugRun";
import { POD_PROXY_ENDPOINTS, POD_PROXY_ERROR_HEADER } from "../podProxyRestHelper";
import { validateConfig } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/config/validate";

const O = "https://agents.example.com";
const POD = "/api/pod/c/jane.doe__0b9d5c1e-7f43-4a51-9a63-2b0c4e1d8f20/";
const q = (params: Record<string, string>): string => "?" + new URLSearchParams(params).toString();
const URL_OK = q({ pod: POD, workflow: "MOCK_WF", version: "DRAFT" });

function fakeFetch(respond: (request: Request) => Response): { fetchImpl: (request: Request) => Promise<Response>; sent: Request[] } {
  const sent: Request[] = [];
  return { fetchImpl: async (request: Request) => { sent.push(request); return respond(request); }, sent };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("binds_workflow_and_version_from_url", async () => {
  expect(bindingFromUrl(URL_OK)).toEqual({ ok: true, binding: { pod: POD, workflowCode: "MOCK_WF", version: "DRAFT" } });
  // The webc side panel's form, unencoded slashes included.
  expect(bindingFromUrl(`?pod=${POD}&workflow=WF_1&version=PUBLISHED`)).toEqual({ ok: true, binding: { pod: POD, workflowCode: "WF_1", version: "PUBLISHED" } });

  const { fetchImpl, sent } = fakeFetch(() => json({ instance: "dev1", podUser: "test.user" }));
  const o = await startRun({ search: URL_OK, origin: O, fetchImpl });
  if (o.kind !== "run") throw new Error(`expected a run, got ${o.kind}`);
  expect([o.binding, o.instance, o.podUser]).toEqual([{ pod: POD, workflowCode: "MOCK_WF", version: "DRAFT" }, "dev1", "test.user"]);
  expect(o.chat.config).toEqual(runConfig({ workflowCode: "MOCK_WF", version: "DRAFT" }));
  expect(o.chat.user).toEqual({ userName: "test.user", roles: [TRACE_ROLE] });
  expect(o.chat.endpoint).toEqual(POD_PROXY_ENDPOINTS);
  expect([o.chat.restHelper.pod, o.chat.restHelper.label, o.chat.restHelper.baseUrl("FUAI")]).toEqual([POD, "dev1", `${O}${POD}FUAI`]);
  const r = validateConfig(o.chat.config);
  expect(r.ok && [r.config.agent.workflowCode, r.config.agent.version]).toEqual(["MOCK_WF", "DRAFT"]);
  // The page's one call of its own: the conversation's binding.
  expect(sent.map((s) => [s.method, s.url])).toEqual([["GET", `${O}${POD}_info`]]);
});

test("missing_param_shows_open_from_chat_panel", async () => {
  const cases: Array<[string, string[]]> = [
    ["", ["pod: missing", "workflow: missing", "version: missing"]],
    ["?", ["pod: missing", "workflow: missing", "version: missing"]],
    [q({ workflow: "WF", version: "DRAFT" }), ["pod: missing"]],
    [q({ pod: POD, version: "DRAFT" }), ["workflow: missing"]],
    [q({ pod: POD, workflow: "WF" }), ["version: missing"]],
    [q({ pod: POD, workflow: "  ", version: "DRAFT" }), ["workflow: empty"]],
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
    const o = await startRun({ search: q({ pod, workflow: "WF", version: "DRAFT" }), origin: O, fetchImpl });
    expect(o).toEqual({ kind: "open-from-chat", problems: [`pod: not the chat conversation's proxy base /api/pod/c/<conversation>/ (got ${JSON.stringify(pod)})`] });
    expect(sent).toEqual([]);
  }
});

test("version_is_draft_or_published_exactly", () => {
  for (const version of ["draft", "Published", "LATEST", ""]) {
    expect(bindingFromUrl(q({ pod: POD, workflow: "WF", version }))).toEqual({ ok: false, problems: [`version: must be DRAFT or PUBLISHED (got ${JSON.stringify(version)})`] });
  }
});

test("repeated_and_unknown_parameters_are_refused", () => {
  expect(bindingFromUrl(`${URL_OK}&workflow=OTHER&version=PUBLISHED`)).toEqual({ ok: false, problems: ["workflow: given 2 times", "version: given 2 times"] });
  expect(bindingFromUrl(`${URL_OK}&instance=dev1&app=APP&app=B`)).toEqual({ ok: false, problems: ["unknown parameters: instance, app"] });
  expect(bindingFromUrl(`${URL_OK}&instance=dev1`)).toEqual({ ok: false, problems: ["unknown parameter: instance"] });
});

test("the_user_is_the_pod_user_or_nobody", async () => {
  expect(runUser("jane.doe")).toEqual({ userName: "jane.doe", roles: [TRACE_ROLE] });
  expect(runUser(undefined)).toEqual({ roles: [TRACE_ROLE] });
  const o = await startRun({ search: URL_OK, origin: O, fetchImpl: fakeFetch(() => json({ instance: "dev1" })).fetchImpl });
  if (o.kind !== "run") throw new Error(`expected a run, got ${o.kind}`);
  // No pod user: the chat gets no userName (its needs-input panel), never another name.
  expect(["podUser" in o, o.chat.user]).toEqual([false, { roles: [TRACE_ROLE] }]);
});

test("info_auth_required_and_failures_are_their_own_outcomes", async () => {
  const binding = { pod: POD, workflowCode: "MOCK_WF", version: "DRAFT" };
  const authRequired = fakeFetch(() => json({ state: "auth-required" }, 401, { [POD_PROXY_ERROR_HEADER]: "auth-required" }));
  expect(await startRun({ search: URL_OK, origin: O, fetchImpl: authRequired.fetchImpl })).toEqual({ kind: "auth-required", binding });
  expect(authRequired.sent).toHaveLength(1);
  const gone = fakeFetch(() => json({ state: "unknown-conversation" }, 404, { [POD_PROXY_ERROR_HEADER]: "unknown-conversation" }));
  expect(await startRun({ search: URL_OK, origin: O, fetchImpl: gone.fetchImpl })).toEqual({
    kind: "unavailable", binding, message: "the debugger's pod binding is unavailable (HTTP 404 unknown-conversation)",
  });
});

test("the_config_turns_the_debug_features_on_and_files_off_and_validates", () => {
  const config = runConfig({ workflowCode: "WF_1", version: "PUBLISHED" });
  expect(config).toEqual({
    mode: "chat",
    agent: { workflowCode: "WF_1", version: "PUBLISHED" },
    auth: { kind: "fusionShell" },
    protocol: { checkVersion: CHECK_VERSION },
    ui: { modeSwitch: true, debug: { rawFrames: true }, trace: { roles: [TRACE_ROLE] } },
    files: { enabled: false },
  });
  const r = validateConfig(config);
  expect(r.ok && [r.config.agent.version, r.config.ui.modeSwitch, r.config.ui.debug.rawFrames]).toEqual(["PUBLISHED", true, true]);
});
