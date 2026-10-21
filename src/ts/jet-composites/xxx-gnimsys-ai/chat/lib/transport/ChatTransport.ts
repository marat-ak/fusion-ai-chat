import type { ChatEvent } from "./events";

export interface ResumeInput { jobId: string; token: string; action: "APPROVE_ACTION" | "REJECT_ACTION" | "RFI_ACTION"; content?: string; statusCheckOnly?: boolean }
export interface SendInput { conversationId: string; text: string; resume?: ResumeInput }
export interface ChatTransport { send(input: SendInput, signal?: AbortSignal): AsyncIterable<ChatEvent>; }
