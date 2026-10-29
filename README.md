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
`auth.kind` accepts only `"fusionShell"`; `datasources` and `widgets` govern the `gnimsys-ui` blocks (see Widgets).
A v1.0 config:

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
| `run-observer` (element property, not config) | absent | Debug hosts only: an object with `breakPoints()` and `turn(start)` (`lib/debug/RunObserver.ts`). With it the chat hands over every turn's request as sent, every SSE `data:` payload verbatim with its arrival time, and the turn's end, and each `/debug` send carries `breakPoints()` as `debugParams.breakPoints` (Studio's breakpoints: the run stops before those nodes); a `/chat` run with breakpoints is refused before anything is sent. Without it nothing is captured and runs carry `breakPoints: []`. The debug host's Run Inspector is built on it; VB end-user pages leave it unset. It replaces the former `ui.debug.rawFrames` panel: `ui.debug` is now an unknown key. |

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
| `person-id` | string | optional: Oracle `PersonId` sent in the attachments' conversation row; absent = the row is created without `PersonId` (as Studio's own clients do on `/debug`); a pod refusing such a row fails the upload with "the conversation row was sent without PersonId" in its error; an empty string is invalid |
| `run-observer` | object | debug hosts only, see Debugger keys |
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
                        user="[[ $application.user ]]"></xxx-gnimsys-ai-chat>
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
  `/ai-chat-debug/?pod=/api/pod/c/<conversationId>/&workflow=<code>&version=DRAFT|PUBLISHED&gnimsysUi=1|0`. All four are
  required; `pod` must be the conversation-scoped proxy base (`^/api/pod/c/[^/?#]+/$`, unchanged by the URL parser);
  `gnimsysUi` is exactly `1` (the chat sets `agent.additionalContext` `{"gnimsysUi": 1}`, so every run-start message
  carries `parameters.additional_context` `"{\"gnimsysUi\":1}"`) or `0` (no additional context: the run looks like
  Oracle's own chat; the chat still renders any `gnimsys-ui` block it receives); a parameter
  missing, repeated or invalid, or an unknown one, shows the panel "Open the debugger from the chat — ask the agent to
  debug a workflow" naming the problem, and nothing is requested (the agent UI's header button opens the bare page).
- With a complete binding the page reads `GET <pod>_info` (`{instance, podUser?}`) and mounts the chat with
  `agent.workflowCode` / `agent.version` from the URL (PUBLISHED with `agent.publishedVia: "debug"`: the published run
  goes through `/debug` with `status: "PUBLISHED"`, so its stream carries node data as a draft's does; VB end-user pages
  keep `/chat`), `ui.modeSwitch`, files on (`files.enabled`, 50 MB per file — within the proxy's 64 MiB
  `maxRequestBytes` — `protocol.hcmRestBase` `/hcmRestApi/rest/latest/en/11.13.18.05:9`, **`person-id="-1"`** (`DEBUG_PERSON_ID`): the
  pod refuses the conversation row without `PersonId` (HTTP 400, o:errorCode 27014), and `"-1"` is what Oracle's own
  chat client sends without a user id — a trial (bridge design §13.2): whether a file under a `"-1"` row reaches the
  run (`$system.$ucmIdList` in the step's Context) is unverified), the page's run observer
  (`run-observer`, the Run Inspector's record), `user.userName` = `podUser` (absent: the chat's needs-input panel, never
  the Keycloak name) and no roles. `_info` answering `401 auth-required` (no pod sign-in on the conversation) shows "Sign
  in to the pod through the agent chat, then ask the agent to open the debugger again."; any other failure shows its
  reason.
- Two tabs: **Chat** (the component) and **Run** (the Run Inspector, below). The chat's own trace panel (`ui.trace`) is
  not used here.
- Rest helper `src/ts/debug-host/podProxyRestHelper.ts`: VB's RestHelper chain (hooks, body format) over the engine's
  same-origin proxy `ANY <pod><TARGET>/<pod-path>` (the conversation's bound instance and pod sign-in) with
  `X-Gnimsys-Pod-Proxy: 1` and same-origin credentials; endpoint map `{FA: "FA", …}`. The chat streams through it with
  the data pack's VB stream provider, as on a pod. Refused before sending: a path outside the target's prefixes, a header
  the proxy does not forward. Proxy states (`X-Gnimsys-Pod-Proxy-Error`) get a readable `detail`: `auth-required` → the
  re-login banner "Sign in to <instance> in the agent chat first."; the others → the call's error text.
- Served from the build only: JET 19, Redwood and the Core Pack from `node_modules`; Oracle's UX icon font (the version
  pinned by `oraclejetconfig.json` `fontUrl`) downloaded once per version into `node_modules/.cache/ojux-iconfont/` (the
  checkout's `node_modules` volume; only that first download needs internet) and copied into `css/ojux/<version>/`; the
  bundle is `js/bundle.<sha256:16>.js`. The build fails on any remaining remote `href`/`src`.
- Delivered as the folder **`dist/debug-host/`** (gitignored; replaced whole by every `build:debug-host`): `index.html`
  plus its relative assets. This repo runs no service for the page: **agent-ui** copies that folder into its image at
  build time and serves it at `/ai-chat-debug/` on the fusion-ai-agent vhost (bridge design §10 item 6). Build it without
  publishing ports (so it runs beside a dev serve):
  `wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/e2e.sh npm run build:debug-host'`.
- Serving contract for agent-ui: `/ai-chat-debug` redirects to `/ai-chat-debug/`; the page shell (`/ai-chat-debug/`,
  `index.html`) is `Cache-Control: no-cache` with `Content-Security-Policy: frame-ancestors 'self'` (only our origin
  frames it: the agent UI's side panel); the content-hashed bundle `js/bundle.<16 hex>.js` and the version-named
  directories `js/libs/oj/<version>/`, `css/redwood/<version>/`, `css/theme-redwood/<version>/`, `css/ojux/<version>/`
  are `public, max-age=31536000, immutable`; every other file `no-cache`; all with `X-Content-Type-Options: nosniff`;
  no SPA fallback. The page's `/api/pod/*` calls go to the engine on the same origin.
- e2e: `scripts/e2e.sh npm run e2e:debug-host` — the build, served from `dist/debug-host/`, behind a fake of the proxy's
  conversation form (`tests/fake-pod-proxy/server.mjs`) in front of the mock pod.

### Run Inspector (bridge design §13; debug host only, never in the VB pack)

`src/ts/debug-host/run/` (pure, unit-tested) and `src/ts/debug-host/inspector/` (Preact, rendered into `#dbg-run`
outside Knockout: `data-oj-binding-provider="none"`, which classic JET components there need).

- **Record** (`run/runStore.ts`): the chat's run observer — per turn the request as sent, every raw frame with its arrival
  time, the end; the BOSS `version` of the workflow row read right after each turn (the saved draft the run most likely
  executed). In memory, client-only.
- **Run model** (`run/frames.ts`): Oracle's frame model — `NODE_EXECUTED` (instant node) or a `NODE_START`…`NODE_END`
  pair; steps numbered in completion order (`NODE_EXECUTED` | `NODE_END`, the rule `fai_workflow_run` uses, so the user
  and the builder agent mean the same "step 12"); `CHILD_NODE_*` read as plain types; durations exact for pairs, an upper
  bound for single frames; JSON inside JSON strings decoded (`run/decode.ts`, three levels); Oracle's 10 000-character cut
  (`.....`) marked as cut, not malformed; `$variables` diffs between steps (`run/diff.ts`).
- **Graph**: the run's workflow definition from BOSS `…/$en/workflows?$fields=workflowCode,status,version,specification&
  $filter=workflowCode='<code>' and status='<version>'` (the CLI's read; `specification` as a JSON string or an object),
  through the conversation's proxy (BOSS target); drawn with classic **`oj-diagram`** at **Studio's own canvas
  positions** (`diagram.x/y`; a LOOP keeps its box around its body; an END without a position is not drawn, as in
  Studio), edges routed orthogonally, the run's nodes coloured by state (done / cut / error / waiting / stopped before a
  breakpoint / not run) with their step numbers, the taken edges strong. **No layout of our own**: without a readable
  definition, or with a node lacking Studio x/y, the Steps view only, with a notice naming why. A definition saved after a
  run (another BOSS version) is named on that run.
- **UI**: turn selector (every turn of the page), Graph | Steps, a stepper (first / previous / next / last / play, ←/→),
  the selected step in tabs — Overview (timings, branch taken, cut / console / timeout), Input, Output, Vars Δ, Context,
  Calls (function/LLM calls: status, time, tokens, model), Compare (the same node in another turn), Raw (the frames
  verbatim) — JSON shown with classic `oj-tree-view` (decoded strings and cuts marked, copy value / path), a search
  through every step's data, the turn's metrics, the breakpoint verdict, Export.
- **Breakpoints**: ONE set ("stop before" node codes, `run/runStore.ts`), edited by the user in the Run tab and by the
  agent (panel message below); **last writer wins** — the agent's message replaces the whole set, and the page's banner
  says so (`The agent set breakpoints: X (replacing Y).`). The user sets and removes them: **on the map** (the round
  marker at a card's top-right corner: hollow = click to stop before the node, filled = set, click again to remove; it
  also selects the card, whose panel shows the node with the same toggle even before any run), in **"Stop before (next
  runs)"** (`oj-c-select-multiple` of every node of the definition, nested ones included, searchable by code or name;
  its value is the set; a set code the definition lacks is listed as "(not in the definition)" and named in a warning),
  and with the step detail's **"Stop before this node" / "Remove the breakpoint"** button (same toggle). Without a
  readable definition: a code field (`CODE[,CODE…]`, `[A-Za-z0-9_]+`) and removable chips, with the notice that codes
  cannot be checked. Kept in the browser tab's `sessionStorage` per workflow + version
  (`xxx-gnimsys-ai-debug:breakpoints:<wf>:<version>`, `run/breakpointStorage.ts`): a reload restores them with a notice,
  a reset keeps them, closing the tab drops them; a damaged stored value is dropped with a warning. Named in a banner
  above the chat; sent as `debugParams.breakPoints` of the next `/debug` runs (resumes included; a `/chat` run is refused
  while any is set), carried in Export (`breakpoints` and each turn's `request`). Marker changes never touch the
  diagram's data (no re-layout), and the user's pan and zoom survive resizes (`ojBeforePanZoomReset` is cancelled; the
  focus is applied only when it changes). A stop is labelled **verified** only when the
  output equals the last executed node's output and a not-executed breakpoint node is a direct graph successor of the
  last executed node (`run/breakpoints.ts`, `fai_workflow_run`'s rule); otherwise "unverified" with the reason.
- **Full screen**: the header's "Full screen" / "Exit full screen" button (`oj-c-button`, Redwood maximize / minimize
  icon) puts the WHOLE page (chat + Run inspector) full screen with `document.documentElement.requestFullscreen()`; Esc
  or the button comes back; the graph and the detail take the extra space. The button is hidden when
  `document.fullscreenEnabled` is false (the framing page does not allow it). A refusal is shown in the banner, never
  swallowed. Standalone (`/ai-chat-debug/` in a browser tab) it always works; in the agent UI's side panel it needs the
  panel frame's `allow="fullscreen"` (engine `PANEL_IFRAME_ALLOW`).
- **Export** (`run/exporter.ts`): button or panel message → one JSON file (`debug-<workflow>-<version>-<time>.json`,
  Blob download): `{kind: "gnimsys-ai-chat-debug-export", formatVersion: 1, exportedAt, binding {pod, instance, podUser,
  workflowCode, version}, breakpoints, masked, conversations: [{conversationId, turns: [{seq, sentAt, endedAt, endpoint,
  path, request, error?, outcome, jobId, traceIds, steps, definitionVersion, frames: [{at, payload}]}]}]}`. Credential
  values are masked as `[redacted]` — the pod proxy recording's key list (`callbackToken`, `messageInstanceId`, auth
  headers, token and secret names), in requests and frames, inside JSON strings too. Needs `allow-downloads` in the agent
  UI's panel sandbox.
- **Panel messages** (`run/panelMessages.ts`, bridge design §13.1): `window` `message` events from **this origin** and
  **the parent window** only, envelope `{gnimsys: "side-panel-message", id, message}`; `{type: "export"}`,
  `{type: "reset", export: "true"|"false"}` (export first when "true", then `newConversation()` and an empty record;
  the breakpoints stay), `{type: "breakpoints", nodes: "" | "CODE[,CODE…]"}`. Anything else of ours is refused with its
  reason in the page's banner; other messages are ignored.
- **Golden fixtures**: `tests/mock-pod/fixtures/debug-wizard-workflow.json` and `debug-wizard-turn1.sse` / `turn2.sse` —
  a real 72-node DRAFT workflow (with a LOOP, 30 error paths, Studio positions) and two real `/debug` turns of it (17 and
  24 steps, cut values, BO and LLM calls), **sanitized**: structure, timings, node types, positions and Oracle's cuts kept;
  every value, key below the frame structure, node code, name and case label replaced (no token, host, user or customer
  data). The mock pod serves them as `WIZARD_WF` (and `NOXY_WF` without positions, both hidden rows), answers message
  "start" with turn 1 and anything else with turn 2, stops a run before its breakpoints as Oracle does, and
  `/__mock/arm?wizardVersion=<n>` simulates a saved draft.

## Widgets (`gnimsys-ui` block v1, rev 2)

Published contract: [`chat/schemas/gnimsys-ui-v1.schema.json`](src/ts/jet-composites/xxx-gnimsys-ai/chat/schemas/gnimsys-ui-v1.schema.json)
(`$id` `https://gnimsys.com/schemas/ai-chat/gnimsys-ui-v1.json`, JSON Schema 2020-12; design
`docs/superpowers/specs/2026-10-26-gnimsys-ui-block-v1-design.md`, rev 2). A workflow turn that needs a selection or a
decision puts a fenced block in its reply; the component takes the blocks out before the markdown renders, validates
each one against the contract and mounts a form in its place (`oj-c-form-layout` with `oj-c-select-single` /
`oj-c-select-multiple` / `oj-c-radioset` / `oj-c-checkboxset` — the rich sets when an option carries a `description` —
and `oj-c-button`s). Several blocks per reply are fine; the markdown around them renders as usual; Oracle's follow-up
chips are unrelated and stay. An invalid block (bad JSON, schema violation, unknown `v`/`kind`/`type`, duplicate ids, a
`select` with both or neither option source, buttons without or with equal `data`) is shown as an error box with the
reason and the raw text, never dropped. While a reply streams, a block is rendered only once its closing fence has
arrived (until then its text shows as plain text); its controls mount once the turn has ended.

### Block examples

A select with inline options (the KRN "destination subinventory" turn — `tests/mock-pod/fixtures/chat-widget-subinv.sse`
carries the 24-option version):

````markdown
```gnimsys-ui
{ "v": 1, "kind": "form", "id": "destSubinv", "title": "Select the destination subinventory",
  "fields": [
    { "id": "subinv", "type": "select", "label": "Destination subinventory", "required": true,
      "options": [ { "value": "12200", "label": "12200 — Main Store" }, { "value": "12205", "label": "12205 — Raw Materials" } ] },
    { "id": "txnRef", "type": "hidden", "value": "KRN-TXN-1" } ],
  "buttons": [ { "id": "approve", "label": "Approve", "data": { "decision": "APPROVE" } },
               { "id": "back", "label": "Back", "validate": false, "data": { "decision": "BACK" } } ] }
```
````

A select whose options come from a Fusion REST datasource (the dashboard datasource shape; `valueField` / `labelField`
name the row fields; `{{query}}` inside the url's `q` parameter is the server search the dropdown's text goes into;
`searchTemplate` = `minChars` (default 1) and `debounceMs` (default 250)):

````markdown
```gnimsys-ui
{ "v": 1, "kind": "form", "id": "pickSubinv", "title": "Pick a subinventory",
  "fields": [ { "id": "subinv", "type": "select", "label": "Subinventory", "required": true,
    "dataSource": { "type": "rest", "target": "FA", "method": "GET",
                    "url": "/fscmRestApi/resources/11.13.18.05/subinventories?q=Description LIKE '{{query}}%'&fields=SubinventoryCode,Description" },
    "valueField": "SubinventoryCode", "labelField": "Description", "searchTemplate": { "minChars": 2 } } ],
  "buttons": [ { "id": "ok", "label": "OK", "data": { "decision": "OK" } }, { "id": "back", "label": "Back", "validate": false, "data": { "decision": "BACK" } } ] }
```
````

A radio choice (option `description` renders under the label, like the engine's AskBox), a multi-select:

````markdown
```gnimsys-ui
{ "v": 1, "kind": "form", "id": "nextStep",
  "fields": [ { "id": "step", "type": "radio", "label": "Next step", "required": true,
    "options": [ { "value": "submit", "label": "Submit", "description": "Post the transaction now" },
                 { "value": "modify", "label": "Modify", "description": "Change quantities first" } ] },
    { "id": "orgs", "type": "select", "multi": true, "label": "Organizations", "options": [ { "value": "13100", "label": "Head Office" } ] } ],
  "buttons": [ { "id": "go", "label": "Go", "data": { "decision": "GO" } } ] }
```
````

A checkbox list + hidden turn state + three buttons (one with an inline confirmation):

````markdown
```gnimsys-ui
{ "v": 1, "kind": "form", "id": "flags", "title": "Options",
  "fields": [ { "id": "flags", "type": "checkbox", "label": "Flags", "value": ["urgent"],
                "options": [ { "value": "urgent", "label": "Urgent" }, { "value": "notify", "label": "Notify supervisor" } ] },
              { "id": "txnRef", "type": "hidden", "value": "ABC-1" } ],
  "buttons": [ { "id": "approve", "label": "Approve", "confirm": "Post the transaction?", "data": { "decision": "APPROVE" } },
               { "id": "reject", "label": "Reject", "data": { "decision": "REJECT" } },
               { "id": "cancel", "label": "Cancel", "validate": false, "variant": "borderless", "data": { "decision": "CANCEL" } } ] }
```
````

Rules: `v` is `1`, `kind` is `form` (a choice is a form with one `radio` / `checkbox` field; `table` is reserved); ids
match `[A-Za-z0-9_-]{1,64}` and are unique within the block; `fields` has at least one entry; `buttons` has at least
one entry, each with a non-empty `data` object (scalars or arrays of scalars) that is unique within the block; the
first button is `callToAction` and the others `outlined` unless `variant` says otherwise; `validate` (default `true`)
makes a button refuse to submit while a `required` field is empty, `validate: false` (Back, Cancel) submits whatever is
there; `confirm` asks "<confirm> — OK / Cancel" inline first. Every button submits the same values plus its own `data`
— there is no non-submitting button.

### The submit envelope

One click = ONE user message: the readable line (`<button label> — <title>`, the label alone without a title), a
newline, then the envelope with EVERY field (hidden included) under its id — option values, never labels; `null` for an
unset single value, `[]` for an unset multi value — and the clicked button's `data` merged on top (button keys win):

```
Approve — Select the destination subinventory
<gnimsysSubmit id="destSubinv">{"subinv":"12200","txnRef":"KRN-TXN-1","decision":"APPROVE"}</gnimsysSubmit>
```

The workflow parses `$context.$system.$inputMessage` with `<gnimsysSubmit id="([^"]+)">(.*?)</gnimsysSubmit>`
(single-line; the JSON has no newlines), `JSON.parse`s group 2 and routes on the button's data key (a SWITCH on
`decision`). After the click the block is read-only (its values shown, buttons disabled, the button whose `data` the
submit carries marked); the user's bubble shows the readable line. A reply re-rendered from history shows its block
read-only when a later user turn of the conversation carries an envelope with the same `id`, live otherwise.

### Datasources, the endpoint data provider and the config overlay

A datasource select runs on the data pack's **endpoint data provider**
(`src/ts/jet-composites/xxx-gnimsys-data/rest/endpoint-data-provider.js`, a JET `RESTDataProvider` whose fetches go
through the ported `Endpoint` layer, i.e. the page's `rest-helper` / `endpoint` map). The server filters and pages;
thousands of rows are fine:

- **fetchFirst / fetchByOffset**: the dropdown's text replaces `{{query}}` in the url's `q` parameter (a single quote
  doubles, Fusion `q` style), and the Endpoint appends `q`, `limit` (= config `datasources.pageSize`, default 25) and
  `offset`. For the example url above and the text `Ra`:
  `/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description&q=Description+LIKE+%27Ra%25%27&limit=25&offset=0`.
  Text shorter than `minChars` answers an empty list without a request; a request waits `debounceMs` and is dropped
  when newer text arrives meanwhile. A url without `{{query}}` is still paged (its own `q`, if any, stays) with no
  server search — for small lists only. Do not put `limit` / `offset` in the url.
- **fetchByKeys** (the selected value's label, the chips of a multi-select, the read-only block): the url with its
  WHOLE `q` parameter removed, plus `q=<valueField> IN ('k1','k2')` and `limit` = the number of keys:
  `/fscmRestApi/resources/11.13.18.05/subinventories?fields=SubinventoryCode,Description&q=SubinventoryCode+IN+%28%2712002%27%29&limit=1`.
  A `{{query}}` anywhere else in the url is substituted in place for pages and blanked for keys.
- **Response**: rows = the body when it is an array, else `body.items`, else the array at
  `dataTransform: { "type": "map", "expression": "<dotted.path>" }`; `hasMore` = `body.hasMore` when present, else "a
  full page came back"; `totalResults` is passed through. `GET` only; `dataTransform.type: "lodash"` is accepted by the
  schema (the dashboard shape) but never evaluated by the chat (it is code): such a field, like a `POST` datasource,
  shows as unavailable.

An inline `dataSource` (one the agent wrote) is loaded only when the config's `datasources.allowInline` is `true` AND
its `url` starts with one of `datasources.allowPrefixes`; otherwise the field shows "datasource not allowed" and the
block submits only through its `validate: false` buttons. `target` is the endpoint name; the endpoint's own path
prefixes apply too.

The config overlay `widgets[widgetId].fields[fieldId]` gives a select field a datasource (+ `searchTemplate`) that wins
over the block's own options or datasource (a customer-owned source is not subject to `allowInline`):

```json
"datasources": { "allowInline": false, "pageSize": 25 },
"widgets": {
  "destSubinv": {
    "fields": {
      "subinv": {
        "dataSource": { "type": "rest", "target": "FA", "method": "GET", "url": "/fscmRestApi/resources/11.13.18.05/subinventories?q=Description LIKE '{{query}}%'" },
        "valueField": "SubinventoryCode", "labelField": "Description", "searchTemplate": { "minChars": 2 }
      }
    }
  }
}
```

Mock pod fixtures for the e2e (`tests/e2e/widgets.spec.ts`): message `pick subinventory` (the KRN block, 24 options,
Approve / Back), `pick from datasource` (an inline datasource searched and paged through the mock's 300-row
`/subinventories`), `choose next step` (radio + checkbox + hidden + confirm button, followed by an invalid block).

## Known limits (v1.0)

- Same-origin only: works in a Fusion App UI extension, not in a standalone VB app on another origin.
- Endpoints only: every call goes through `rest-helper` + `endpoint` (VB service connections own the requests and their
  tokens; the component mints none). The unused `fusionShell` modules (anti-CSRF + token relay) and the
  `auth.kind: "fusionShell"` config value remain only until their removal (endpoint slice, Task 5).
- Conversation history (`conversations/v1/{id}/messages`) answered HTTP 500 on dev1: opening an older
  conversation then shows "History unavailable (HTTP n): <error text>" at the top of the feed and the user
  can continue it.
- Widgets: the `gnimsys-ui` v1 `form` block only (see Widgets); `table`, `dependsOn` (cascading selects), text/number/date
  fields and the `ai-chat-submit` / `ai-chat-action` events are not built.
- No cancel API: a running reply cannot be stopped; leaving the conversation only closes the local stream.
- Attachments: when a send fails, the files stay pending and are uploaded again on the next send. Files can go without
  a text (the message is then `""`, as Oracle's chat client sends it) while every picked file is waiting to go — not
  after its upload failed (remove it, or add a text: a message with text retries the upload). A free-text HITL reply
  (a wait without approval) takes files the same way (`resumeInput.content` `""` without text); approve / reject /
  request-change replies take none.
