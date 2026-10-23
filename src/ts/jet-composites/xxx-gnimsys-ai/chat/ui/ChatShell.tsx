import "oj-c/drawer-layout";
import "oj-c/toggle-button";
import ResponsiveUtils = require("ojs/ojresponsiveutils");
import { IntlConverterUtils } from "ojs/ojconverterutils-i18n";
import type { Ref } from "preact";
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "preact/hooks";
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

/**
 * The conversations drawer sits beside the chat (reflow) from JET's lg breakpoint up and overlays it below; it starts open
 * where it reflows and closed where it would cover the chat.
 */
function drawerReflows(): boolean {
  const query = ResponsiveUtils.getFrameworkQuery(ResponsiveUtils.FRAMEWORK_QUERY_KEY.LG_UP);
  return query !== null && window.matchMedia(query).matches;
}

/** Avatar initials from the user name: its local part (before "@") split on . _ - and spaces, via JET's getInitials. */
function initialsOf(userName: string): string | undefined {
  const [first, last] = userName.split("@")[0].split(/[._\s-]+/).filter((p) => p !== "");
  return IntlConverterUtils.getInitials(first, last);
}

/** Opens / closes the conversations drawer. */
function DrawerToggle(props: { open: boolean; onChange: (open: boolean) => void }) {
  return (
    <oj-c-toggle-button data-testid="gai-sidebar-toggle" chroming="borderless" display="icons" label="Conversations"
      value={props.open} onvalueChanged={(e) => props.onChange(e.detail.value === true)}>
      <span slot="startIcon" class={props.open ? "oj-ux-ico-chevron-double-left" : "oj-ux-ico-chevron-double-right"} />
    </oj-c-toggle-button>
  );
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
  const initials = useMemo(() => initialsOf(props.userName), [props.userName]);
  const [drawerOpen, setDrawerOpen] = useState(drawerReflows);

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

  const listOn = config.ui.conversations;
  // The drawer's toggle: in the drawer's own header while it is open (an overlay drawer covers this header, and neither an
  // outside click nor Escape outside it closes it), in the chat header while it is closed.
  const toggle = <DrawerToggle open={drawerOpen} onChange={setDrawerOpen} />;
  const main = (
    <div class="gai-shrink oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-flex-1 oj-sm-height-full">
      {((listOn && !drawerOpen) || title !== undefined) && (
        <div class="oj-flex-bar oj-sm-align-items-center oj-sm-padding-2x oj-border-bottom">
          {listOn && !drawerOpen && <div class="oj-flex-bar-start">{toggle}</div>}
          {title !== undefined && (
            <div class="oj-flex-bar-middle oj-sm-align-items-center oj-sm-padding-2x-horizontal oj-typography-subheading-xs">{title}</div>
          )}
        </div>
      )}
      {state.authState !== "ok" && (
        <AuthBanner class="oj-sm-margin-2x" state={state.authState} {...(state.authReason !== undefined && { reason: state.authReason })} {...(state.authStatus !== undefined && { status: state.authStatus })} />
      )}
      <Feed turns={state.turns} showTrace={traceGateOpen(config.ui.trace, props.userRoles)} busy={busy && authOk} renderer={renderer} historyStatus={state.historyStatus}
        {...(initials !== undefined && { userInitials: initials })}
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
  );

  const shell = "gai-shell oj-panel oj-sm-padding-0 oj-sm-height-full";
  // Without the conversation list there is no drawer at all. JET moves slot nodes into its own layout, so the drawer keeps
  // the same two children (the sidebar in the start slot, the chat column in the default slot) for its whole life.
  return listOn ? (
    <oj-c-drawer-layout class={shell} startDisplay="auto" startOpened={drawerOpen}
      onstartOpenedChanged={(e) => setDrawerOpen(e.detail.value === true)}>
      <Sidebar list={ctl.conversations} activeId={state.conversationId} onOpen={ctl.openConversation} onNew={ctl.newConversation}
        {...(drawerOpen && { toggle })} />
      {main}
    </oj-c-drawer-layout>
  ) : (
    <div class={shell}>{main}</div>
  );
}
