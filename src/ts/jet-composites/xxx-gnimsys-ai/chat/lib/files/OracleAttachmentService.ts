import { resolveOrigin } from "../origin";
import type { AuthFetch } from "../auth/AuthFetch";
import type { AttachmentLimits, AttachmentService, Rejection, UploadedAttachment } from "./AttachmentService";

export class AttachmentError extends Error {
  step: "conversation" | "tracker" | "upload" | "link";
  status: number;
  body?: string;
  constructor(step: "conversation" | "tracker" | "upload" | "link", status: number, body?: string) {
    super(`attachment ${step} HTTP ${status}${body ? ": " + body : ""}`);
    this.name = "AttachmentError";
    this.step = step;
    this.status = status;
    this.body = body;
  }
}

export class OracleAttachmentService implements AttachmentService {
  private auth: AuthFetch;
  private workflowCode: string;
  private personId: string;
  private hcmRestBase: string;
  private limits: AttachmentLimits;
  private origin: string;
  private now: () => number;
  private known: Map<string, Promise<void>> = new Map();

  constructor(deps: { auth: AuthFetch; workflowCode: string; personId: string; hcmRestBase: string; limits: AttachmentLimits; origin?: string; now?: () => number }) {
    this.auth = deps.auth;
    this.workflowCode = deps.workflowCode;
    this.personId = deps.personId;
    this.hcmRestBase = deps.hcmRestBase;
    this.limits = deps.limits;
    this.origin = resolveOrigin(deps.origin);
    this.now = deps.now ?? Date.now;
  }

  validate(files: File[], existingCount: number): { ok: File[]; rejected: Rejection[] } {
    const ok: File[] = [];
    const rejected: Rejection[] = [];
    const accept = this.limits.accept.map((a) => a.toLowerCase());
    for (const file of files) {
      if (existingCount + ok.length >= this.limits.maxFiles) { rejected.push({ file, reason: "count" }); continue; }
      if (file.size > this.limits.maxSizeMB * 1024 * 1024) { rejected.push({ file, reason: "size" }); continue; }
      const dot = file.name.lastIndexOf(".");
      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
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
    const r = await this.auth.fetch("rest", `${this.origin}${this.hcmRestBase}/hcmAiStudioConversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ConversationId: conversationId, PersonId: this.personId, ObjectCode: this.workflowCode, ObjectType: "AGENT_TEAM" }),
    });
    if (!r.ok) throw new AttachmentError("conversation", r.status, await r.text());
  }

  async upload(file: File): Promise<UploadedAttachment> {
    const mimeType = file.type || "application/octet-stream";
    const t = await this.auth.fetch("rest", `${this.origin}/fscmRestApi/applcoreApi/v1/attachDocTracker/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ clientfileid: this.now(), filename: file.name, mimetype: mimeType, size: file.size }]),
    });
    if (!t.ok) throw new AttachmentError("tracker", t.status, await t.text());
    const tj = JSON.parse(await t.text());
    const trackerId: string | undefined = tj.trackers?.[0]?.trackerId;
    if (!trackerId || !tj.username) throw new AttachmentError("tracker", t.status, "trackerId/username missing");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("filename", file.name);
    fd.append("size", String(file.size));
    fd.append("mimetype", mimeType);
    fd.append("tracker", trackerId);
    fd.append("user", tj.username);
    const u = await this.auth.fetch("rest", `${this.origin}/fscmRestApi/applcoreApi/v1/attachUpload`, { method: "POST", body: fd });
    if (!u.ok) throw new AttachmentError("upload", u.status, await u.text());
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
    const r = await this.auth.fetch("rest", `${this.origin}${this.hcmRestBase}/`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.oracle.adf.batch+json" },
      body: JSON.stringify({ parts }),
    });
    if (!r.ok) throw new AttachmentError("link", r.status, await r.text());
  }
}
