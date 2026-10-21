export interface AttachmentLimits { maxFiles: number; maxSizeMB: number; accept: string[] }
export interface UploadedAttachment { trackerId: string; fileName: string; size: number; mimeType: string }
export type Rejection = { file: File; reason: "count" | "size" | "type" };

export interface AttachmentService {
  validate(files: File[], existingCount: number): { ok: File[]; rejected: Rejection[] };
  /** Once per id (idempotent in-memory). */
  ensureConversation(conversationId: string): Promise<void>;
  upload(file: File): Promise<UploadedAttachment>;
  link(conversationId: string, items: UploadedAttachment[]): Promise<void>;
}
