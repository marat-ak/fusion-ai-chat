export interface AttachmentLimits { maxFiles: number; maxSizeMB: number; accept: string[] }
export interface UploadedAttachment { trackerId: string; fileName: string; size: number; mimeType: string }
export type Rejection = { file: File; reason: "count" | "size" | "type" };

/**
 * Whether picked files may go WITHOUT a text (the message, or a free-text reply's content, is then `""`). Oracle's chat
 * client sends attachments alone once every one of them is uploaded (`$e.length>0 && $e.every(c=>c.isUploaded)`); here
 * files upload when the message is sent, so "ready" = picked and waiting to go: at least one, none uploading, none whose
 * last upload failed. A message with text keeps its own rule (it goes with whatever is picked and retries a failed upload).
 */
export function filesAloneSendable(files: ReadonlyArray<{ state: string }>): boolean {
  return files.length > 0 && files.every((f) => f.state === "pending");
}

export interface AttachmentService {
  validate(files: File[], existingCount: number): { ok: File[]; rejected: Rejection[] };
  /** Once per id (idempotent in-memory). */
  ensureConversation(conversationId: string): Promise<void>;
  upload(file: File): Promise<UploadedAttachment>;
  link(conversationId: string, items: UploadedAttachment[]): Promise<void>;
}
