import { Action, ExtendGlobalProps, PropertyChanged, registerCustomElement } from "ojs/ojvcomponent";
import { ComponentProps, ComponentType, Ref } from "preact";
import { forwardRef } from "preact/compat";
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from "preact/hooks";
import componentStrings = require("ojL10n!./resources/nls/chat-strings");
import "css!xxx-gnimsys-ai/chat/chat-styles.css";
import { checkInputs } from "./lib/config/checkInputs";
import { availableModes } from "./lib/config/modes";
import type { ChatMode } from "./lib/config/types";
import { ChatShell } from "./ui/ChatShell";
import type { ChatHandle } from "./ui/ChatShell";
import { StatePanel } from "./ui/StatePanel";
import type { ChatErrorDetail } from "./ui/useChatController";
import type { VbRestHelper } from "xxx-gnimsys-data/rest/index";

type Props = Readonly<{
  /** Agent configuration (config-v1 schema), as an object or a JSON string. Required. */
  config?: object | string;
  /** The VB application user object (`$application.user`); the component reads `userName` and `roles`. `userName` is required: it is the owner filter for the user's conversations. With `config.ui.trace` set, a user holding one of its `roles` sees the agent's node trace under each reply. */
  user?: { userName?: string; roles?: string[]; [k: string]: unknown };
  /** Oracle PersonId of the user. Required when config.files.enabled is true. */
  personId?: string;
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
  const { config, user, personId, restHelper, endpoint } = props;
  const check = useMemo(() => checkInputs(config, user, personId, restHelper, endpoint), [config, user, personId, restHelper, endpoint]);

  // Methods delegate to the mounted shell; with a needs-input/invalid config there is none and they throw.
  const shell = useRef<ChatHandle | null>(null);
  useImperativeHandle(ref, () => {
    const live = (): ChatHandle => {
      if (shell.current === null) throw new Error("xxx-gnimsys-ai-chat is not configured: see its needs-input/invalid panel");
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

  // Mode: the config's, until the header's switch (ui.modeSwitch) picks another; a new config mode starts over from it.
  const configMode: ChatMode | undefined = check.ok ? check.config.mode : undefined;
  const [picked, setPicked] = useState<{ base: ChatMode | undefined; mode: ChatMode } | null>(null);
  const mode = picked !== null && picked.base === configMode ? picked.mode : configMode;
  const onModeChange = useCallback((m: ChatMode) => setPicked({ base: configMode, mode: m }), [configMode]);
  const switched = mode !== configMode;
  // The shell's config, stable across renders: the controller's services are memoized on it, so a new object per render
  // would rebuild them (and reload the list and the workflow) on every property writeback.
  const shellConfig = useMemo(() => (check.ok ? { ...check.config, mode: mode as typeof check.config.mode } : null), [check, mode]);

  return (
    <div class="gai-chat oj-sm-height-full oj-typography-body-md oj-text-color-primary">
      {check.ok ? (
        <ChatShell
          // Another agent, version, mode (or another endpoint map, i.e. another pod) is another chat: remount so no turns or
          // conversation id carry over to it.
          key={`${JSON.stringify(endpoint)}/${check.config.agent.workflowCode}/${check.config.agent.version}/${mode}`}
          // Set whenever check.ok; a valid config has a mode, and the switch offers only implemented modes (availableModes).
          config={shellConfig as NonNullable<typeof shellConfig>}
          strings={componentStrings.chat}
          userName={(user as { userName: string } /* checkInputs: userName non-empty */).userName}
          {...(personId !== undefined && { personId })}
          userRoles={user?.roles ?? []}
          {...(props.context !== undefined && { context: props.context })}
          // A mode switch starts a new conversation: the host's conversation belongs to the config's mode.
          {...(props.conversationId !== undefined && !switched && { conversationId: props.conversationId })}
          {...(check.config.ui.modeSwitch && { modeSwitch: { modes: availableModes(check.config), value: mode as ChatMode, onChange: onModeChange } })}
          // checkInputs: a RestHelper (get()) and an endpoint map with every name the config needs.
          restHelper={restHelper as VbRestHelper}
          endpoints={endpoint as Record<string, string>}
          handleRef={shell}
          onConversationIdChanged={onConversationIdChanged}
          onConversationChanged={onConversationChanged}
          onError={onError}
        />
      ) : (
        <StatePanel kind={check.kind} problems={check.problems} />
      )}
    </div>
  );
}

export const Chat: ComponentType<ExtendGlobalProps<ComponentProps<typeof ChatImpl>>> = registerCustomElement<Props, ChatHandle>(
  "xxx-gnimsys-ai-chat",
  forwardRef(ChatImpl),
);
