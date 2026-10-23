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
- Auth kind `fusionShell` (the only kind in v1.0): the component fetches an anti-CSRF token from
  `GET /fscmRestApi/anticsrf` (same-origin, session cookie), then gets a bearer per audience from
  `/fscmRestApi/tokenrelay` and adds it itself. This works on any same-origin Fusion/VB page: no shell node is needed.
- The pod's AI Studio protocol version pinned in the config (`protocol.checkVersion`, `2607100` when built).
  Oracle's API is undocumented and drifts per release: re-test on every pod upgrade.

## Config v1

Published contract: [`chat/schemas/config-v1.schema.json`](src/ts/jet-composites/xxx-gnimsys-ai/chat/schemas/config-v1.schema.json)
(also inside the package). The schema sketch in the design spec §5.4 shows the planned full shape; in v1.0
`auth.kind` accepts only `"fusionShell"`, and `widgets`/`datasources` are accepted but have no effect yet
(v1.1). A v1.0 config:

```json
{
  "agent": {
    "workflowCode": "KRN_INV_TXN_WIZARD",
    "pod": "evbp-dev1",
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
| `agent.workflowCode` | config | the published AI Studio workflow (agent team) code |
| `agent.pod` | config | pod id used in the token-relay scope `urn:opc:resource:fusion:<pod>:<audience>/` |
| `auth.kind` | config | `"fusionShell"` |
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

## Component contract

| Property (attribute) | Type | |
|---|---|---|
| `config` | object or JSON string | required |
| `user` | object (`$application.user`) | required: `userName` (string, owner filter of the conversation list); `roles` (string[], optional) used by `ui.trace` |
| `person-id` | string | required when `files.enabled` |
| `context` | object | values for `{{key}}` in `agent.additionalContext` |
| `conversation-id` | string, writeback | current conversation; setting it opens that conversation |
| `rest-helper`, `endpoint` | object / object or string | accepted for the future `vb` auth kind, unused in v1.0 |

### Role-gated trace panel

`ui.trace: { "roles": ["AGENT_DEBUG"] }` (optional; absent = trace off for everyone; `roles` is a required
non-empty string array when present). A user whose `user.roles` contain at least one of those roles (exact,
case-sensitive match) sees, under each assistant reply, a `Trace (N)` toggle that expands to the agent's node
progress frames (`NODE_START CHAT_LLM (LLM) — Processing chat input…`) and the `traceId`. The panel grows live
while the reply streams. Without `user.roles` (or without a match) nothing is rendered. Roles come from the page:
in VB bind `user="[[ $application.user ]]"`.

Events: `ai-chat-conversation-changed` (`detail.conversationId`), `ai-chat-error` (`detail.message`,
`detail.status?`, `detail.reason?` = `xsrf-unavailable` | `token-undecodable` | `clock-skew` when chat auth is
unavailable). Methods: `newConversation()`, `send(text)`, `openConversation(id)`; they throw while
the component shows a needs-input/invalid panel. `ai-chat-submit` and `ai-chat-action` arrive with the
widgets in v1.1.

Sizing: the element is `display: block; width: 100%; height: 560px` by default, so it fills its container's width
even in a flex column that does not stretch its items; set your own `height` on `xxx-gnimsys-ai-chat` in the page
CSS, and the chat fills it with the feed scrolling inside.

## Dev loop (VB page on the pod, bundle from your machine)

The VB page stays on the pod (so `fusionShell` auth and every API call are real); only the component's
code is loaded from your local `ojet serve`.

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

- Unit (Jest, 110 tests):
  `wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/dev.sh npm test'`
- End-to-end (Playwright, Chromium):
  `wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/e2e.sh npm run e2e'`.
  It starts the **mock pod** (`tests/mock-pod/server.mjs`, port 8787: token relay, `/chat` SSE, BOSS
  conversations, messages, attachments) and `MOCK_POD=1 npm run serve`, which proxies the page's
  `/api`, `/fscmRestApi`, `/hcmRestApi` calls to the mock. The mock answers `GET /fscmRestApi/anticsrf` with `test-xsrf`, so the real `fusionShell` path runs offline.

## Known limits (v1.0)

- Same-origin only: works in a Fusion App UI extension, not in a standalone VB app on another origin.
- Auth kind `fusionShell` only; `vb` (service connections through `rest-helper`/`endpoint`) waits for the
  dev1 spike. The anti-CSRF token comes from `/fscmRestApi/anticsrf` (a VB App UI extension page has no shell node).
- Conversation history (`conversations/v1/{id}/messages`) answered HTTP 500 on dev1: opening an older
  conversation then shows "History unavailable (HTTP n): <error text>" at the top of the feed and the user
  can continue it.
- Widgets (`gnimsys-ui` form/table/choice, `ai-chat-submit`, `ai-chat-action`) are v1.1.
- No cancel API: a running reply cannot be stopped; leaving the conversation only closes the local stream.
- Attachments: when a send fails, the files stay pending and are uploaded again on the next send.
