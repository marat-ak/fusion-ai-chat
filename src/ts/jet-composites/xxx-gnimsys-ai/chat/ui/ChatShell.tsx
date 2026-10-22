import type { Ref } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import type { ChatConfig } from "../lib/config/types";
import { traceGateOpen } from "../lib/trace/gate";
import { resolveOrigin } from "../lib/origin";
import { createMarkdownRenderer } from "../lib/render/markdown";
import { loadVendor } from "../render/vendor";
import type { MarkdownRenderer } from "./Bubble";
import { Composer } from "./Composer";
import { Feed } from "./Feed";
import { FollowUps } from "./FollowUps";
import { HitlBar } from "./HitlBar";
import { Sidebar } from "./Sidebar";
import { Starters, StartersUnavailable } from "./Starters";
import { AuthBanner } from "./StatePanel";
import { useChatController } from "./useChatController";
import type { ChatErrorDetail } from "./useChatController";

/** Public methods of `<xxx-gnimsys-ai-chat>`. */
export type ChatHandle = {
  /** Starts a new, empty conversation with a newly minted conversation id. */
  newConversation: () => void;
  /**
   * Sends a user message (with the files pending in the composer) in the current conversation; ignored while a reply
   * is streaming, the agent waits on the user, files are uploading or the history is loading.
   * @param text the message text
   */
  send: (text: string) => void;
  /**
   * Switches the chat to an existing conversation and loads its history.
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
        // Images in replies may load from the page's own origin only.
        if (live) setRenderer(createMarkdownRenderer({ markdownit, purify, origin: resolveOrigin() }));
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
  /** Roles of the signed-in user; with `config.ui.trace` they decide whether the trace panel shows. */
  userRoles: string[];
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
    {},
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

  // In: a host-set id is opened (its history loads), both the one the chat mounts with and a different one set later;
  // the id the chat wrote back itself is skipped. At mount the Out effect has already recorded it, hence `atMount`.
  const inSeen = useRef(false);
  useEffect(() => {
    const ext = props.conversationId;
    const atMount = !inSeen.current;
    inSeen.current = true;
    if (ext === undefined || ext === "") return;
    if (atMount || ext !== lastId.current) ctl.openConversation(ext);
  }, [props.conversationId]);

  const renderer = useMarkdownRenderer(props.onError);

  const config = props.config;
  const workflowInfo = ctl.workflowInfo;
  const title = config.ui.title ?? workflowInfo?.name;
  const starters = config.ui.starterQuestions === "fromWorkflow" ? workflowInfo?.starterQuestions ?? [] : config.ui.starterQuestions;
  const busy = state.status === "sending" || state.status === "streaming";
  const authOk = state.authState === "ok";
  // The loaded history replaces the turns, so nothing is sent until it has arrived (or failed).
  const historyLoading = state.historyStatus === "loading";
  const attachments = ctl.attachments;
  const canSend = authOk && !busy && !historyLoading && !(attachments?.uploading ?? false);
  // The agent waits on the user: the HITL bar replaces the composer.
  const wait = state.status === "waiting" ? state.wait : undefined;

  return (
    <div class="gai-shell">
      {config.ui.conversations && (
        <Sidebar list={ctl.conversations} activeId={state.conversationId} onOpen={ctl.openConversation} onNew={ctl.newConversation} />
      )}
      <div class="gai-main">
        {title !== undefined && <div class="gai-header">{title}</div>}
        {state.authState !== "ok" && (
          <AuthBanner state={state.authState} {...(state.authReason !== undefined && { reason: state.authReason })} {...(state.authStatus !== undefined && { status: state.authStatus })} />
        )}
        <Feed turns={state.turns} showTrace={traceGateOpen(config.ui.trace, props.userRoles)} busy={busy && authOk} renderer={renderer} historyStatus={state.historyStatus}
          {...(state.historyError !== undefined && { historyError: state.historyError })}
          {...(state.progressText !== undefined && { progressText: state.progressText })}>
          {state.turns.length === 0 && !historyLoading && (ctl.workflowError
            ? <StartersUnavailable error={ctl.workflowError} />
            : <Starters questions={starters} disabled={!canSend} onPick={ctl.sendStarter} />)}
          {!busy && !wait && <FollowUps questions={state.followups} disabled={!canSend} onPick={ctl.send} />}
        </Feed>
        {wait ? (
          <HitlBar key={wait.token} wait={wait} disabled={!authOk || ctl.inFlight} onResume={ctl.resume} />
        ) : (
          <Composer disabled={!canSend} onSend={ctl.send}
            {...(config.ui.placeholder !== undefined && { placeholder: config.ui.placeholder })}
            {...(attachments !== null && {
              attachments: { tray: attachments, accept: config.files.accept, maxSizeMB: config.files.maxSizeMB },
            })} />
        )}
      </div>
    </div>
  );
}
