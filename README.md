# fusion-ai-chat

`<xxx-gnimsys-ai-chat>`: a Preact/JET chat component (JET pack `xxx-gnimsys-ai`, VComponent `chat`,
Redwood) that a Fusion customer drops into a Visual Builder Studio **App UI extension** to talk to one of
their Oracle AI Agent Studio agents. One component, many agents: everything agent-specific comes from a
versioned JSON config. It is a thin UI over Oracle's AI Studio runtime (v2 `/chat` SSE, BOSS conversation
history, attachments); it has no LLM loop of its own.

Design: `../docs/superpowers/specs/2026-10-21-fusion-ai-chat-design.md`. Developer persona:
`../knowledgebase/fusion-ai-chat-dev.md`.

## Requirements

- A Fusion **App UI extension** page (VB Studio extension served from the pod). The component calls
  `/api/fusion-ai`, `/api/boss`, `/fscmRestApi` and `/hcmRestApi` on the **page's own origin**: same-origin
  only, no cross-origin, no proxy.
- Endpoints, not tokens: the component never mints or adds a token. Every pod call goes through the page's VB
  RestHelper (`rest-helper`) and the `endpoint` map (contract name `FUAI`, `BOSS`, `FA` -> VB endpoint id of a service
  connection); the service connection owns the request and its token, and its scope carries the pod. The old
  `fusionShell` modules (anti-CSRF + token relay, `lib/auth/FusionShellAuthFetch.ts`, `lib/auth/tokenRelay.ts`) are no
  longer called and remain only until their removal (endpoint slice, Task 5).
- The pod's AI Studio protocol version pinned in the config (`protocol.checkVersion`, `2607100` when built).
  Oracle's API is undocumented and drifts per release: re-test on every pod upgrade.

## Config v1

Published contract: [`chat/schemas/config-v1.schema.json`](src/ts/jet-composites/xxx-gnimsys-ai/chat/schemas/config-v1.schema.json)
(also inside the package). The schema sketch in the design spec §5.4 shows the planned full shape; in v1.0
`auth.kind` accepts only `"fusionShell"`, and `widgets`/`datasources` are accepted but have no effect yet
(v1.1). A v1.0 config:

```json
{
  "mode": "chat",
  "agent": {
    "workflowCode": "KRN_INV_TXN_WIZARD",
    "additionalContext": { "organization": "{{orgCode}}" }
  },
  "auth": { "kind": "fusionShell" },
  "protocol": { "checkVersion": "2607100", "hcmRestBase": "/hcmRestApi/rest/latest/en/11.13.18.05:9" },
  "ui": { "title": "Inventory Transaction Wizard", "greeting": "How can I help you?", "placeholder": "Ask…", "starterQuestions": "fromWorkflow", "conversations": true },
  "files": { "enabled": true, "maxFiles": 5, "maxSizeMB": 50, "accept": ["pdf", "png", "jpg", "xlsx"] }
}
```

Required inputs (never defaulted):

| Input | Where | Meaning |
|---|---|---|
| `mode` | config | `"chat"` (spec §2; `"app"` and `"gnimsys"` are refused as not built yet) |
| `agent` | config | what the page binds: `workflowCode` (the AI Studio workflow code) and `version`, each optional — `{}` binds nothing; what is not bound is chosen by the user as `ui.runSettings` allows (see Run selection) |
| `rest-helper` | element property | the page's VB RestHelper (`vb/helpers/rest`): every pod call goes through it |
| `endpoint` | element property | the endpoint map: contract name (`FUAI`, `BOSS`, and `FA` when `files.enabled`) -> VB endpoint id of the service connection that owns those calls; the pod comes from the scopes of those service connections (`agent.pod` is refused as an unknown key) |
| `auth.kind` | config | `"fusionShell"`, still required by the validator; it selects nothing any more (every call goes through `rest-helper` / `endpoint`) and is removed with the endpoint slice |
| `protocol.checkVersion` | config | AI Studio `X-Ora-Ai-Api-V2-*` check version |
| `protocol.hcmRestBase` | config | only when `files.enabled`: the `hcmRestApi` base for `hcmAiStudioConversations` |
| `user.userName` | element property `user` | owner filter of the user's conversation list |
| `person-id` | element attribute | only when `files.enabled`: Oracle `PersonId` (dev1 rows show `"-1"`) |

Optional texts: `ui.greeting` is the agent's greeting bubble on an empty conversation (the starter questions sit
inside it; default: the component's localized "How can I help you?"); `ui.placeholder` is the composer placeholder
(default: "Ask a question…").

A missing required input shows a **needs-input** panel listing what is missing; an unknown key or a wrong
value shows an **invalid** panel. Nothing is fetched until the config passes. `{{key}}` placeholders in
`agent.additionalContext` are replaced from the `context` property.

### Debugger keys (spec §5, §17)

| Key | Default | Meaning |
|---|---|---|
| `agent.version` | not bound | `"PUBLISHED"` runs the published workflow through `/agent/v2/<wf>/chat` (or `/debug`, see `agent.publishedVia`); `"DRAFT"` runs the draft through Studio's own test path `/agent/v2/<wf>/debug` with `invocationMode: "ADMIN"` and `debugParams: {isDebug: true, breakPoints: []}` (no `status`; a resume carries `jobId` + `resumeInput` and no run input) — the request shape of the vendored Oracle aistudio CLI's debug runner. Starter questions then come from the workflow's DRAFT row. Absent (or `""`) = not bound: the run selection decides (Published for a bound agent and a user without the draft role). A workflow without a row for the version shows "Starter questions unavailable (workflow not published)" / "(no draft version)". |
| `agent.publishedVia` | absent = `"chat"` | The endpoint of a PUBLISHED run. `"chat"` = `/agent/v2/<wf>/chat`. `"debug"` = Studio's test path `/agent/v2/<wf>/debug` with `invocationMode: "ADMIN"`, `status: "PUBLISHED"` and `debugParams: {isDebug: true, breakPoints: []}` (a resume = the same base + `jobId` + `resumeInput`) — the vendored aistudio CLI's request for a published run; the stream then carries node data (per-node input/output). For debug hosts: the debug host sets it for PUBLISHED. VB end-user pages leave it out (`/chat`): an ADMIN invocation is not for end users. Absent = `/chat`, the documented behaviour of a PUBLISHED run (not a data default). Only for a run that can be PUBLISHED: refused (invalid) with `agent.version: "DRAFT"`; a DRAFT the user chooses runs as always (`/debug`, no `status`). **[open]** live pod: a PUBLISHED `/debug` run returns node frames. |
| `app` | absent | `{applicationCode, applicationType: "PUBLISHED"\|"DRAFT", panel?, appContext?}` — the Agentic App of mode `app` (not built yet); both codes required when present. |
| `ui.modeSwitch` | `false` | An `oj-c-buttonset-single` in the header listing the modes that are implemented and configured (today: `Chat`). Picking another mode is a full reset: the chat remounts in a new conversation. |
| `ui.debug.rawFrames` | `false` | Under each reply a collapsed `Raw frames (N)` panel listing every SSE `data:` payload of that reply verbatim, in arrival order (frames the parser rejects included). |

### Run selection (bridge design §5.1)

A VB page reached from Fusion menu links binds `agent.workflowCode` / `agent.version` from its URL (page input
parameters; an empty string counts as not bound). What it leaves unbound, the user chooses — version first — if their
`user.roles` allow:

```json
"agent": { "workflowCode": "<optional>", "version": "<optional PUBLISHED|DRAFT>" },
"ui": { "runSettings": { "allAgentsRoles": ["<Fusion role>"], "draftRoles": ["<Fusion role>"] } }
```

Both lists are required inside `runSettings` (an empty list = nobody); `runSettings` absent = nobody chooses. No role
names are defaulted.

| Bound at init | User holds | Shown |
|---|---|---|
| agent + version | — | no choice; runs it (no role check) |
| agent only | draft role | version choice limited to the versions that agent has |
| agent only | no draft role | runs Published |
| version only | all-agents role | agent list for that version |
| nothing | all-agents + draft | version → refreshed agent list → agent |
| nothing | all-agents only | Published agent list → agent |
| nothing / version only | no all-agents role | panel "No agent in this link" (no pod call) |

- Roles only gate choosing; a bound part is never checked or overridden (Oracle enforces `/debug` rights on the user's
  token — the role check is not security).
- The choice opens as a panel in place of the chat; the header's "Change agent" / "Change version" reopens it (Cancel
  returns to the chat unchanged); every change of run starts a new conversation. A Draft badge stays in the header while a
  draft runs.
- Agent list: BOSS `…/agents/v1/$en/workflows` through the BOSS endpoint, the rows the vendored Oracle aistudio CLI lists
  (`$filter=(status = '<version>' and sourceWorkflowCode = null [and (name ~LIKE '%q%' or workflowCode ~LIKE '%q%')])`,
  `$limit=25` / `$offset`), templates (`isTemplate`) and hidden rows (`hiddenFlag`) dropped; searchable by name or code,
  paged as the list scrolls (a JET DataProvider over the endpoint layer); each row shows name, code and a
  Published / Draft marker per version it has (one extra BOSS read per page). **[open]** whether an end-user token
  holding the chat roles may read these rows (both statuses) on a live pod — built and tested against the mock pod only.
- Refresh: the unbound parts the user chose (never a bound part) are kept in `sessionStorage` under
  `xxx-gnimsys-ai-chat:run:<location.pathname>:agent=<bound code or ->,version=<bound version or ->`, value
  `{workflowCode?, version?}`. On load a stored choice is re-checked (role still held, agent still listed for that
  version; a bound agent is checked against its own versions only, never against the list); one that fails is dropped
  and the panel shows with a note. A page that leaves nothing to choose any more (e.g. the draft role was lost) drops the
  stored value too, with the note above the chat when it would have run something else. Without storage (private
  windows) the panel shows.
- The list stops with an explicit error when the pod keeps reporting more agents without new ones (a page with no rows,
  or 3 pages in a row with no new agent), so it never calls the pod without end.
- Event `ai-chat-run-changed` (`detail.workflowCode`, `detail.version`) on every run change, the first run included.

A 401 answer whose body carries readable text (`detail` / `title` / `message`) shows that text under the re-login banner:
an endpoint says there what signing in means for it (the debug host's proxy: "Sign in to <instance> in the agent chat
first.").

## Component contract

| Property (attribute) | Type | |
|---|---|---|
| `config` | object or JSON string | required |
| `user` | object (`$application.user`) | required: `userName` (string, owner filter of the conversation list); `roles` (string[], optional) used by `ui.trace` and `ui.runSettings` |
| `person-id` | string | required when `files.enabled` |
| `context` | object | values for `{{key}}` in `agent.additionalContext` |
| `conversation-id` | string, writeback | current conversation; setting it opens that conversation |
| `rest-helper` | object | required: the page's VB RestHelper (`vb/helpers/rest`, `get(endpointId)`); every pod call goes through it |
| `endpoint` | object | required: the endpoint map, contract name -> VB endpoint id (`FUAI`, `BOSS`, and `FA` when `files.enabled`; see Required inputs) |

### Role-gated trace panel

`ui.trace: { "roles": ["AGENT_DEBUG"] }` (optional; absent = trace off for everyone; `roles` is a required
non-empty string array when present). A user whose `user.roles` contain at least one of those roles (exact,
case-sensitive match) sees, under each assistant reply, a `Trace (N)` toggle that expands to the agent's node
progress frames (`NODE_START CHAT_LLM (LLM) — Processing chat input…`) and the `traceId`. The panel grows live
while the reply streams. Without `user.roles` (or without a match) nothing is rendered. Roles come from the page:
in VB bind `user="[[ $application.user ]]"`.

Events: `ai-chat-conversation-changed` (`detail.conversationId`), `ai-chat-error` (`detail.message`,
`detail.status?` = the HTTP status when the call got one; `401` = an endpoint asks for a re-login),
`ai-chat-run-changed` (`detail.workflowCode`, `detail.version`; see Run selection). Methods:
`newConversation()`, `send(text)`, `openConversation(id)`; they throw while the component shows a needs-input/invalid
panel or no run is chosen yet. `ai-chat-submit` and `ai-chat-action` arrive with the
widgets in v1.1.

Sizing: the element is `display: block; width: 100%; height: 560px` by default, so it fills its container's width
even in a flex column that does not stretch its items; set your own `height` on `xxx-gnimsys-ai-chat` in the page
CSS, and the chat fills it with the feed scrolling inside.

## Dev loop (VB page on the pod, bundle from your machine)

The VB page stays on the pod (so its service connections, their tokens and every API call are real); only the
component's code is loaded from your local `ojet serve`.

1. Serve the component (dev build, CORS `Access-Control-Allow-Origin: *`, bound so Windows reaches it on
   port 8000):

   ```
   wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/dev.sh npm run serve'
   ```

   Check: `curl -sI http://localhost:8000/js/jet-composites/xxx-gnimsys-ai/chat/loader.js` answers `200`
   with `Access-Control-Allow-Origin: *`. The watcher recompiles on source edits made on Windows; reload
   the VB page to pick them up.
2. In the extension, add a runtime requirejs path for the pack in `settings/dependencies.json` (the same
   place the dashboard extension aliases its local component):

   ```json
   {
     "component-dependencies": {},
     "runtime": {
       "xxx-gnimsys-ai": {
         "requirejs": {
           "paths": { "xxx-gnimsys-ai": "http://localhost:8000/js/jet-composites/xxx-gnimsys-ai" }
         }
       }
     }
   }
   ```
3. In the page JSON, import the component, and add a page variable `chatConfig` (object) holding the config:

   ```json
   "imports": { "components": { "xxx-gnimsys-ai-chat": { "path": "xxx-gnimsys-ai/chat/loader" } } }
   ```
4. Place the tag in the page HTML:

   ```html
   <xxx-gnimsys-ai-chat config="[[ $page.variables.chatConfig ]]"
                        user="[[ $application.user ]]"
                        person-id="-1"></xxx-gnimsys-ai-chat>
   ```

Steps 2–4 follow the dashboard extension's working local alias; for this pack they are first exercised on
the pod in the dev1 spike.

Stop the serve:

```
wsl -d CloudBeaver -u root -e bash -lc 'docker kill $(docker ps -q --filter publish=8000)'
```

## Packaging and import into VB Studio

```
wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/dev.sh "npm run build:release && npm run package"'
```

Output in `dist/`:
- `xxx-gnimsys-ai.zip` — the whole pack in one archive (pack `component.json`, `chat/`, `libs/`
  (markdown-it + DOMPurify), release bundles in `min/`, typings in `types/`). Use this one for VB Studio
  and for a CDN copy.
- `xxx-gnimsys-ai_0-1-0.zip`, `xxx-gnimsys-ai-chat_0-1-0.zip`, `xxx-gnimsys-ai-libs_0-1-0.zip` — ojet's
  Component Exchange form (pack descriptor + one zip per member).

`npm run package` refuses a staged dev build (no `min/`): always run `build:release` first. Test fixtures
(`__tests__`) are not packaged.

Import (Oracle's steps for a component ZIP): in VB Studio open the **App UIs** tab, expand the global
**Resources** node, right-click **components** → **Import**, drop `dist/xxx-gnimsys-ai.zip`, click
**Import**. Then point the pack's requirejs path (dev-loop step 2) at the imported copy instead of
`localhost:8000`, or at a CDN copy of the unzipped pack, and keep steps 3–4. Pack import into an App UI
extension is not yet proven on a pod: the dev1 spike confirms it.

## Testing

- Unit (Jest):
  `wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/dev.sh npm test'`
- End-to-end (Playwright, Chromium):
  `wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/e2e.sh npm run e2e'`.
  It starts the **mock pod** (`tests/mock-pod/server.mjs`, port 8787: `/chat` and `/debug` SSE, BOSS
  conversations and workflows, messages, attachments; its token-relay and anti-CSRF routes remain only until the
  `fusionShell` removal) and `MOCK_POD=1 npm run serve`, which proxies the page's `/api`, `/fscmRestApi`, `/hcmRestApi`
  calls to the mock. The host page passes the mock rest helper (`src/ts/dev/mock-rest-helper.ts`, VB's RestHelper
  interface) and an endpoint map whose service connections point at the page's origin, so the endpoint path runs offline.

## Debug host (agent builders' debugger, spec §17.1)

A second build flavour of this repo's app shell, for the fusion-ai-agent UI's side panel (iframe, same origin):
`npm run build:debug-host` (= `ojet build --release --user-options=debug-host`; `scripts/hooks/debug-host.js`):

- Page `debug-host/index.html` instead of `src/index.html`, entry `src/ts/debug-host/root.ts` instead of `src/ts/root.ts`:
  the rest helper is fixed per build (the dev mock's modules are removed from this output).
- Bound from its URL only, no picker and no inputs: the agent chat opens it as
  `/ai-chat-debug/?pod=/api/pod/c/<conversationId>/&workflow=<code>&version=DRAFT|PUBLISHED`. All three are required;
  `pod` must be the conversation-scoped proxy base (`^/api/pod/c/[^/?#]+/$`, unchanged by the URL parser); a parameter
  missing, repeated or invalid, or an unknown one, shows the panel "Open the debugger from the chat — ask the agent to
  debug a workflow" naming the problem, and nothing is requested (the agent UI's header button opens the bare page).
- With a complete binding the page reads `GET <pod>_info` (`{instance, podUser?}`) and mounts the chat with
  `agent.workflowCode` / `agent.version` from the URL (PUBLISHED with `agent.publishedVia: "debug"`: the published run
  goes through `/debug` with `status: "PUBLISHED"`, so its stream carries node data as a draft's does; VB end-user pages
  keep `/chat`), `ui.modeSwitch`, `ui.debug.rawFrames`, `ui.trace.roles` = `["AI_CHAT_DEBUGGER"]` paired with
  `user.roles`, and `user.userName` = `podUser` (absent: the chat's needs-input
  panel, never the Keycloak name). `_info` answering `401 auth-required` (no pod sign-in on the conversation) shows "Sign
  in to the pod through the agent chat, then ask the agent to open the debugger again."; any other failure shows its
  reason. Attachments are off with a notice: there is no reliable read of the pod user's PersonId through the FA endpoint
  yet.
- Rest helper `src/ts/debug-host/podProxyRestHelper.ts`: VB's RestHelper chain (hooks, body format) over the engine's
  same-origin proxy `ANY <pod><TARGET>/<pod-path>` (the conversation's bound instance and pod sign-in) with
  `X-Gnimsys-Pod-Proxy: 1` and same-origin credentials; endpoint map `{FA: "FA", …}`. The chat streams through it with
  the data pack's VB stream provider, as on a pod. Refused before sending: a path outside the target's prefixes, a header
  the proxy does not forward. Proxy states (`X-Gnimsys-Pod-Proxy-Error`) get a readable `detail`: `auth-required` → the
  re-login banner "Sign in to <instance> in the agent chat first."; the others → the call's error text.
- Served from the build only: JET 19, Redwood and the Core Pack from `node_modules`; Oracle's UX icon font (the version
  pinned by `oraclejetconfig.json` `fontUrl`) downloaded once per version into `node_modules/.cache/ojux-iconfont/` (its
  own layer in the image) and copied into `css/ojux/<version>/`; the bundle is `js/bundle.<sha256:16>.js`. The build
  fails on any remaining remote `href`/`src`.
- Image `gnimsys/ai-chat-debug` (`debug-host/Dockerfile`, context = repo root; nginx serving `/ai-chat-debug/`, see
  `debug-host/nginx.conf` and `debug-host/deploy.yml`).
- e2e: `scripts/e2e.sh npm run e2e:debug-host` — the release build behind a fake of the proxy's conversation form
  (`tests/fake-pod-proxy/server.mjs`) in front of the mock pod.

## Known limits (v1.0)

- Same-origin only: works in a Fusion App UI extension, not in a standalone VB app on another origin.
- Endpoints only: every call goes through `rest-helper` + `endpoint` (VB service connections own the requests and their
  tokens; the component mints none). The unused `fusionShell` modules (anti-CSRF + token relay) and the
  `auth.kind: "fusionShell"` config value remain only until their removal (endpoint slice, Task 5).
- Conversation history (`conversations/v1/{id}/messages`) answered HTTP 500 on dev1: opening an older
  conversation then shows "History unavailable (HTTP n): <error text>" at the top of the feed and the user
  can continue it.
- Widgets (`gnimsys-ui` form/table/choice, `ai-chat-submit`, `ai-chat-action`) are v1.1.
- No cancel API: a running reply cannot be stopped; leaving the conversation only closes the local stream.
- Attachments: when a send fails, the files stay pending and are uploaded again on the next send.
