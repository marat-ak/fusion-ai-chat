import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import type { ChatConfig } from "../lib/config/types";
import { substitute } from "../lib/config/substitute";
import { AuthError } from "../lib/auth/AuthFetch";
import { FusionShellAuthFetch } from "../lib/auth/FusionShellAuthFetch";
import { AiStudioTransport } from "../lib/transport/AiStudioTransport";
import type { ResumeInput, SendInput } from "../lib/transport/ChatTransport";
import { HistoryError } from "../lib/history/HistoryStore";
import { OracleHistoryStore } from "../lib/history/OracleHistoryStore";
import { OracleWorkflowInfo } from "../lib/history/OracleWorkflowInfo";
import type { WorkflowInfo } from "../lib/history/OracleWorkflowInfo";
import { OracleAttachmentService } from "../lib/files/OracleAttachmentService";
import { initialState, newConversationId, reduce } from "../lib/state/conversation";
import type { ChatState } from "../lib/state/conversation";

export interface ChatErrorDetail { message: string; status?: number }

export interface ChatControllerProps {
  userName: string;
  /** Required when `config.files.enabled` (the component gates this as needs-input before the controller runs). */
  personId?: string;
  /** Page values for `{{key}}` substitution in `agent.additionalContext`. */
  context?: Record<string, unknown>;
  /** Host-provided conversation to start in; a new id is minted when absent. */
  conversationId?: string;
  onError?: (detail: ChatErrorDetail) => void;
}

export interface ChatControllerDeps { document: Document; origin?: string }

export type ResumeAction = ResumeInput["action"];

export interface ChatController {
  state: ChatState;
  /** Fetched on mount when `ui.starterQuestions === "fromWorkflow"`; null until loaded or when the fetch failed. */
  workflowInfo: WorkflowInfo | null;
  /** Set when the workflow lookup failed for a reason other than auth (auth failures show the auth banner). */
  workflowError: ChatErrorDetail | null;
  send(text: string): void;
  sendStarter(question: string): void;
  resume(action: ResumeAction, content?: string): void;
  newConversation(): void;
  openConversation(id: string): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const statusOf = (e: unknown): number | undefined =>
  e instanceof AuthError || e instanceof HistoryError ? e.status : undefined;

/** Single owner of the chat services and the conversation reducer. Call only with a validated config. */
export function useChatController(config: ChatConfig, props: ChatControllerProps, deps: ChatControllerDeps): ChatController {
  const { document: doc, origin } = deps;
  const { userName, personId, context } = props;
  const pod = config.agent.pod;

  // Keyed on the pod, not the config object: the relay reads (and removes) the shell's xsrf node once per instance.
  const auth = useMemo(
    () => new FusionShellAuthFetch({ pod, document: doc, ...(origin !== undefined && { origin }) }),
    [pod, doc, origin],
  );

  const transport = useMemo(() => {
    const ac = config.agent.additionalContext;
    const lang = config.agent.responseLanguage;
    return new AiStudioTransport({
      auth,
      workflowCode: config.agent.workflowCode,
      checkVersion: config.protocol.checkVersion,
      ...(ac !== undefined && { additionalContext: substitute(ac, context ?? {}) }),
      ...(lang !== undefined && { responseLanguage: lang }),
      ...(origin !== undefined && { origin }),
    });
  }, [config, auth, context, origin]);

  // Built here so the controller stays the single owner of services; the sidebar and attachments flows consume them.
  const history = useMemo(
    () => new OracleHistoryStore({ auth, workflowCode: config.agent.workflowCode, userName, ...(origin !== undefined && { origin }) }),
    [config, auth, userName, origin],
  );
  const attachments = useMemo(() => {
    if (!config.files.enabled) return null;
    const hcmRestBase = config.protocol.hcmRestBase;
    if (!personId || !hcmRestBase) throw new Error("files.enabled requires person-id and protocol.hcmRestBase");
    const { maxFiles, maxSizeMB, accept } = config.files;
    return new OracleAttachmentService({
      auth, workflowCode: config.agent.workflowCode, personId, hcmRestBase,
      limits: { maxFiles, maxSizeMB, accept }, ...(origin !== undefined && { origin }),
    });
  }, [config, auth, personId, origin]);

  const workflowSource = useMemo(
    () => new OracleWorkflowInfo({ auth, workflowCode: config.agent.workflowCode, ...(origin !== undefined && { origin }) }),
    [config, auth, origin],
  );

  const [state, dispatch] = useReducer(reduce, props.conversationId, (id?: string) => initialState(id ? id : newConversationId()));
  const stateRef = useRef(state);
  stateRef.current = state;
  // Updated synchronously by new/open so a send() in the same tick targets the new conversation.
  const conversationId = useRef(state.conversationId);
  const onErrorRef = useRef(props.onError);
  onErrorRef.current = props.onError;
  const report = useCallback((detail: ChatErrorDetail) => { onErrorRef.current?.(detail); }, []);

  // Set while a turn streams; doubles as the one-turn-at-a-time guard (synchronous, unlike the reducer status).
  const inflight = useRef<AbortController | null>(null);

  // Any AuthError (relogin, unauthorized, or invalid: missing xsrf node, undecodable token, clock skew) is an auth state;
  // the in-flight turn is closed with `done` so nothing stays "sending".
  const fail = useCallback((e: unknown, endTurn: boolean) => {
    if (e instanceof AuthError) {
      dispatch({ type: "auth", state: e.kind === "unauthorized" ? "unauthorized" : "relogin" });
      if (endTurn) dispatch({ type: "event", event: { type: "done" } });
    } else if (endTurn) {
      dispatch({ type: "event", event: { type: "error", message: messageOf(e) } });
      dispatch({ type: "event", event: { type: "done" } });
    }
    const status = statusOf(e);
    report({ message: messageOf(e), ...(status !== undefined && { status }) });
  }, [report]);

  const run = useCallback(async (input: SendInput) => {
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      for await (const event of transport.send(input, ctrl.signal)) {
        if (ctrl.signal.aborted) break;
        dispatch({ type: "event", event });
        if (event.type === "error") report({ message: event.message, ...(event.status !== undefined && { status: event.status }) });
      }
    } catch (e) {
      if (!ctrl.signal.aborted) fail(e, true);
    } finally {
      if (inflight.current === ctrl) inflight.current = null;
    }
  }, [transport, report, fail]);

  const send = useCallback((text: string) => {
    const t = text.trim();
    const s = stateRef.current;
    if (t === "" || inflight.current || s.authState !== "ok") return;
    dispatch({ type: "user_send", text: t });
    void run({ conversationId: conversationId.current, text: t });
  }, [run]);

  const sendStarter = useCallback((question: string) => { send(question); }, [send]);

  const resume = useCallback((action: ResumeAction, content?: string) => {
    const s = stateRef.current;
    const wait = s.wait;
    if (!wait || inflight.current || s.authState !== "ok") return;
    dispatch({ type: "resume_sent", action, ...(content !== undefined && { content }) });
    void run({
      conversationId: conversationId.current,
      text: "",
      resume: { jobId: wait.jobId, token: wait.token, action, ...(content !== undefined && { content }) },
    });
  }, [run]);

  const stop = (): void => {
    inflight.current?.abort();
    inflight.current = null;
  };

  const newConversation = useCallback(() => {
    stop();
    const id = newConversationId();
    conversationId.current = id;
    dispatch({ type: "new_conversation", id });
  }, []);

  const openConversation = useCallback((id: string) => {
    stop();
    conversationId.current = id;
    dispatch({ type: "open_conversation", id });
  }, []);

  useEffect(() => () => inflight.current?.abort(), []);

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
        if (!(e instanceof AuthError)) {
          const status = statusOf(e);
          setWorkflowError({ message: messageOf(e), ...(status !== undefined && { status }) });
        }
        fail(e, false);
      },
    );
    return () => { live = false; };
  }, [workflowSource, fromWorkflow, fail]);

  return { state, workflowInfo, workflowError, send, sendStarter, resume, newConversation, openConversation };
}
