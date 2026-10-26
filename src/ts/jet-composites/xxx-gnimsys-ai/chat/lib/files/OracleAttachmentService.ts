import { EndpointError, endpointBodyText, fusionErrorPrefix, objectBody } from "../endpoints/EndpointFetch";
import type { EndpointFetch, EndpointInit, EndpointResponse } from "../endpoints/EndpointFetch";
import type { AttachmentLimits, AttachmentService, Rejection, UploadedAttachment } from "./AttachmentService";

export class AttachmentError extends Error {
  step: "conversation" | "tracker" | "upload" | "link";
  status: number;
  body?: string;
  /** Set when the pod answered a non-error status with a Fusion error body (`o:errorCode`); the message then starts with it. */
  fusionErrorCode?: string;
  constructor(step: "conversation" | "tracker" | "upload" | "link", status: number, body?: string, fusionErrorCode?: string) {
    super(`${fusionErrorCode !== undefined ? fusionErrorPrefix(fusionErrorCode) : ""}attachment ${step} HTTP ${status}${body ? ": " + body : ""}`);
    this.name = "AttachmentError";
    this.step = step;
    this.status = status;
    this.body = body;
    if (fusionErrorCode !== undefined) this.fusionErrorCode = fusionErrorCode;
  }
}

type Step = AttachmentError["step"];

/** What the conversation-row error adds when the row was created without a PersonId (the page gave no `person-id`). */
export const NO_PERSON_ID_NOTE = "the conversation row was sent without PersonId (no person-id given)";

/**
 * Attachment calls go through the FA endpoint; an HTTP failure is an AttachmentError naming the step. `personId` is
 * optional: without it the conversation row is created without `PersonId` (as Studio's own clients do on `/debug`); a pod
 * that refuses that row fails the "conversation" step, and the error says the PersonId was omitted.
 */
export class OracleAttachmentService implements AttachmentService {
  private endpoints: EndpointFetch;
  private workflowCode: string;
  private personId: string | undefined;
  private hcmRestBase: string;
  private limits: AttachmentLimits;
  private now: () => number;
  private known: Map<string, Promise<void>> = new Map();

  constructor(deps: { endpoints: EndpointFetch; workflowCode: string; personId?: string; hcmRestBase: string; limits: AttachmentLimits; now?: () => number }) {
    this.endpoints = deps.endpoints;
    this.workflowCode = deps.workflowCode;
    this.personId = deps.personId;
    this.hcmRestBase = deps.hcmRestBase;
    this.limits = deps.limits;
    this.now = deps.now ?? Date.now;
  }

  private async call(step: Step, url: string, init: EndpointInit): Promise<EndpointResponse> {
    try {
      return await this.endpoints.request("FA", url, init);
    } catch (e) {
      if (e instanceof EndpointError && e.kind === "http") throw new AttachmentError(step, e.status, endpointBodyText(e.body), e.fusionErrorCode);
      throw e;
    }
  }

  validate(files: File[], existingCount: number): { ok: File[]; rejected: Rejection[] } {
    const ok: File[] = [];
    const rejected: Rejection[] = [];
    // Accept entries may be written with or without the leading dot ("pdf" or ".pdf"); both match the bare extension.
    const accept = this.limits.accept.map((a) => a.toLowerCase().replace(/^\.+/, ""));
    for (const file of files) {
      if (existingCount + ok.length >= this.limits.maxFiles) { rejected.push({ file, reason: "count" }); continue; }
      if (file.size > this.limits.maxSizeMB * 1024 * 1024) { rejected.push({ file, reason: "size" }); continue; }
      const dot = file.name.lastIndexOf(".");
      const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
      const typeOk = (ext !== "" && accept.includes(ext)) || (accept.includes("image/*") && file.type.startsWith("image/"));
      if (!typeOk) { rejected.push({ file, reason: "type" }); continue; }
      ok.push(file);
    }
    return { ok, rejected };
  }

  async ensureConversation(conversationId: string): Promise<void> {
    const inflight = this.known.get(conversationId);
    if (inflight) return inflight;
    const p = this.create(conversationId);
    this.known.set(conversationId, p);
    try {
      await p;
    } catch (e) {
      this.known.delete(conversationId);
      throw e;
    }
  }

  private async create(conversationId: string): Promise<void> {
    const row = {
      ConversationId: conversationId,
      ...(this.personId !== undefined && { PersonId: this.personId }),
      ObjectCode: this.workflowCode,
      ObjectType: "AGENT_TEAM",
    };
    try {
      await this.call("conversation", `${this.hcmRestBase}/hcmAiStudioConversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
    } catch (e) {
      if (e instanceof AttachmentError && this.personId === undefined) {
        throw new AttachmentError("conversation", e.status, `${NO_PERSON_ID_NOTE}${e.body ? "; " + e.body : ""}`, e.fusionErrorCode);
      }
      throw e;
    }
  }

  async upload(file: File): Promise<UploadedAttachment> {
    const mimeType = file.type || "application/octet-stream";
    const t = await this.call("tracker", "/fscmRestApi/applcoreApi/v1/attachDocTracker/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ clientfileid: this.now(), filename: file.name, mimetype: mimeType, size: file.size }]),
    });
    const tj = objectBody(t) as { trackers?: Array<{ trackerId?: unknown }>; username?: unknown } | null;
    const trackerId = tj?.trackers?.[0]?.trackerId;
    const username = tj?.username;
    if (typeof trackerId !== "string" || !trackerId || typeof username !== "string" || !username) {
      throw new AttachmentError("tracker", t.status, "trackerId/username missing");
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("filename", file.name);
    fd.append("size", String(file.size));
    fd.append("mimetype", mimeType);
    fd.append("tracker", trackerId);
    fd.append("user", username);
    await this.call("upload", "/fscmRestApi/applcoreApi/v1/attachUpload", { method: "POST", body: fd });
    return { trackerId, fileName: file.name, size: file.size, mimeType };
  }

  async link(conversationId: string, items: UploadedAttachment[]): Promise<void> {
    const parts = items.map((it, i) => ({
      id: "attachment_" + (i + 1),
      operation: "create",
      path: "/hcmAiStudioConversations/" + conversationId + "/child/Attachments",
      payload: {
        AsyncTrackerId: it.trackerId,
        CategoryName: null,
        ContentRepositoryFileShared: "false",
        DatatypeCode: "FILE",
        FileName: it.fileName,
        Title: it.fileName,
        UploadedFileName: it.fileName,
      },
    }));
    await this.call("link", `${this.hcmRestBase}/`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.oracle.adf.batch+json" },
      body: JSON.stringify({ parts }),
    });
  }
}
