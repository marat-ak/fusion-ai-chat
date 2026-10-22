import { Action, ExtendGlobalProps, PropertyChanged, registerCustomElement } from "ojs/ojvcomponent";
import { ComponentProps, ComponentType, Ref } from "preact";
import { forwardRef } from "preact/compat";
import { useCallback, useImperativeHandle, useMemo, useRef } from "preact/hooks";
import componentStrings = require("ojL10n!./resources/nls/chat-strings");
import "css!xxx-gnimsys-ai/chat/chat-styles.css";
import { parseConfigProp, validateConfig } from "./lib/config/validate";
import type { Problem, ValidateResult } from "./lib/config/types";
import { ChatShell } from "./ui/ChatShell";
import type { ChatHandle } from "./ui/ChatShell";
import { StatePanel } from "./ui/StatePanel";
import type { ChatErrorDetail } from "./ui/useChatController";

type Props = Readonly<{
  /** Agent configuration (config-v1 schema), as an object or a JSON string. Required. */
  config?: object | string;
  /** Fusion user name: the owner filter for the user's conversations. Required. */
  userName?: string;
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
  onAiChatError?: Action<{ message: string; status?: number; reason?: "xsrf-missing" | "token-undecodable" | "clock-skew" }>;
}>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Config validation plus the required element properties; nothing is fetched until this passes. */
function checkInputs(configProp: Props["config"], userName: string | undefined, personId: string | undefined): ValidateResult {
  const parsed = parseConfigProp(configProp);
  const result = validateConfig(parsed);
  const missing: Problem[] = [];
  if (!userName) missing.push({ path: "user-name", message: "required" });
  const files = isObj(parsed) ? parsed.files : undefined;
  if (isObj(files) && files.enabled === true && !personId) missing.push({ path: "person-id", message: "required when files.enabled" });
  if (missing.length === 0) return result;
  if (result.ok) return { ok: false, kind: "needs-input", problems: missing };
  return { ...result, problems: [...result.problems, ...missing] };
}

/**
 * @ojmetadata pack "xxx-gnimsys-ai"
 * @ojmetadata version "0.1.0"
 * @ojmetadata displayName "Gnimsys AI Chat"
 * @ojmetadata description "Chat with an Oracle AI Agent Studio agent"
 */
function ChatImpl(props: Props, ref: Ref<ChatHandle>) {
  const { config, userName, personId } = props;
  const check = useMemo(() => checkInputs(config, userName, personId), [config, userName, personId]);

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
    <div class="gai-chat">
      {check.ok ? (
        <ChatShell
          // Another agent is another chat: remount so no turns or conversation id carry over to it.
          key={`${check.config.agent.pod}/${check.config.agent.workflowCode}`}
          config={check.config}
          userName={userName as string /* checkInputs: non-empty */}
          {...(personId !== undefined && { personId })}
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
