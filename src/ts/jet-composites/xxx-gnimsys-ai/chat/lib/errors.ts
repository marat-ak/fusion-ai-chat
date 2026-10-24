import { EndpointError, endpointBodyText, fusionErrorPrefix } from "./endpoints/EndpointFetch";
import { AttachmentError } from "./files/OracleAttachmentService";
import { HistoryError } from "./history/HistoryStore";
import { errorText } from "./transport/errorText";

/** What the chat reports (`ai-chat-error`) for a failure: its message and, when the call got an HTTP answer, the status. */
export interface ChatErrorDetail { message: string; status?: number }

export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The HTTP status of a failed call, when it got an HTTP answer. */
export function statusOf(e: unknown): number | undefined {
  return e instanceof HistoryError || e instanceof AttachmentError || (e instanceof EndpointError && e.kind === "http") ? e.status : undefined;
}

export function errorDetail(e: unknown): ChatErrorDetail {
  const status = statusOf(e);
  return { message: messageOf(e), ...(status !== undefined && { status }) };
}

/** An endpoint answered 401: the session behind the page's service connections is gone; a page reload signs in again. */
export const isRelogin = (e: unknown): boolean => statusOf(e) === 401;

/**
 * The readable text of a failed call's error body (`detail`/`title`/`message`, else the text), when it has one: for a
 * 401 it is what signing in means for that endpoint (e.g. a host's proxy naming where to sign in).
 */
export function bodyTextOf(e: unknown): string | undefined {
  const body = e instanceof HistoryError || e instanceof AttachmentError || (e instanceof EndpointError && e.kind === "http") ? e.body : undefined;
  const text = errorText(endpointBodyText(body) ?? "");
  return text === "" ? undefined : text;
}

/** The readable text of a failed history load (its error body; a Fusion error keeps its prefix); "" when there is none. */
export function historyFailureText(e: unknown): string {
  if (!(e instanceof HistoryError) || !e.body) return "";
  const text = errorText(e.body);
  return e.fusionErrorCode !== undefined ? fusionErrorPrefix(e.fusionErrorCode) + text : text;
}
