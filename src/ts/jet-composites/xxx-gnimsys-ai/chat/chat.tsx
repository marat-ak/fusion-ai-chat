import { Action, ExtendGlobalProps, PropertyChanged, registerCustomElement } from "ojs/ojvcomponent";
import { ComponentProps, ComponentType, Ref } from "preact";
import { forwardRef } from "preact/compat";
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from "preact/hooks";
import componentStrings = require("ojL10n!./resources/nls/chat-strings");
import "css!xxx-gnimsys-ai/chat/chat-styles.css";
import { checkInputs } from "./lib/config/checkInputs";
import { availableModes } from "./lib/config/modes";
import { withRun } from "./lib/config/types";
import type { ChatMode, Run } from "./lib/config/types";
import { errorDetail } from "./lib/errors";
import type { RunObserver } from "./lib/debug/RunObserver";
import { choosesAgent } from "./lib/run/plan";
import { ChatShell } from "./ui/ChatShell";
import type { ChatHandle } from "./ui/ChatShell";
import { CheckingPanel, NoAgentPanel, RunPanel } from "./ui/RunPanel";
import { StatePanel } from "./ui/StatePanel";
import type { ChatErrorDetail } from "./ui/useChatController";
import { useRunSelection } from "./ui/useRunSelection";
import type { VbRestHelper } from "xxx-gnimsys-data/rest/index";

type Props = Readonly<{
  /** Agent configuration (config-v1 schema), as an object or a JSON string. Required. */
  config?: object | string;
  /**
   * The VB application user object (`$application.user`); the component reads `userName` and `roles`. `userName` is
   * required: it is the owner filter for the user's conversations. With `config.ui.trace` set, a user holding one of its
   * `roles` sees the agent's node trace under each reply; with `config.ui.runSettings`, `roles` decide who may choose an
   * agent or a draft the page did not bind.
   */
  user?: { userName?: string; roles?: string[]; [k: string]: unknown };
  /**
   * Oracle PersonId of the user, sent in the attachments' conversation row. Optional: without it the row is created
   * without PersonId (as Studio's own clients do); a pod that refuses such a row fails the upload with that reason.
   */
  personId?: string;
  /**
   * Debug hosts only (the agent builders' debugger): an object with `breakPoints()` (the node codes the next Studio
   * `/debug` runs stop before) and `turn(start)` (receives each turn's request and returns a sink for its raw SSE frames
   * and its end). Without it nothing is captured and runs carry no breakpoints. VB end-user pages leave it unset.
   */
  runObserver?: object;
  /** Page values substituted into {{key}} placeholders of config.agent.additionalContext. */
  context?: Record<string, unknown>;
  /** Id of the current conversation (in/out). Setting it switches the chat to that conversation. */
  conversationId?: string;
  /** The page's VB RestHelper (`vb/helpers/rest`): every pod call goes through it and the endpoint map. Required. */
  restHelper?: object;
  /**
   * The endpoint map: contract endpoint name (FA, FUAI, BOSS, SAASBATCH, KM, SALESCOMMON) -> VB endpoint id of the
   * service connection that owns those calls and their token (its scope carries the pod). Required: FUAI and BOSS, and FA
   * when config.files.enabled.
   */
  endpoint?: Record<string, string>;
  onConversationIdChanged?: PropertyChanged<string>;
  /** Fired when the chat switches to another conversation (new or opened). */
  onAiChatConversationChanged?: Action<{ conversationId: string }>;
  /**
   * Fired when a reply fails, an endpoint answers 401 (the session needs a re-login), the agent lookup fails, or a
   * conversation list/history/name/rename/delete or attachment call fails. `status`: the HTTP status, when there was one.
   */
  onAiChatError?: Action<{ message: string; status?: number }>;
  /**
   * Fired whenever the run changes: the workflow and version the chat runs, bound by the page or chosen by the user
   * (the first run included). A change of run always starts a new conversation.
   */
  onAiChatRunChanged?: Action<{ workflowCode: string; version: "PUBLISHED" | "DRAFT" }>;
}>;

// The Core Pack (oj-c) components imported by ui/*.tsx, named as in the runtime's oj-c catalog; the pod's JET runtime
// provides them (dependencyScope "runtime"), so they are declared here and never bundled. xxx-gnimsys-data-rest: the
// endpoint layer (DashboardRestHelper) of the shared data pack, imported by ui/useChatController.ts.
/**
 * @ojmetadata pack "xxx-gnimsys-ai"
 * @ojmetadata version "0.1.0"
 * @ojmetadata displayName "Gnimsys AI Chat"
 * @ojmetadata description "Chat with an Oracle AI Agent Studio agent"
 * @ojmetadata dependencies {
 *   "oj-c-avatar": "^19.0.0",
 *   "oj-c-badge": "^19.0.0",
 *   "oj-c-button": "^19.0.0",
 *   "oj-c-buttonset-single": "^19.0.0",
 *   "oj-c-collapsible": "^19.0.0",
 *   "oj-c-drawer-layout": "^19.0.0",
 *   "oj-c-input-text": "^19.0.0",
 *   "oj-c-list-item-layout": "^19.0.0",
 *   "oj-c-list-view": "^19.0.0",
 *   "oj-c-menu-button": "^19.0.0",
 *   "oj-c-message-banner": "^19.0.0",
 *   "oj-c-message-toast": "^19.0.0",
 *   "oj-c-progress-circle": "^19.0.0",
 *   "oj-c-text-area": "^19.0.0",
 *   "oj-c-toggle-button": "^19.0.0",
 *   "oj-c-truncating-text": "^19.0.0",
 *   "xxx-gnimsys-data-rest": "^0.1.0"
 * }
 */
function ChatImpl(props: Props, ref: Ref<ChatHandle>) {
  const { config, user, personId, restHelper, endpoint, runObserver } = props;
  const check = useMemo(
    () => checkInputs(config, user, personId, restHelper, endpoint, runObserver), [config, user, personId, restHelper, endpoint, runObserver],
  );

  // Methods delegate to the mounted shell; with a needs-input/invalid config, or before a run is chosen, there is none and
  // they throw.
  const shell = useRef<ChatHandle | null>(null);
  useImperativeHandle(ref, () => {
    const live = (): ChatHandle => {
      if (shell.current === null) throw new Error("xxx-gnimsys-ai-chat has no running chat (config needs input or is invalid, or no agent is chosen yet): see its panel");
      return shell.current;
    };
    return {
      newConversation: () => live().newConversation(),
      send: (text: string) => live().send(text),
      openConversation: (id: string) => live().openConversation(id),
    };
  }, []);

  const propsRef = useRef(props);
  propsRef.current = props;
  const onConversationIdChanged = useCallback((id: string) => propsRef.current.onConversationIdChanged?.(id), []);
  const onConversationChanged = useCallback((id: string) => propsRef.current.onAiChatConversationChanged?.({ conversationId: id }), []);
  const onError = useCallback((detail: ChatErrorDetail) => propsRef.current.onAiChatError?.(detail), []);
  const onRunChanged = useCallback(
    (run: Run) => propsRef.current.onAiChatRunChanged?.({ workflowCode: run.workflowCode, version: run.version }), [],
  );
  const onRunError = useCallback((e: unknown) => propsRef.current.onAiChatError?.(errorDetail(e)), []);

  // The run (design §5.1): bound by the page, or chosen by the user as ui.runSettings and their roles allow. checkInputs
  // has validated the rest helper and the endpoint map whenever check.ok.
  const selection = useRunSelection(check.ok ? check.config : null, user?.roles ?? [], restHelper as VbRestHelper | undefined,
    endpoint as Record<string, string> | undefined, onRunChanged, onRunError);
  const run = selection?.state.run ?? null;
  const generation = selection?.state.generation ?? 0;

  // Mode: the config's, until the header's switch (ui.modeSwitch) picks another; a new config mode starts over from it.
  const configMode: ChatMode | undefined = check.ok ? check.config.mode : undefined;
  const [picked, setPicked] = useState<{ base: ChatMode | undefined; mode: ChatMode } | null>(null);
  const mode = picked !== null && picked.base === configMode ? picked.mode : configMode;
  const onModeChange = useCallback((m: ChatMode) => setPicked({ base: configMode, mode: m }), [configMode]);
  const switched = mode !== configMode;
  // The shell's config, stable across renders: the controller's services are memoized on it, so a new object per render
  // would rebuild them (and reload the list and the workflow) on every property writeback.
  const shellConfig = useMemo(
    () => (check.ok && run !== null ? { ...withRun(check.config, run), mode: mode as typeof check.config.mode } : null), [check, mode, run],
  );

  if (!check.ok) {
    return (
      <div class="gai-chat oj-sm-height-full oj-typography-body-md oj-text-color-primary">
        <StatePanel kind={check.kind} problems={check.problems} />
      </div>
    );
  }
  const phase = selection?.state.phase;
  const plan = selection?.plan;
  return (
    <div class="gai-chat oj-sm-height-full oj-typography-body-md oj-text-color-primary">
      {phase === "no-agent" && <NoAgentPanel />}
      {phase === "checking" && <CheckingPanel />}
      {phase === "choosing" && selection !== null && plan?.kind === "choose" && (
        <RunPanel plan={plan} current={run} note={selection.state.note} directory={selection.directory} onChoose={selection.choose}
          {...(run !== null && { onCancel: selection.cancel })} onError={onRunError} />
      )}
      {shellConfig !== null && run !== null && (
        // While the run panel is open from "Change", the chat stays mounted behind it, so Cancel returns to it unchanged.
        <div class="oj-sm-height-full" hidden={phase !== "running"}>
          <ChatShell
            // Another run (agent or version: a new generation), mode or endpoint map (another pod) is another chat: remount
            // so no turns or conversation id carry over to it.
            key={`${JSON.stringify(endpoint)}/${run.workflowCode}/${run.version}/${generation}/${mode}`}
            config={shellConfig}
            strings={componentStrings.chat}
            userName={(user as { userName: string } /* checkInputs: userName non-empty */).userName}
            {...(personId !== undefined && { personId })}
            // checkInputs: a RunObserver when set.
            {...(runObserver !== undefined && runObserver !== null && { runObserver: runObserver as RunObserver })}
            userRoles={user?.roles ?? []}
            {...(props.context !== undefined && { context: props.context })}
            // The host's conversation belongs to the first run in the config's mode: a run change or a mode switch starts a
            // new conversation.
            {...(props.conversationId !== undefined && !switched && generation === 1 && { conversationId: props.conversationId })}
            {...(check.config.ui.modeSwitch && { modeSwitch: { modes: availableModes(shellConfig), value: mode as ChatMode, onChange: onModeChange } })}
            {...(plan?.kind === "choose" && selection !== null && {
              runChange: { label: choosesAgent(plan) ? "Change agent" : "Change version", onChange: selection.openChooser },
            })}
            {...(phase === "running" && selection !== null && selection.state.note !== null && { runNote: selection.state.note })}
            // checkInputs: a RestHelper (get()) and an endpoint map with every name the config needs.
            restHelper={restHelper as VbRestHelper}
            endpoints={endpoint as Record<string, string>}
            handleRef={shell}
            onConversationIdChanged={onConversationIdChanged}
            onConversationChanged={onConversationChanged}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}

export const Chat: ComponentType<ExtendGlobalProps<ComponentProps<typeof ChatImpl>>> = registerCustomElement<Props, ChatHandle>(
  "xxx-gnimsys-ai-chat",
  forwardRef(ChatImpl),
);
