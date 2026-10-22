import { Action, ExtendGlobalProps, PropertyChanged, registerCustomElement } from "ojs/ojvcomponent";
import { ComponentProps, ComponentType, Ref } from "preact";
import { forwardRef } from "preact/compat";
import { useCallback, useImperativeHandle, useMemo, useRef } from "preact/hooks";
import componentStrings = require("ojL10n!./resources/nls/chat-strings");
import "css!xxx-gnimsys-ai/chat/chat-styles.css";
import { checkInputs } from "./lib/config/checkInputs";
import { ChatShell } from "./ui/ChatShell";
import type { ChatHandle } from "./ui/ChatShell";
import { StatePanel } from "./ui/StatePanel";
import type { ChatErrorDetail } from "./ui/useChatController";

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
  /** VB REST helper, for the VB-connection auth kind (accepted, not used in v1.0). */
  restHelper?: object;
  /** VB service-connection map, for the VB-connection auth kind (accepted, not used in v1.0). */
  endpoint?: object | string;
  onConversationIdChanged?: PropertyChanged<string>;
  /** Fired when the chat switches to another conversation (new or opened). */
  onAiChatConversationChanged?: Action<{ conversationId: string }>;
  /**
   * Fired when a reply fails, the session needs a re-login, chat auth is unavailable (`reason`), the agent lookup fails,
   * or a conversation list/history/name/rename/delete call fails.
   */
  onAiChatError?: Action<{ message: string; status?: number; reason?: "xsrf-unavailable" | "token-undecodable" | "clock-skew" }>;
}>;

// The Core Pack (oj-c) components imported by ui/*.tsx, named as in the runtime's oj-c catalog; the pod's JET runtime
// provides them (dependencyScope "runtime"), so they are declared here and never bundled.
/**
 * @ojmetadata pack "xxx-gnimsys-ai"
 * @ojmetadata version "0.1.0"
 * @ojmetadata displayName "Gnimsys AI Chat"
 * @ojmetadata description "Chat with an Oracle AI Agent Studio agent"
 * @ojmetadata dependencies {
 *   "oj-c-button": "^18.0.15",
 *   "oj-c-collapsible": "^18.0.15",
 *   "oj-c-input-text": "^18.0.15",
 *   "oj-c-list-item-layout": "^18.0.15",
 *   "oj-c-list-view": "^18.0.15",
 *   "oj-c-message-banner": "^18.0.15",
 *   "oj-c-progress-circle": "^18.0.15",
 *   "oj-c-text-area": "^18.0.15",
 *   "oj-c-toggle-button": "^18.0.15"
 * }
 */
function ChatImpl(props: Props, ref: Ref<ChatHandle>) {
  const { config, user, personId } = props;
  const check = useMemo(() => checkInputs(config, user, personId), [config, user, personId]);

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

  return (
    <div class="gai-chat oj-typography-body-md oj-text-color-primary">
      {check.ok ? (
        <ChatShell
          // Another agent is another chat: remount so no turns or conversation id carry over to it.
          key={`${check.config.agent.pod}/${check.config.agent.workflowCode}`}
          config={check.config}
          userName={(user as { userName: string } /* checkInputs: userName non-empty */).userName}
          {...(personId !== undefined && { personId })}
          userRoles={user?.roles ?? []}
          {...(props.context !== undefined && { context: props.context })}
          {...(props.conversationId !== undefined && { conversationId: props.conversationId })}
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
