import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import type { RunConfig } from "../lib/config/types";
import { substitute } from "../lib/config/substitute";
import { EndpointFetch, streamFetchOf } from "../lib/endpoints/EndpointFetch";
import { bodyTextOf, errorDetail, historyFailureText, isRelogin, messageOf, statusOf } from "../lib/errors";
import type { ChatErrorDetail } from "../lib/errors";
import type { VbRestHelper } from "xxx-gnimsys-data/rest/index";
import DashboardRestHelper = require("xxx-gnimsys-data/rest/dashboard-rest-helper");
import * as VbStream from "xxx-gnimsys-data/rest/vb-stream-fetch";
import { AiStudioTransport, STREAM_UNAVAILABLE } from "../lib/transport/AiStudioTransport";
import type { ResumeInput, SendInput } from "../lib/transport/ChatTransport";
import type { ConversationSummary } from "../lib/history/HistoryStore";
import { OracleHistoryStore } from "../lib/history/OracleHistoryStore";
import { OracleWorkflowInfo } from "../lib/history/OracleWorkflowInfo";
import type { WorkflowInfo } from "../lib/history/OracleWorkflowInfo";
import { localTitle } from "../lib/history/localTitle";
import { OracleAttachmentService } from "../lib/files/OracleAttachmentService";
import type { Rejection, UploadedAttachment } from "../lib/files/AttachmentService";
import { initialState, newConversationId, reduce } from "../lib/state/conversation";
import type { ChatState } from "../lib/state/conversation";
import type { RunObserver, RunTurnSink } from "../lib/debug/RunObserver";

export type { ChatErrorDetail } from "../lib/errors";

export interface ChatControllerProps {
  userName: string;
  /** Oracle PersonId for the attachments' conversation row; optional (absent = the row is created without it). */
  personId?: string;
  /** Debug hosts: receives every turn's request and raw frames, and gives the breakpoints of each `/debug` send. */
  runObserver?: RunObserver;
  /** Page values for `{{key}}` substitution in `agent.additionalContext`. */
  context?: Record<string, unknown>;
  /** Host-provided conversation to start in (the shell opens it, loading its history); a new id is minted when absent. */
  conversationId?: string;
  onError?: (detail: ChatErrorDetail) => void;
}

/** The page's VB RestHelper and endpoint map (validated by checkInputs): every pod call goes through them. */
export interface ChatControllerDeps { restHelper: VbRestHelper; endpoints: Record<string, string> }

export type ResumeAction = ResumeInput["action"];
/** statusCheckOnly: a WAIT node's Refresh (asks whether the wait is over; adds no user turn). */
export interface ResumeOptions { statusCheckOnly?: boolean }

/** A file picked for the next message; `failed` keeps the error of the last send attempt. */
export interface PendingFile { id: number; file: File; state: "pending" | "uploading" | "uploaded" | "failed"; error?: string }

/** The composer's files (only when `files.enabled`): validated when picked, uploaded and linked when the message is sent. */
export interface AttachmentTray {
  pending: PendingFile[];
  /** Files refused at the last pick. */
  rejected: Rejection[];
  /** A send's upload flow is running: nothing is sent, picked or removed until it ends. */
  uploading: boolean;
  add(files: File[]): void;
  remove(id: number): void;
}

/** The user's conversations with this agent (BOSS `userConversations`); loaded only when `ui.conversations` is on. */
export interface ConversationList {
  /** In the pod's order. A conversation started here leads the list under its local title until the pod names it. */
  items: ConversationSummary[];
  hasMore: boolean;
  loading: boolean;
  /** The last list load failed (an auth failure shows the auth banner instead). */
  error: ChatErrorDetail | null;
  /** Reloads the first page. */
  refresh(): void;
  /** Appends the next page when `hasMore`. */
  loadMore(): void;
  /** Resolves null when renamed, else the failure (also reported through onError). */
  rename(id: string, name: string): Promise<ChatErrorDetail | null>;
  /** Resolves null when deleted, else the failure (also reported through onError). Deleting the open conversation starts a new one. */
  remove(id: string): Promise<ChatErrorDetail | null>;
}

export interface ChatController {
  state: ChatState;
  /** The page's endpoints (every pod call); the widgets load their datasources through it. */
  endpoints: EndpointFetch;
  /** Fetched on mount when `ui.starterQuestions === "fromWorkflow"`; null until loaded or when the fetch failed. */
  workflowInfo: WorkflowInfo | null;
  /** Set when the workflow lookup failed for a reason other than auth (auth failures show the auth banner). */
  workflowError: ChatErrorDetail | null;
  conversations: ConversationList;
  /** A reply stream is open (until its `done`); the HITL bar stays disabled meanwhile. */
  inFlight: boolean;
  /** Null when `files.enabled` is false. */
  attachments: AttachmentTray | null;
  /**
   * Sends a message with the pending files: when there are any, they are uploaded and linked to the conversation first;
   * a failed step aborts the send before the chat call (the files stay pending). Resolves whether the message was sent.
   */
  send(text: string): Promise<boolean>;
  sendStarter(question: string): void;
  resume(action: ResumeAction, content?: string, opts?: ResumeOptions): void;
  newConversation(): void;
  openConversation(id: string): void;
}

interface ListState { items: ConversationSummary[]; hasMore: boolean; loading: boolean; error: ChatErrorDetail | null; next: number }

/** Single owner of the chat services and the conversation reducer. Call only with a validated config. */
export function useChatController(config: RunConfig, props: ChatControllerProps, deps: ChatControllerDeps): ChatController {
  const { restHelper, endpoints: endpointMap } = deps;
  const { userName, personId, context, runObserver } = props;
  const listEnabled = config.ui.conversations;

  // One endpoint layer per rest helper and endpoint map, keyed on the map's content (a page may rebuild an equal map).
  const endpointKey = JSON.stringify(endpointMap);
  const endpoints = useMemo(() => {
    // Decided once per helper and map: the helper's own streamFetch, else the data pack's VB provider over its chains.
    const stream = streamFetchOf(restHelper, endpointMap, VbStream);
    return new EndpointFetch({ helper: new DashboardRestHelper(restHelper, endpointMap), ...(stream !== undefined && { stream }) });
  }, [restHelper, endpointKey]);

  const transport = useMemo(() => {
    const ac = config.agent.additionalContext;
    const lang = config.agent.responseLanguage;
    const via = config.agent.publishedVia;
    return new AiStudioTransport({
      endpoints,
      workflowCode: config.agent.workflowCode,
      version: config.agent.version,
      ...(via !== undefined && { publishedVia: via }),
      checkVersion: config.protocol.checkVersion,
      ...(runObserver !== undefined && { capture: true, breakPoints: () => runObserver.breakPoints() }),
      ...(ac !== undefined && { additionalContext: substitute(ac, context ?? {}) }),
      ...(lang !== undefined && { responseLanguage: lang }),
    });
  }, [config, endpoints, context, runObserver]);

  // Built here so the controller stays the single owner of services.
  const history = useMemo(
    () => new OracleHistoryStore({ endpoints, workflowCode: config.agent.workflowCode, userName }),
    [config, endpoints, userName],
  );
  const fileService = useMemo(() => {
    if (!config.files.enabled) return null;
    const hcmRestBase = config.protocol.hcmRestBase;
    if (!hcmRestBase) throw new Error("files.enabled requires protocol.hcmRestBase");
    const { maxFiles, maxSizeMB, accept } = config.files;
    return new OracleAttachmentService({
      endpoints, workflowCode: config.agent.workflowCode, ...(personId !== undefined && { personId }), hcmRestBase,
      limits: { maxFiles, maxSizeMB, accept },
    });
  }, [config, endpoints, personId]);

  const workflowSource = useMemo(
    () => new OracleWorkflowInfo({ endpoints, workflowCode: config.agent.workflowCode, status: config.agent.version }),
    [config, endpoints],
  );

  // A host-provided conversation is opened (its history loaded) right after mount: the first render already shows that,
  // so no control is created for a state that changes a moment later (see ChatShell `settled`).
  const [state, dispatch] = useReducer(reduce, props.conversationId,
    (id?: string): ChatState => (id ? { ...initialState(id), historyStatus: "loading" } : initialState(newConversationId())));
  const stateRef = useRef(state);
  stateRef.current = state;
  // Updated synchronously by new/open so a send() in the same tick targets the new conversation.
  const conversationId = useRef(state.conversationId);
  // The current conversation is new (minted here, or unknown to the pod) and has no message yet: its first send adds it
  // to the list. A host-provided id is opened by the shell, which marks it fresh once its history proves it new.
  const fresh = useRef(!props.conversationId);
  // The new conversation still waiting for its pod name lookup to answer (see lookUpName).
  const namePending = useRef<string | null>(null);
  // Set from open until its messages arrive (or fail): sends wait, since the loaded history replaces the turns.
  const historyLoading = useRef(false);
  // Bumped by every new/open: a messages response for an earlier conversation is dropped.
  const historySeq = useRef(0);
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;
  const report = useCallback((detail: ChatErrorDetail) => { onErrorRef.current?.(detail); }, []);

  // Set while a turn streams; doubles as the one-turn-at-a-time guard (synchronous, unlike the reducer status).
  const inflight = useRef<AbortController | null>(null);
  // The same, as state, for the UI.
  const [inFlight, setInFlight] = useState(false);

  // An endpoint's 401 is the re-login state (a banner with a reload and the 401's own text, if any; nothing is retried);
  // the in-flight turn is closed with `done`, which ends it as "No reply received". Any other failure of a turn ends it
  // with its error.
  const fail = useCallback((e: unknown, endTurn: boolean) => {
    if (isRelogin(e)) {
      const detail = bodyTextOf(e);
      dispatch({ type: "auth", state: "relogin", ...(detail !== undefined && { detail }) });
      if (endTurn) dispatch({ type: "event", event: { type: "done" } });
    } else if (endTurn) {
      dispatch({ type: "event", event: { type: "error", message: messageOf(e) } });
      dispatch({ type: "event", event: { type: "done" } });
    }
    report(errorDetail(e));
  }, [report]);

  // ---- conversation list ----------------------------------------------------------------------

  const [list, setList] = useState<ListState>({ items: [], hasMore: false, loading: false, error: null, next: 0 });
  const listRef = useRef(list);
  listRef.current = list;
  // Bumped by every list load (and on unmount): a response for an earlier load is dropped.
  const listSeq = useRef(0);
  // Rows this controller added for conversations started here, until a pod page lists them.
  const localIds = useRef(new Set<string>());

  const loadList = useCallback((offset: number) => {
    const seq = ++listSeq.current;
    setList((l) => ({ ...l, loading: true, error: null }));
    history.list(offset).then(
      (page) => {
        if (seq !== listSeq.current) return;
        for (const it of page.items) localIds.current.delete(it.id);
        setList((l) => {
          const fromPod = new Set(page.items.map((it) => it.id));
          // A first page replaces the list but keeps, first, the local rows the pod does not list yet; a later page appends.
          const kept = offset === 0
            ? l.items.filter((it) => localIds.current.has(it.id) && !fromPod.has(it.id))
            : l.items.filter((it) => !fromPod.has(it.id));
          return { items: [...kept, ...page.items], hasMore: page.hasMore, loading: false, error: null, next: offset + page.items.length };
        });
      },
      (e: unknown) => {
        if (seq !== listSeq.current) return;
        setList((l) => ({ ...l, loading: false, error: isRelogin(e) ? null : errorDetail(e) }));
        fail(e, false);
      },
    );
  }, [history, fail]);

  // The component mounts the controller only after validation, so this is the first BOSS call.
  useEffect(() => {
    if (listEnabled) loadList(0);
  }, [listEnabled, loadList]);

  const refresh = useCallback(() => { loadList(0); }, [loadList]);
  const loadMore = useCallback(() => {
    const l = listRef.current;
    if (l.hasMore && !l.loading) loadList(l.next);
  }, [loadList]);

  const setName = useCallback((id: string, name: string) => {
    setList((l) => ({ ...l, items: l.items.map((it) => (it.id === id ? { ...it, name } : it)) }));
  }, []);

  // Oracle's chat names a new conversation after its first reply. The lookup is done once it answers: a name renames the
  // row, null (the pod has no row yet) keeps the local title. A failed lookup is reported and retried after the next
  // successful reply, unless the chat has moved to another conversation (new/open bump historySeq) in between.
  const lookUpName = useCallback((id: string) => {
    namePending.current = null; // one lookup at a time
    const seq = historySeq.current;
    history.name(id).then(
      (name) => { if (name) setName(id, name); },
      (e: unknown) => {
        if (seq === historySeq.current && namePending.current === null) namePending.current = id;
        fail(e, false);
      },
    );
  }, [history, fail, setName]);

  // ---- attachments ----------------------------------------------------------------------------

  type TrayState = { pending: PendingFile[]; rejected: Rejection[]; uploading: boolean };
  const [tray, setTrayState] = useState<TrayState>({ pending: [], rejected: [], uploading: false });
  // Source of truth, updated synchronously: `uploading` doubles as the send guard while the upload flow runs.
  const trayRef = useRef(tray);
  const setTray = useCallback((patch: (t: TrayState) => TrayState) => {
    trayRef.current = patch(trayRef.current);
    setTrayState(trayRef.current);
  }, []);
  const nextFileId = useRef(1);

  const addFiles = useCallback((files: File[]) => {
    if (!fileService || trayRef.current.uploading || files.length === 0) return;
    const { ok, rejected } = fileService.validate(files, trayRef.current.pending.length);
    const added = ok.map((file): PendingFile => ({ id: nextFileId.current++, file, state: "pending" }));
    setTray((t) => ({ ...t, pending: [...t.pending, ...added], rejected }));
  }, [fileService, setTray]);

  const removeFile = useCallback((id: number) => {
    if (trayRef.current.uploading) return;
    setTray((t) => ({ ...t, pending: t.pending.filter((p) => p.id !== id) }));
  }, [setTray]);

  // ensureConversation, then each file in turn, then the batch link. Null when a step failed (the failing file, or every
  // file for a conversation-wide step, is marked failed and the error reported) or the chat moved to another
  // conversation meanwhile (new/open bump historySeq); the files are then pending again.
  const uploadAll = useCallback(async (id: string, svc: OracleAttachmentService): Promise<UploadedAttachment[] | null> => {
    const seq = historySeq.current;
    const files = trayRef.current.pending;
    const mark = (fid: number, state: PendingFile["state"]): void =>
      setTray((t) => ({ ...t, pending: t.pending.map((p) => (p.id === fid ? { id: p.id, file: p.file, state } : p)) }));
    const reset = (): null => {
      setTray((t) => ({ ...t, pending: t.pending.map((p): PendingFile => ({ id: p.id, file: p.file, state: "pending" })) }));
      return null;
    };
    reset(); // clears the errors of an earlier attempt
    setTray((t) => ({ ...t, uploading: true }));
    let current: number | null = null; // the file being uploaded; null during a conversation-wide step
    try {
      await svc.ensureConversation(id);
      const uploaded: UploadedAttachment[] = [];
      for (const f of files) {
        if (seq !== historySeq.current) return reset();
        current = f.id;
        mark(f.id, "uploading");
        uploaded.push(await svc.upload(f.file));
        mark(f.id, "uploaded");
      }
      current = null;
      if (seq !== historySeq.current) return reset();
      await svc.link(id, uploaded);
      if (seq !== historySeq.current) return reset();
      return uploaded;
    } catch (e) {
      // Abandoned (new/open meanwhile): not this conversation's failure, so nothing is marked or reported.
      if (seq !== historySeq.current) return reset();
      const error = messageOf(e);
      const failed = current;
      setTray((t) => ({
        ...t,
        pending: t.pending.map((p): PendingFile => (failed === null || p.id === failed
          ? { id: p.id, file: p.file, state: "failed", error }
          : { id: p.id, file: p.file, state: "pending" })),
      }));
      fail(e, false);
      return null;
    } finally {
      setTray((t) => ({ ...t, uploading: false }));
    }
  }, [setTray, fail]);

  // ---- turns ----------------------------------------------------------------------------------

  const run = useCallback(async (input: SendInput) => {
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setInFlight(true);
    let failed = false;
    // The run observer's sink of this turn (capture on): the request opens it, raw frames go to it, the end closes it.
    let sink: RunTurnSink | null = null;
    let turnError: { message: string; status?: number } | undefined;
    try {
      for await (const event of transport.send(input, ctrl.signal)) {
        if (ctrl.signal.aborted) break;
        if (event.type === "request") {
          sink = runObserver?.turn({ conversationId: input.conversationId, endpoint: event.endpoint, path: event.path, body: event.body, at: event.at }) ?? null;
          continue;
        }
        if (event.type === "raw") {
          sink?.frame(event.payload, event.at);
          continue;
        }
        dispatch({ type: "event", event });
        if (event.type === "error") {
          failed = true;
          turnError ??= { message: event.message, ...(event.status !== undefined && { status: event.status }) };
          report({ message: event.message, ...(event.status !== undefined && { status: event.status }) });
        }
        if (event.type === "final" && event.finishReason === "error") failed = true;
      }
    } catch (e) {
      failed = true;
      turnError ??= { message: messageOf(e), ...(statusOf(e) !== undefined && { status: statusOf(e) as number }) };
      if (!ctrl.signal.aborted) fail(e, true);
    } finally {
      if (inflight.current === ctrl) {
        inflight.current = null;
        setInFlight(false);
      }
      const ended = sink as RunTurnSink | null;
      if (ended !== null) {
        const error = turnError ?? (ctrl.signal.aborted ? { message: "the chat moved on before the reply ended" } : undefined);
        ended.end({ at: Date.now(), ...(error !== undefined && { error }) });
      }
    }
    // Until the name lookup has answered, every reply that completes without error triggers it (new/open clear the
    // pending id, so an aborted turn never matches); a failed reply leaves it pending for the next one.
    if (failed || ctrl.signal.aborted || namePending.current !== input.conversationId) return;
    lookUpName(input.conversationId);
  }, [transport, report, fail, lookUpName, runObserver]);

  const ready = (): boolean =>
    !inflight.current && !trayRef.current.uploading && !historyLoading.current && stateRef.current.authState === "ok";
  // A new turn never starts while the agent waits on the user: only resume() answers a wait.
  const canStart = (): boolean => ready() && stateRef.current.status !== "waiting";

  const startTurn = useCallback((id: string, t: string, uploaded?: UploadedAttachment[]) => {
    if (fresh.current) {
      fresh.current = false;
      if (listEnabled) {
        namePending.current = id;
        const now = new Date().toISOString();
        setList((l) => {
          if (l.items.some((it) => it.id === id)) return l;
          localIds.current.add(id); // idempotent, so a repeated updater call is harmless
          return { ...l, items: [{ id, name: localTitle(t), createdAt: now, updatedAt: now, etag: "" }, ...l.items] };
        });
      }
    }
    dispatch({ type: "user_send", text: t, ...(uploaded !== undefined && { attachments: uploaded }) });
    void run({ conversationId: id, text: t });
  }, [run, listEnabled]);

  const send = useCallback(async (text: string): Promise<boolean> => {
    const t = text.trim();
    if (t === "" || !canStart()) return false;
    // Without the streaming capability no reply can arrive: refuse before anything is written to the pod (no conversation
    // row, no upload). The message is not sent: the composer keeps its text and the picked files stay pending.
    if (!endpoints.canStream) {
      dispatch({ type: "event", event: { type: "error", message: STREAM_UNAVAILABLE } });
      report({ message: STREAM_UNAVAILABLE });
      return false;
    }
    const id = conversationId.current;
    if (!fileService || trayRef.current.pending.length === 0) {
      startTurn(id, t);
      return true;
    }
    // The flow holds the send guard (`uploading`), so no other turn starts meanwhile.
    const uploaded = await uploadAll(id, fileService);
    if (uploaded === null) return false;
    setTray((s) => ({ ...s, pending: [], rejected: [] }));
    startTurn(id, t, uploaded);
    return true;
  }, [endpoints, fileService, uploadAll, setTray, startTurn, report]);

  const sendStarter = useCallback((question: string) => { void send(question); }, [send]);

  const resume = useCallback((action: ResumeAction, content?: string, opts?: ResumeOptions) => {
    const wait = stateRef.current.wait;
    if (!wait || !ready()) return;
    const statusCheckOnly = opts?.statusCheckOnly === true;
    dispatch({ type: "resume_sent", action, ...(content !== undefined && { content }), ...(statusCheckOnly && { statusCheckOnly }) });
    void run({
      conversationId: conversationId.current,
      text: "",
      resume: {
        jobId: wait.jobId, token: wait.token, action,
        ...(content !== undefined && { content }), ...(statusCheckOnly && { statusCheckOnly }),
      },
    });
  }, [run]);

  const stop = (): void => {
    inflight.current?.abort();
    inflight.current = null;
    setInFlight(false);
  };

  const newConversation = useCallback(() => {
    stop();
    const id = newConversationId();
    conversationId.current = id;
    fresh.current = true;
    namePending.current = null;
    historyLoading.current = false;
    historySeq.current++;
    dispatch({ type: "new_conversation", id });
  }, []);

  const openConversation = useCallback((id: string) => {
    stop();
    conversationId.current = id;
    fresh.current = false;
    namePending.current = null;
    historyLoading.current = true;
    const seq = ++historySeq.current;
    dispatch({ type: "open_conversation", id });
    dispatch({ type: "history_loading" });
    history.messages(id).then(
      (messages) => {
        if (seq !== historySeq.current) return;
        historyLoading.current = false;
        dispatch({ type: "history_loaded", messages });
        // No history and no row in the list: a conversation the pod does not know yet (e.g. minted by the host), so its
        // first send adds and names a row like a conversation started here.
        if (messages.length === 0 && !listRef.current.items.some((it) => it.id === id)) fresh.current = true;
      },
      (e: unknown) => {
        if (seq !== historySeq.current) return;
        historyLoading.current = false;
        // The conversation stays usable: the notice shows the status (and the error body) and new turns go to the same id.
        const text = historyFailureText(e);
        dispatch({ type: "history_failed", status: statusOf(e) ?? 0, ...(text !== "" && { text }) });
        fail(e, false);
      },
    );
  }, [history, fail]);

  const rename = useCallback(async (id: string, name: string): Promise<ChatErrorDetail | null> => {
    try {
      await history.rename(id, name);
    } catch (e) {
      fail(e, false);
      return errorDetail(e);
    }
    setName(id, name);
    return null;
  }, [history, fail, setName]);

  const remove = useCallback(async (id: string): Promise<ChatErrorDetail | null> => {
    try {
      await history.remove(id);
    } catch (e) {
      fail(e, false);
      return errorDetail(e);
    }
    // `next` counts pod-listed rows only, so removing a local row leaves it as is.
    const wasLocal = localIds.current.delete(id);
    setList((l) => ({ ...l, items: l.items.filter((it) => it.id !== id), next: wasLocal ? l.next : Math.max(0, l.next - 1) }));
    if (conversationId.current === id) newConversation();
    return null;
  }, [history, fail, newConversation]);

  useEffect(() => () => {
    inflight.current?.abort();
    listSeq.current++;
    historySeq.current++;
  }, []);

  // ---- workflow (starters, name) --------------------------------------------------------------

  const [workflowInfo, setWorkflowInfo] = useState<WorkflowInfo | null>(null);
  const [workflowError, setWorkflowError] = useState<ChatErrorDetail | null>(null);
  const fromWorkflow = config.ui.starterQuestions === "fromWorkflow";
  useEffect(() => {
    setWorkflowInfo(null);
    setWorkflowError(null);
    if (!fromWorkflow) return undefined;
    let live = true;
    workflowSource.get().then(
      (info) => { if (live) setWorkflowInfo(info); },
      (e: unknown) => {
        if (!live) return;
        if (!isRelogin(e)) setWorkflowError(errorDetail(e));
        fail(e, false);
      },
    );
    return () => { live = false; };
  }, [workflowSource, fromWorkflow, fail]);

  const conversations = useMemo<ConversationList>(
    () => ({ items: list.items, hasMore: list.hasMore, loading: list.loading, error: list.error, refresh, loadMore, rename, remove }),
    [list, refresh, loadMore, rename, remove],
  );

  const attachments = useMemo<AttachmentTray | null>(
    () => (fileService
      ? { pending: tray.pending, rejected: tray.rejected, uploading: tray.uploading, add: addFiles, remove: removeFile }
      : null),
    [fileService, tray, addFiles, removeFile],
  );

  return { state, endpoints, workflowInfo, workflowError, conversations, inFlight, attachments, send, sendStarter, resume, newConversation, openConversation };
}
