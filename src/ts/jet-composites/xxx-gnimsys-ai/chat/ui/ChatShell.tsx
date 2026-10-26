import "oj-c/badge";
import "oj-c/button";
import "oj-c/buttonset-single";
import "oj-c/drawer-layout";
import "oj-c/progress-circle";
import ResponsiveUtils = require("ojs/ojresponsiveutils");
import type { Ref } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import { MODE_LABELS } from "../lib/config/modes";
import type { ChatMode, RunConfig } from "../lib/config/types";
import type { VbRestHelper } from "xxx-gnimsys-data/rest/index";
import { traceGateOpen } from "../lib/trace/gate";
import { resolveOrigin } from "../lib/origin";
import { createMarkdownRenderer } from "../lib/render/markdown";
import { loadVendor } from "../render/vendor";
import { Banner } from "./Banner";
import { AgentAvatar } from "./Bubble";
import type { MarkdownRenderer } from "./Bubble";
import { Composer } from "./Composer";
import { Feed } from "./Feed";
import { FollowUps } from "./FollowUps";
import { HitlBar } from "./HitlBar";
import { Sidebar } from "./Sidebar";
import { Greeting, StartersUnavailable } from "./Starters";
import { AuthBanner } from "./StatePanel";
import { useChatController } from "./useChatController";
import type { ChatErrorDetail } from "./useChatController";
import type { RunObserver } from "../lib/debug/RunObserver";

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

/** Opens / closes the conversations drawer (a small borderless icon button; its label says what it does). */
function DrawerToggle(props: { open: boolean; onChange: (open: boolean) => void }) {
  return (
    <oj-c-button data-testid="gai-sidebar-toggle" size="sm" chroming="borderless" display="icons"
      label={props.open ? "Hide conversations" : "Show conversations"} onojAction={() => props.onChange(!props.open)}>
      <span slot="startIcon" class={props.open ? "oj-ux-ico-chevron-double-left" : "oj-ux-ico-chevron-double-right"} />
    </oj-c-button>
  );
}

/** Holds the bottom bar's place until what it will show is settled (see `settled` in ChatShell). */
function PendingBar() {
  return (
    <div class="oj-flex oj-sm-justify-content-center oj-sm-align-items-center oj-sm-padding-3x oj-border-top"
      data-testid="gai-bar-pending" role="status">
      <oj-c-progress-circle size="sm" value={-1} aria-label="Waiting for the reply to finish" />
    </div>
  );
}

/**
 * The header's mode switch (`ui.modeSwitch`): the modes the config offers (implemented and configured) and the current
 * one. Picking another mode is a full reset: the component remounts the chat in that mode, in a new conversation.
 */
export interface ModeSwitch { modes: ChatMode[]; value: ChatMode; onChange: (mode: ChatMode) => void }

function ModeSwitchControl(props: ModeSwitch) {
  const items = props.modes.map((m) => ({ value: m, label: MODE_LABELS[m] }));
  return (
    <oj-c-buttonset-single data-testid="gai-mode-switch" aria-label="Mode" size="sm" chroming="outlined" value={props.value} items={items}
      onvalueChanged={(e) => {
        const v = e.detail.value as ChatMode | undefined;
        if (v !== undefined && v !== props.value && props.modes.includes(v)) props.onChange(v);
      }} />
  );
}

/** The component's translatable texts (resources/nls). */
export interface ChatStrings { greeting: string; placeholder: string }

/** The header's "Change" control (design §5.1): reopens the run panel; present only when the user may choose something. */
export interface RunChange { label: string; onChange: () => void }

export interface ChatShellProps {
  config: RunConfig;
  strings: ChatStrings;
  userName: string;
  personId?: string;
  /** Debug hosts: the run observer (capture + breakpoints). */
  runObserver?: RunObserver;
  /** Roles of the signed-in user; with `config.ui.trace` they decide whether the trace panel shows. */
  userRoles: string[];
  context?: Record<string, unknown>;
  /** The page's VB RestHelper: every pod call goes through it. */
  restHelper: VbRestHelper;
  /** The page's endpoint map: contract name -> VB endpoint id. */
  endpoints: Record<string, string>;
  /** The element's `conversation-id` property (in/out). */
  conversationId?: string;
  /** Present when `ui.modeSwitch` is on. */
  modeSwitch?: ModeSwitch;
  /** Present when the user may choose the run (the page left the agent or the version to them). */
  runChange?: RunChange;
  /** Why the user's earlier run choice was dropped, shown above the conversation (the run selection's note). */
  runNote?: string;
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
      ...(props.runObserver !== undefined && { runObserver: props.runObserver }),
      ...(props.context !== undefined && { context: props.context }),
      ...(props.conversationId !== undefined && props.conversationId !== "" && { conversationId: props.conversationId }),
      onError: props.onError,
    },
    { restHelper: props.restHelper, endpoints: props.endpoints },
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
  const uploading = attachments?.uploading ?? false;
  const canSend = authOk && !busy && !historyLoading && !uploading;
  // The agent waits on the user: the HITL bar replaces the composer.
  const wait = state.status === "waiting" ? state.wait : undefined;
  // A Core Pack control keeps the `disabled` it was created with when that value changes before the element has finished
  // its asynchronous creation (JET replays early property sets, see MessageArea). So the bottom bar is created only once
  // nothing pending will change it by itself: the HITL bar after the stream that brought the wait has ended, the composer
  // when no reply, upload or history load is pending (a mounted composer then stays through later sends). Until then a
  // progress placeholder holds its place.
  const settled = !ctl.inFlight && !busy && !historyLoading && !uploading;
  const composerMounted = useRef(false);
  const showComposer = !wait && (composerMounted.current || settled);
  composerMounted.current = showComposer;

  const listOn = config.ui.conversations;
  // The drawer's toggle: in the drawer's own header while it is open (an overlay drawer covers this header, and neither an
  // outside click nor Escape outside it closes it), in the chat header while it is closed.
  const toggle = <DrawerToggle open={drawerOpen} onChange={setDrawerOpen} />;
  // A draft run is marked in the header for as long as it runs (design §5.1), whoever bound or chose it.
  const draft = config.agent.version === "DRAFT";
  const change = props.runChange;
  const main = (
    <div class="gai-shrink oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-flex-1 oj-sm-height-full">
      {((listOn && !drawerOpen) || title !== undefined || draft || props.modeSwitch !== undefined || change !== undefined) && (
        <div class="oj-flex-bar oj-sm-align-items-center oj-sm-padding-2x oj-border-bottom">
          {listOn && !drawerOpen && <div class="oj-flex-bar-start">{toggle}</div>}
          {(title !== undefined || draft) && (
            // The agent: its avatar, then its name; the Draft badge after it.
            <div class="oj-flex-bar-middle oj-sm-align-items-center oj-sm-padding-2x-horizontal">
              {title !== undefined && (
                <>
                  <AgentAvatar size="2xs" class="oj-sm-margin-3x-end" />
                  <h2 class="gai-shrink oj-typography-heading-xs oj-sm-margin-0">{title}</h2>
                </>
              )}
              {draft && <oj-c-badge data-testid="gai-draft-badge" class="gai-badge oj-sm-margin-2x-start" size="sm" variant="warning" label="Draft" />}
            </div>
          )}
          {(props.modeSwitch !== undefined || change !== undefined) && (
            <div class="oj-flex-bar-end oj-sm-align-items-center">
              {change !== undefined && (
                <oj-c-button data-testid="gai-run-change" size="sm" chroming="borderless" label={change.label} onojAction={change.onChange}>
                  <span slot="startIcon" class="oj-ux-ico-edit" />
                </oj-c-button>
              )}
              {props.modeSwitch !== undefined && <ModeSwitchControl {...props.modeSwitch} />}
            </div>
          )}
        </div>
      )}
      {props.runNote !== undefined && <Banner testId="gai-run-note" severity="warning" class="oj-sm-margin-2x" summary={props.runNote} />}
      {state.authState !== "ok" && (
        <AuthBanner class="oj-sm-margin-2x" state={state.authState} {...(state.authReason !== undefined && { reason: state.authReason })} {...(state.authStatus !== undefined && { status: state.authStatus })}
          {...(state.authDetail !== undefined && { detail: state.authDetail })} />
      )}
      <Feed turns={state.turns} showTrace={traceGateOpen(config.ui.trace, props.userRoles)} busy={busy && authOk}
        widgets={{ policy: config.datasources, overlays: config.widgets, endpoints: ctl.endpoints, canSend, settled, onSubmit: ctl.send }}
        renderer={renderer} historyStatus={state.historyStatus}
        {...(state.historyError !== undefined && { historyError: state.historyError })}
        {...(state.progressText !== undefined && { progressText: state.progressText })}>
        {/* An empty conversation opens with the agent's greeting (the starters inside it); it goes once there are turns. */}
        {state.turns.length === 0 && !historyLoading && (
          <>
            <Greeting text={config.ui.greeting ?? props.strings.greeting} questions={starters} disabled={!canSend}
              onPick={ctl.sendStarter} />
            {ctl.workflowError && <StartersUnavailable error={ctl.workflowError} />}
          </>
        )}
        {!busy && !wait && <FollowUps questions={state.followups} disabled={!canSend} onPick={ctl.send} />}
      </Feed>
      {wait ? (
        ctl.inFlight ? <PendingBar /> : <HitlBar key={wait.token} wait={wait} disabled={!authOk} onResume={ctl.resume} />
      ) : showComposer ? (
        <Composer disabled={!canSend} onSend={ctl.send} placeholder={config.ui.placeholder ?? props.strings.placeholder}
          {...(attachments !== null && {
            attachments: { tray: attachments, accept: config.files.accept, maxSizeMB: config.files.maxSizeMB },
          })} />
      ) : (
        <PendingBar />
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
