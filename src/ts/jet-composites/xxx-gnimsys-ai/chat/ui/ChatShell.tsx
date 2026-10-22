import type { Ref } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import type { ChatConfig } from "../lib/config/types";
import { createMarkdownRenderer } from "../lib/render/markdown";
import { loadVendor } from "../render/vendor";
import type { MarkdownRenderer } from "./Bubble";
import { Composer } from "./Composer";
import { Feed } from "./Feed";
import { FollowUps } from "./FollowUps";
import { Starters } from "./Starters";
import { AuthBanner } from "./StatePanel";
import { useChatController } from "./useChatController";
import type { ChatErrorDetail } from "./useChatController";

/** Public methods of `<xxx-gnimsys-ai-chat>`. */
export type ChatHandle = {
  /** Starts a new, empty conversation with a newly minted conversation id. */
  newConversation: () => void;
  /**
   * Sends a user message in the current conversation; ignored while a reply is streaming.
   * @param text the message text
   */
  send: (text: string) => void;
  /**
   * Switches the chat to an existing conversation.
   * @param id the conversation id
   */
  openConversation: (id: string) => void;
};

/** Markdown renderer built once per mounted chat; null until both vendored libraries have loaded. */
function useMarkdownRenderer(onError: (detail: ChatErrorDetail) => void): MarkdownRenderer | null {
  const [renderer, setRenderer] = useState<MarkdownRenderer | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    let live = true;
    Promise.all([loadVendor("markdown-it"), loadVendor("purify")])
      .then(([markdownit, purify]) => {
        if (live) setRenderer(createMarkdownRenderer({ markdownit, purify }));
      })
      .catch((e: unknown) => {
        if (live) onErrorRef.current({ message: "markdown renderer unavailable: " + (e instanceof Error ? e.message : String(e)) });
      });
    return () => { live = false; };
  }, []);
  return renderer;
}

export interface ChatShellProps {
  config: ChatConfig;
  userName: string;
  personId?: string;
  context?: Record<string, unknown>;
  /** The element's `conversation-id` property (in/out). */
  conversationId?: string;
  handleRef: Ref<ChatHandle>;
  onConversationIdChanged: (id: string) => void;
  onConversationChanged: (id: string) => void;
  onError: (detail: ChatErrorDetail) => void;
}

export function ChatShell(props: ChatShellProps) {
  const ctl = useChatController(
    props.config,
    {
      userName: props.userName,
      ...(props.personId !== undefined && { personId: props.personId }),
      ...(props.context !== undefined && { context: props.context }),
      ...(props.conversationId !== undefined && props.conversationId !== "" && { conversationId: props.conversationId }),
      onError: props.onError,
    },
    { document },
  );
  const { state } = ctl;

  useImperativeHandle(
    props.handleRef,
    () => ({ newConversation: ctl.newConversation, send: ctl.send, openConversation: ctl.openConversation }),
    [ctl.newConversation, ctl.send, ctl.openConversation],
  );

  // Out: write the current id back to the property; emit the event when it changes after mount.
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    const id = state.conversationId;
    if (id !== props.conversationId) props.onConversationIdChanged(id);
    if (lastId.current !== null && lastId.current !== id) props.onConversationChanged(id);
    lastId.current = id;
  }, [state.conversationId]);

  // In: the host set a different conversation id.
  useEffect(() => {
    const ext = props.conversationId;
    if (ext !== undefined && ext !== "" && ext !== lastId.current) ctl.openConversation(ext);
  }, [props.conversationId]);

  const renderer = useMarkdownRenderer(props.onError);

  const config = props.config;
  const workflowInfo = ctl.workflowInfo;
  const title = config.ui.title ?? workflowInfo?.name;
  const starters = config.ui.starterQuestions === "fromWorkflow" ? workflowInfo?.starterQuestions ?? [] : config.ui.starterQuestions;
  const busy = state.status === "sending" || state.status === "streaming";
  const authOk = state.authState === "ok";
  const canSend = authOk && !busy;

  return (
    <div class="gai-shell">
      {title !== undefined && <div class="gai-header">{title}</div>}
      {state.authState !== "ok" && <AuthBanner state={state.authState} />}
      <Feed turns={state.turns} busy={busy && authOk} renderer={renderer}
        {...(state.progressText !== undefined && { progressText: state.progressText })}>
        {state.turns.length === 0 && <Starters questions={starters} disabled={!canSend} onPick={ctl.sendStarter} />}
        {!busy && <FollowUps questions={state.followups} disabled={!canSend} onPick={ctl.send} />}
      </Feed>
      <Composer disabled={!canSend} onSend={ctl.send}
        {...(config.ui.placeholder !== undefined && { placeholder: config.ui.placeholder })} />
    </div>
  );
}
